// Fieldhorse pipeline stages + auto-transitions
import { supabase } from './supabase.ts'
import type { Database } from './database.types.ts'

type Contact = Database['public']['Tables']['fh_contacts']['Row']

// Pipeline v2 (migration 047): the 'invoice' stage is retired. A record
// in lead/quote is a Lead; job/closed is a Job (every job is a won
// deal); lost is a dead lead. Invoicing is fh_invoices rows issued
// against a job — not a stage the whole job moves into. "Work done,
// money out" is contact.completed_at. The legacy 'invoice' value stays
// in the type + maps so pre-migration rows and old stage-transition
// history still render; treat it as a synonym of 'job' everywhere.
export type StageId = 'lead' | 'quote' | 'job' | 'invoice' | 'closed' | 'lost'

export type Stage = { id: StageId; label: string; color: string; icon: string }

export const STAGES: Stage[] = [
  { id: 'lead',    label: 'Lead',    color: 'var(--stage-lead)',    icon: 'lead' },
  { id: 'quote',   label: 'Quote',   color: 'var(--stage-quote)',   icon: 'quote' },
  { id: 'job',     label: 'Job',     color: 'var(--stage-job)',     icon: 'job' },
  { id: 'closed',  label: 'Closed',  color: 'var(--stage-closed)',  icon: 'closed' },
  { id: 'lost',    label: 'Lost',    color: 'var(--stage-lost)',    icon: 'lost' }
]

export const STAGE_MAP: Record<string, Stage> = {
  ...Object.fromEntries(STAGES.map((s) => [s.id, s])),
  // Legacy display entry only — never offered as a destination.
  invoice: { id: 'invoice', label: 'Invoice', color: 'var(--stage-invoice)', icon: 'invoice' }
}

// A Lead — its own thing now: own screen (/leads), own lifecycle.
// 'quote' is a lead with a quote in flight, not a separate entity.
export const LEAD_STAGES = ['lead', 'quote']
// A Job. 'invoice' included only as the legacy alias of 'job'.
export const JOB_STAGES = ['job', 'invoice']
// Won deals — every job is a won deal in the v2 model.
export const WON_STAGES = ['job', 'invoice', 'closed']
// Everything still in motion (open leads + active jobs).
export const ACTIVE_STAGES = ['lead', 'quote', 'job', 'invoice']

export function isLeadStage(stage: string | null | undefined) {
  return LEAD_STAGES.includes(stage || '')
}

export function isJobStage(stage: string | null | undefined) {
  return JOB_STAGES.includes(stage || '')
}

export function stageColor(id: string): string {
  return STAGE_MAP[id]?.color || 'var(--steel)'
}

export function stageLabel(id: string): string {
  return STAGE_MAP[id]?.label || id
}

// Transitions
export async function transitionStage(contact: Contact, nextStage: StageId) {
  const patch = { stage: nextStage }
  const { data, error } = await supabase
    .from('fh_contacts')
    .update(patch)
    .eq('id', contact.id)
    .eq('user_id', contact.user_id)
    .select()
    .single()
  return { data, error }
}

export async function startQuote(contact: Contact) {
  return transitionStage(contact, 'quote')
}

export async function approveQuote(contact: Contact) {
  const { data, error } = await transitionStage(contact, 'job')
  if (error) return { data, error, scheduleError: null }

  // Default the kickoff to tomorrow 9am–5pm local. Operator can edit later.
  const start = new Date()
  start.setDate(start.getDate() + 1)
  start.setHours(9, 0, 0, 0)
  const end = new Date(start)
  end.setHours(17, 0, 0, 0)

  const title = contact.job_title || contact.name || 'New job'
  const description = `Approved quote for ${contact.name || 'job'}${contact.address ? ` at ${contact.address}` : ''}`

  const { error: schedErr } = await supabase.from('fh_schedule').insert({
    user_id: contact.user_id,
    contact_id: contact.id,
    title,
    description,
    start_at: start.toISOString(),
    end_at: end.toISOString()
  })
  // Secondary failure: the stage transition succeeded but the kickoff
  // event didn't land. Log loudly (so it surfaces in monitoring) and
  // surface `scheduleError` to callers who want to flag the partial
  // success. The primary `error` stays null so the success toast keeps
  // firing — the operator is now on the Job stage either way.
  if (schedErr) {
    console.error('[fieldhorse] approveQuote schedule insert failed', schedErr)
  }

  return { data, error: null, scheduleError: schedErr ?? null }
}

// Work wrapped. Stays a 'job' (no more invoice stage) — completed_at
// flags "done, awaiting payment" so the money screens can chase the
// balance. Paying off the balance still auto-closes via logPayment.
export async function completeJob(contact: Contact) {
  const { data, error } = await supabase
    .from('fh_contacts')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', contact.id)
    .eq('user_id', contact.user_id)
    .select()
    .single()
  return { data, error }
}

export async function markLost(contact: Contact) {
  return transitionStage(contact, 'lost')
}

type LogPaymentOpts = {
  amount?: number | string | null
  method?: string | null
  kind?: string | null
  reference?: string | null
  paid_on?: string | null
  invoice_id?: string | null
}

export async function logPayment(contact: Contact, { amount, method, kind, reference, paid_on, invoice_id }: LogPaymentOpts) {
  const normalizedAmount = Number(amount) || 0
  const normalizedKind = ['deposit','progress','final','retainage','other'].includes(kind ?? '') ? (kind as string) : 'other'
  const payload = {
    user_id: contact.user_id,
    contact_id: contact.id,
    amount: normalizedAmount,
    method: method || 'check',
    // kind tags the payment for the invoice balance breakdown.
    // Whitelist-validated by the migration 022 check constraint;
    // defaults to 'other' so legacy callers stay valid.
    kind: normalizedKind,
    reference: reference || null,
    paid_on: paid_on || new Date().toISOString().slice(0, 10),
    // Optional pointer to the fh_invoices row this payment satisfies
    // (migration 047). Contact-level payments pass nothing.
    invoice_id: invoice_id || null
  }
  const { error: insErr } = await supabase.from('fh_payments').insert(payload)
  if (insErr) return { error: insErr }

  // Payment against a specific invoice settles that invoice. Best-effort:
  // the payment row is the source of truth for money math either way.
  if (invoice_id) {
    const { error: invErr } = await supabase
      .from('fh_invoices')
      .update({ status: 'paid' })
      .eq('id', invoice_id)
      .eq('user_id', contact.user_id)
    if (invErr) {
      console.error('[fieldhorse] logPayment invoice status update failed', invErr)
    }
  }

  // Write a notification for the contractor's own inbox so the bell
  // badge pings when a payment is recorded (even if they recorded it
  // themselves — confirms the entry landed and surfaces on Activity).
  // Best-effort; never blocks the main return path.
  try {
    const money = normalizedAmount.toLocaleString(undefined, {
      style: 'currency', currency: 'USD',
      minimumFractionDigits: 0, maximumFractionDigits: 0
    })
    const kindTag = normalizedKind !== 'other' ? ` · ${normalizedKind}` : ''
    const { error: notifErr } = await supabase.from('fh_notifications').insert({
      user_id: contact.user_id,
      kind: 'payment_received',
      title: `Payment received · ${money}`,
      body: `${contact.name || 'Client'}${kindTag}`,
      link: `/jobs/${contact.id}?tab=financials`
    })
    // Best-effort: the payment row above is the source of truth, so a
    // missing bell-badge entry doesn't break anything. But log it
    // instead of swallowing — recurring failures here would signal an
    // RLS regression on fh_notifications that we should investigate.
    if (notifErr) {
      console.error('[fieldhorse] logPayment notification insert failed', notifErr)
    }
  } catch (e) {
    console.error('[fieldhorse] logPayment notification threw', e)
  }

  // Re-check balance
  const { data: pays } = await supabase
    .from('fh_payments')
    .select('amount')
    .eq('contact_id', contact.id)
    .eq('user_id', contact.user_id)
  const total = (pays || []).reduce((s, p) => s + Number(p.amount || 0), 0)
  // Auto-close only when there's a real contract amount that's now fully
  // paid. Guarding on amount > 0 stops a job with no amount yet (e.g. a
  // freshly created quick invoice before line items set the total) from
  // auto-closing on its first payment — `total >= 0` is otherwise always true.
  const contractAmount = Number(contact.amount || 0)
  if (contractAmount > 0 && total >= contractAmount && contact.stage !== 'closed') {
    await supabase.from('fh_contacts').update({ stage: 'closed' }).eq('id', contact.id).eq('user_id', contact.user_id)
  }
  return { total }
}

export async function recalcCost(contactId: string | undefined, userId: string | undefined) {
  if (!contactId || !userId) return 0
  const { data: subs } = await supabase
    .from('fh_subs')
    .select('rate')
    .eq('contact_id', contactId)
    .eq('user_id', userId)
  const { data: exps } = await supabase
    .from('fh_expenses')
    .select('amount')
    .eq('contact_id', contactId)
    .eq('user_id', userId)
  const subsTotal = (subs || []).reduce((s, r) => s + Number(r.rate || 0), 0)
  const expsTotal = (exps || []).reduce((s, r) => s + Number(r.amount || 0), 0)
  const cost = subsTotal + expsTotal
  await supabase.from('fh_contacts').update({ cost }).eq('id', contactId).eq('user_id', userId)
  return cost
}

export function margin(contact: Pick<Contact, 'amount' | 'cost'> | null | undefined) {
  const amt = Number(contact?.amount || 0)
  const cost = Number(contact?.cost || 0)
  if (!amt) return 0
  return ((amt - cost) / amt) * 100
}

export function marginTier(pct: number) {
  if (pct >= 30) return 'good'
  if (pct >= 15) return 'warn'
  return 'thin'
}
