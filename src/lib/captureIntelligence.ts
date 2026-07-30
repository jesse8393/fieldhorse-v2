// src/lib/captureIntelligence.ts
//
// Universal Capture, the AI router behind the global "+" button.
// One input (spoken, typed, or OCR'd) goes in; one structured action
// comes out: a note, todo, payment, expense, schedule event, or new
// lead, optionally matched to an existing job. The operator always
// confirms before anything is written (CaptureSheet renders the
// parsed intent as an editable card).
//
// Claude does the language work; normalizeIntent() is the trust
// boundary, everything the model returns is re-validated against
// whitelists and the live job roster before the UI offers to save it.

import { claudeMessage, extractJson } from './anthropic.ts'
import { todayYmd } from './dates.ts'

export type CaptureKind = 'note' | 'todo' | 'payment' | 'expense' | 'schedule' | 'lead'

export const CAPTURE_KINDS: CaptureKind[] = ['note', 'todo', 'payment', 'expense', 'schedule', 'lead']

// Mirrors the DB whitelists: fh_payments.method is free text by
// convention, fh_payments.kind has the migration-022 check constraint,
// fh_expenses.category drives the Financials rollup chips.
export const PAYMENT_METHODS = ['check', 'cash', 'card', 'transfer', 'other']
export const PAYMENT_KINDS = ['deposit', 'progress', 'final', 'retainage', 'other']
export const EXPENSE_CATEGORIES = ['Materials', 'Fuel', 'Permits', 'Equipment', 'Other']

export type RosterEntry = {
  id: string
  name: string | null
  job_title?: string | null
  stage?: string | null
}

export type CaptureIntent = {
  kind: CaptureKind
  // One-line, human-readable description of what will happen :
  // rendered as the confirm card headline.
  summary: string
  // Matched fh_contacts id, validated against the roster (null = none).
  job_id: string | null
  confidence: number
  // kind-specific fields (all optional; normalize fills safe defaults)
  text?: string | null
  due_at?: string | null        // ISO date (todo)
  amount?: number | null        // payment / expense / lead
  method?: string | null        // payment
  payment_kind?: string | null  // payment
  description?: string | null   // expense
  category?: string | null      // expense
  expense_date?: string | null  // ISO date
  title?: string | null         // schedule / lead job title
  start_at?: string | null      // ISO datetime (schedule)
  end_at?: string | null        // ISO datetime (schedule)
  name?: string | null          // lead
  phone?: string | null         // lead
  email?: string | null         // lead
  address?: string | null       // lead
  follow_up_on?: string | null  // ISO date (lead)
}

// Kept free of timestamps / per-user content so repeat calls share a
// stable prefix (prompt-cache hygiene; volatile context rides in the
// user message instead).
const CAPTURE_SYSTEM = `You are the capture router inside a contractor's CRM. The contractor speaks or types one rough thought from the field. Decide what they want recorded and return ONLY a JSON object, no prose, no markdown.

Pick exactly one "kind":
- "payment"  money RECEIVED from a client ("got the deposit", "they paid", "picked up a check")
- "expense"  money SPENT ("bought lumber", "filled up the truck", "$80 permit")
- "todo"     something to do later ("need to", "don't forget", "remind me")
- "schedule" an appointment/visit at a specific date or time ("meet Tuesday at 9", "inspection Friday")
- "lead"     a NEW potential customer (a name/number/job that is not an existing job)
- "note"     everything else worth remembering (default when unsure)

JSON shape (omit fields that don't apply):
{
  "kind": "...",
  "summary": "short confirmation line, max 12 words, e.g. 'Log $500 check payment on Henderson roof'",
  "job_id": "id from the JOBS list if the input clearly refers to one, else null",
  "confidence": 0.0-1.0,
  "text": "cleaned-up body for note/todo (fix dictation artifacts, keep the contractor's words)",
  "due_at": "year month day",
  "amount": number,
  "method": "check|cash|card|transfer|other",
  "payment_kind": "deposit|progress|final|retainage|other",
  "description": "expense description",
  "category": "Materials|Fuel|Permits|Equipment|Other",
  "expense_date": "year month day",
  "title": "schedule event title or lead job title",
  "start_at": "year month dayTHH:MM (local time, no timezone suffix)",
  "end_at": "year month dayTHH:MM",
  "name": "lead's name",
  "phone": "lead's phone",
  "email": "lead's email",
  "address": "lead's address",
  "follow_up_on": "year month day"
}

Rules:
- Resolve relative dates ("tomorrow", "Friday") against TODAY from the user message.
- Match job_id loosely by client name, job title, or address, but only when it's clearly one job; otherwise null.
- A payment or expense without a stated amount: omit "amount" (the operator fills it in).
- Schedule events default to 1 hour when no end time is given.
- Never invent phone numbers, emails, amounts, or names that aren't in the input.`

function rosterBlock(roster: RosterEntry[]) {
  if (!roster.length) return 'JOBS: (none)'
  const lines = roster.slice(0, 80).map((r) => {
    const title = r.job_title ? `, ${r.job_title}` : ''
    return `${r.id} :: ${r.name || 'Unnamed'}${title} (${r.stage || 'job'})`
  })
  return `JOBS (id :: client, job title (stage)):\n${lines.join('\n')}`
}

/**
 * routeCapture, one round trip: rough input → validated CaptureIntent.
 * Throws on network/AI failure; callers degrade to a plain note.
 */
export async function routeCapture({ text, roster, now = new Date() }: { text: string; roster: RosterEntry[]; now?: Date }): Promise<CaptureIntent> {
  const today = todayYmd(now)
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' })
  const res = await claudeMessage({
    // Intent routing is correctness-sensitive (it writes money rows) :
    // run it on the strongest model rather than the app-wide default.
    model: 'claude-fable-5',
    system: CAPTURE_SYSTEM,
    messages: [{
      role: 'user',
      content: `TODAY: ${today} (${weekday})\n${rosterBlock(roster)}\n\nINPUT: ${text}`
    }],
    // fable-5 thinking is always on and shares the max_tokens budget :
    // 600 risked truncating the JSON mid-object. Low effort keeps the
    // simple intent-routing fast enough for the capture UX.
    maxTokens: 1500,
    effort: 'low'
  })
  const body = res?.content?.[0]?.text
  const raw = extractJson(body)
  const intent = normalizeIntent(raw, roster)
  if (!intent) throw new Error('Capture parse failed')
  return intent
}

/* ============================================================
   normalizeIntent, pure validation layer (unit-tested).
   Never trust model output: clamp enums, coerce numbers, check
   job_id against the roster, sanity-check dates.
   ============================================================ */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function cleanDate(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const d = v.slice(0, 10)
  if (!DATE_RE.test(d)) return null
  return Number.isNaN(Date.parse(d)) ? null : d
}

function cleanDateTime(v: unknown): string | null {
  if (typeof v !== 'string' || v.length < 16) return null
  const parsed = new Date(v)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function cleanAmount(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace(/[$,\s]/g, '')) : Number(v)
  if (!Number.isFinite(n) || n <= 0 || n > 100_000_000) return null
  return Math.round(n * 100) / 100
}

function str(v: unknown, max = 2000): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s.slice(0, max) : null
}

function pick(v: unknown, allowed: string[], fallback: string): string {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  const hit = allowed.find((a) => a.toLowerCase() === s)
  return hit ?? fallback
}

export function normalizeIntent(raw: any, roster: RosterEntry[]): CaptureIntent | null {
  if (!raw || typeof raw !== 'object') return null
  const kind = CAPTURE_KINDS.includes(raw.kind) ? (raw.kind as CaptureKind) : null
  if (!kind) return null

  const ids = new Set(roster.map((r) => r.id))
  const job_id = typeof raw.job_id === 'string' && ids.has(raw.job_id) ? raw.job_id : null

  const confidence = Math.min(1, Math.max(0, Number(raw.confidence) || 0))

  const intent: CaptureIntent = {
    kind,
    summary: str(raw.summary, 120) || defaultSummary(kind),
    job_id,
    confidence
  }

  switch (kind) {
    case 'note':
    case 'todo': {
      intent.text = str(raw.text) || str(raw.summary)
      if (!intent.text) return null
      if (kind === 'todo') intent.due_at = cleanDate(raw.due_at)
      break
    }
    case 'payment': {
      intent.amount = cleanAmount(raw.amount)
      intent.method = pick(raw.method, PAYMENT_METHODS, 'check')
      intent.payment_kind = pick(raw.payment_kind, PAYMENT_KINDS, 'other')
      break
    }
    case 'expense': {
      intent.amount = cleanAmount(raw.amount)
      intent.description = str(raw.description, 200) || str(raw.text, 200) || 'Expense'
      // Categories are Capitalized in the DB check, match case-insensitively.
      intent.category = pick(raw.category, EXPENSE_CATEGORIES, 'Other')
      intent.expense_date = cleanDate(raw.expense_date) || todayYmd()
      break
    }
    case 'schedule': {
      intent.title = str(raw.title, 120) || str(raw.summary, 120) || 'Site visit'
      intent.start_at = cleanDateTime(raw.start_at)
      if (!intent.start_at) return null
      const end = cleanDateTime(raw.end_at)
      // Default to a 1-hour block; refuse ends that precede the start.
      intent.end_at = end && end > intent.start_at
        ? end
        : new Date(Date.parse(intent.start_at) + 60 * 60 * 1000).toISOString()
      break
    }
    case 'lead': {
      intent.name = str(raw.name, 120)
      intent.phone = str(raw.phone, 40)
      intent.email = str(raw.email, 120)
      intent.address = str(raw.address, 200)
      intent.title = str(raw.title, 120)
      intent.amount = cleanAmount(raw.amount)
      intent.follow_up_on = cleanDate(raw.follow_up_on)
      if (!intent.name && !intent.phone && !intent.title) return null
      // A lead is by definition not an existing job.
      intent.job_id = null
      break
    }
  }
  return intent
}

function defaultSummary(kind: CaptureKind) {
  switch (kind) {
    case 'todo': return 'Add a task'
    case 'payment': return 'Log a payment'
    case 'expense': return 'Log an expense'
    case 'schedule': return 'Schedule an event'
    case 'lead': return 'Create a lead'
    default: return 'Save a note'
  }
}

export const CAPTURE_KIND_META: Record<CaptureKind, { label: string; verb: string }> = {
  note:     { label: 'Note',     verb: 'Save note' },
  todo:     { label: 'Task',    verb: 'Add task' },
  payment:  { label: 'Payment',  verb: 'Log payment' },
  expense:  { label: 'Expense',  verb: 'Log expense' },
  schedule: { label: 'Schedule', verb: 'Add to schedule' },
  lead:     { label: 'New lead', verb: 'Create lead' }
}
