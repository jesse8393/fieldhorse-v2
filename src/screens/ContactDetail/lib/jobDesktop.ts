// View models for the desktop Job page (spec 9.11): the notes under each
// stage rail segment and the rows of the Documents section. Pure, so the
// page and its tests share one source.
//
// Rail notes, one short line per segment, each only when there is
// something true to say:
//   Lead     the date it came in and where from, "Sep 23, website"
//   Quote    "Draft", "Sent Oct 9", "Changes requested", or once the job
//            started "Approved Sep 28"
//   Job      the next scheduled events, "Pour slab today, Inspection Fri",
//            or "Done Oct 3" once the work is finished
//   Invoice  the balance due, "$6,187.50 balance" (money roles only)
//   Closed   "Closed Oct 3"
//
// Text the code writes never contains a hyphen, an en dash or an em dash.
// Titles people typed (schedule events, file names) pass through as typed.

import type { RailSegmentId } from '../../../lib/stageRail.ts'
import { moneyCents } from '../../../lib/format.ts'
import { spineDay } from './spine.ts'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MAX_EVENTS = 2

/** A timestamp, or a calendar date read as that day here (not a UTC midnight). */
function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  const date = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** "Sep 23", with the year when it is not this year. */
export function shortDate(value: string | Date | null | undefined, now: Date): string | null {
  const at = toDate(value)
  if (!at) return null
  const date = `${MONTHS[at.getMonth()]} ${at.getDate()}`
  return at.getFullYear() === now.getFullYear() ? date : `${date}, ${at.getFullYear()}`
}

export type RailNotesContact = {
  stage?: string | null
  created_at?: string | null
  source?: string | null
  referred_by?: string | null
  completed_at?: string | null
  proposal_status?: string | null
  quote_sent_at?: string | null
}

export type RailNotesEvent = { title?: string | null; start_at?: string | null; end_at?: string | null }
export type RailNotesTransition = { from_stage?: string | null; to_stage?: string | null; transitioned_at?: string | null }

export type RailNotesInput = {
  contact: RailNotesContact | null | undefined
  scheduleItems?: RailNotesEvent[] | null
  stageTransitions?: RailNotesTransition[] | null
  contractTotal?: number | null
  paid?: number | null
  balance?: number | null
  /** The balance note is money; field roles never get it. */
  canSeeMoney: boolean
  now: Date
}

function clean(value: string | null | undefined): string {
  return String(value ?? '').trim()
}

/** The newest transition into `to`, optionally from `from`. */
function transitionAt(list: RailNotesTransition[], to: string, from?: string): Date | null {
  const hits = list
    .filter((t) => clean(t.to_stage).toLowerCase() === to && (!from || clean(t.from_stage).toLowerCase() === from))
    .map((t) => toDate(t.transitioned_at))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())
  return hits[0] ?? null
}

function upcomingEvents(items: RailNotesEvent[], now: Date): string[] {
  return items
    .map((e) => ({ title: clean(e.title), start: toDate(e.start_at), end: toDate(e.end_at) }))
    .filter((e): e is { title: string; start: Date; end: Date | null } => e.start !== null && (e.end ?? e.start).getTime() >= now.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, MAX_EVENTS)
    .map((e) => (e.title ? `${e.title} ${spineDay(e.start, now)}` : `Scheduled ${spineDay(e.start, now)}`))
}

export function railNotes(input: RailNotesInput): Partial<Record<RailSegmentId, string>> {
  const { contact, scheduleItems, stageTransitions, canSeeMoney, now } = input
  const notes: Partial<Record<RailSegmentId, string>> = {}
  if (!contact) return notes

  const stage = clean(contact.stage).toLowerCase()
  const transitions = stageTransitions ?? []
  const started = stage === 'job' || stage === 'invoice' || stage === 'closed'
  const finished = !!toDate(contact.completed_at)

  const lead = [shortDate(contact.created_at, now), clean(contact.source) || clean(contact.referred_by)].filter(Boolean).join(', ')
  if (lead) notes.lead = lead

  if (started) {
    const approved = transitionAt(transitions, 'job', 'quote')
    if (approved) notes.quote = `Approved ${shortDate(approved, now)}`
    else if (clean(contact.proposal_status).toLowerCase() === 'approved') notes.quote = 'Approved'
  } else if (stage === 'quote') {
    const status = clean(contact.proposal_status).toLowerCase()
    const sent = shortDate(contact.quote_sent_at, now)
    if (status === 'changes_requested') notes.quote = 'Changes requested'
    else if (status === 'sent' || sent) notes.quote = sent ? `Sent ${sent}` : 'Sent'
    else notes.quote = 'Draft'
  }

  if (finished && started) {
    notes.job = `Done ${shortDate(contact.completed_at, now)}`
  } else if (stage === 'job' || stage === 'invoice') {
    const events = upcomingEvents(scheduleItems ?? [], now)
    notes.job = events.length > 0 ? events.join(', ') : 'Nothing scheduled'
  }

  const contract = Number(input.contractTotal ?? 0)
  const paid = Number(input.paid ?? 0)
  const balance = Number(input.balance ?? 0)
  if (canSeeMoney && started && (contract > 0 || paid > 0) && Number.isFinite(balance)) {
    if (balance > 0.005) notes.invoice = `${moneyCents(balance)} balance`
    else if (balance < -0.005) notes.invoice = `${moneyCents(Math.abs(balance))} credit`
    else notes.invoice = 'Paid in full'
  }

  if (stage === 'closed') {
    const closed = transitionAt(transitions, 'closed')
    if (closed) notes.closed = `Closed ${shortDate(closed, now)}`
  }

  return notes
}

export type DocumentTab = 'quote' | 'financials' | 'files'

export type DocumentRow = {
  id: string
  label: string
  /** A status word or a date, drawn on the right. */
  detail: string | null
  /** The section that holds it. */
  tab: DocumentTab
}

export type DocumentContact = {
  stage?: string | null
  amount?: number | null
  proposal_status?: string | null
  quote_sent_at?: string | null
  approved_quote_version_id?: string | null
}

export type DocumentInvoice = {
  id: string
  sequence_number?: number | null
  title?: string | null
  status?: string | null
  issued_at?: string | null
  due_at?: string | null
}

export type DocumentFile = { id: string; filename?: string | null; uploaded_at?: string | null }

export const MAX_FILE_ROWS = 3

const INVOICE_STATUS: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  paid: 'Paid',
  partial: 'Part paid',
  overdue: 'Overdue',
  void: 'Void'
}

function statusWord(status: string | null | undefined): string | null {
  const key = clean(status).toLowerCase()
  if (!key) return null
  return INVOICE_STATUS[key] ?? `${key[0].toUpperCase()}${key.slice(1).replace(/_/g, ' ')}`
}

/**
 * The job's documents: its quote, its invoices (both money, so money
 * roles only) and the files people uploaded, newest first. Photos live
 * in the Spine and the Files tab, not here.
 */
export function documentRows({ contact, invoices, files, canSeeMoney, now }: {
  contact: DocumentContact | null | undefined
  invoices?: DocumentInvoice[] | null
  files?: DocumentFile[] | null
  canSeeMoney: boolean
  now: Date
}): DocumentRow[] {
  const rows: DocumentRow[] = []

  if (canSeeMoney && contact && (clean(contact.proposal_status) || contact.approved_quote_version_id || contact.quote_sent_at)) {
    const status = clean(contact.proposal_status).toLowerCase()
    const sent = shortDate(contact.quote_sent_at, now)
    const detail = status === 'approved' ? 'Approved'
      : status === 'changes_requested' ? 'Changes requested'
      : sent ? `Sent ${sent}`
      : statusWord(status) ?? 'Draft'
    rows.push({ id: 'quote', label: 'Quote', detail, tab: 'quote' })
  }

  if (canSeeMoney) {
    const ordered = (invoices ?? [])
      .filter((inv) => clean(inv.status).toLowerCase() !== 'void')
      .sort((a, b) => Number(a.sequence_number ?? 0) - Number(b.sequence_number ?? 0))
    for (const inv of ordered) {
      const title = clean(inv.title)
      const number = inv.sequence_number == null ? 'Invoice' : `Invoice ${inv.sequence_number}`
      const label = title ? `${number}, ${title}` : number
      const word = statusWord(inv.status)
      const due = shortDate(inv.due_at, now)
      const detail = word && due && clean(inv.status).toLowerCase() !== 'paid' ? `${word}, due ${due}` : word
      rows.push({ id: `invoice:${inv.id}`, label, detail, tab: 'financials' })
    }
  }

  const newest = [...(files ?? [])]
    .sort((a, b) => String(b.uploaded_at ?? '').localeCompare(String(a.uploaded_at ?? '')))
    .slice(0, MAX_FILE_ROWS)
  for (const f of newest) {
    const label = clean(f.filename)
    if (!label) continue
    rows.push({ id: `file:${f.id}`, label, detail: shortDate(f.uploaded_at, now), tab: 'files' })
  }

  return rows
}

/**
 * The teammates this job names: whoever an open task or a visit still
 * ahead is assigned to, each once. Visits and tasks nobody is assigned to
 * add no one.
 */
export function assignedCrewIds({ scheduleItems, todos, now }: {
  scheduleItems?: (RailNotesEvent & { assigned_to?: string | null })[] | null
  todos?: { assigned_to?: string | null; done?: boolean | null }[] | null
  now: Date
}): string[] {
  const ids = new Set<string>()
  for (const e of scheduleItems ?? []) {
    const end = toDate(e.end_at) ?? toDate(e.start_at)
    if (e.assigned_to && end && end.getTime() >= now.getTime()) ids.add(e.assigned_to)
  }
  for (const t of todos ?? []) {
    if (t.assigned_to && !t.done) ids.add(t.assigned_to)
  }
  return [...ids]
}
