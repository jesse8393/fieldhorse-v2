// Fieldhorse pipeline stages + auto-transitions
import { supabase } from './supabase.ts'
import { todayYmd } from './dates.ts'
import { crewLaborForContact } from './labor.ts'
import { moneyExact } from './format.ts'
import { invoicesPaidInFull } from './invoiceSettlement.ts'
import type { Database } from './database.types.ts'

// Only the fields the stage helpers actually read, declared narrowly so
// projected list rows (queries.ts JobRow) are valid inputs; a full
// fh_contacts Row remains assignable.
type Contact = Pick<
  Database['public']['Tables']['fh_contacts']['Row'],
  'id' | 'user_id' | 'stage' | 'name' | 'job_title' | 'address' | 'amount'
>

// Pipeline v2 (migration 047): the 'invoice' stage is retired. A record
// in lead/quote is a Lead; job/closed is a Job (every job is a won
// deal); lost is a dead lead. Invoicing is fh_invoices rows issued
// against a job, not a stage the whole job moves into. "Work done,
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
  // Legacy display entry only, never offered as a destination.
  invoice: { id: 'invoice', label: 'Invoice', color: 'var(--stage-invoice)', icon: 'invoice' }
}

// A Lead, its own thing now: own screen (/leads), own lifecycle.
// 'quote' is a lead with a quote in flight, not a separate entity.
export const LEAD_STAGES = ['lead', 'quote']
// A Job. 'invoice' included only as the legacy alias of 'job'.
export const JOB_STAGES = ['job', 'invoice']
// Won deals, every job is a won deal in the v2 model.
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

// Direct "Won" from the Leads board: move a lead/quote to Job WITHOUT
// auto-creating a kickoff schedule event. approveQuote (below) is the
// formal quote-approval path that also drops a kickoff; a one tap Won on
// a raw lead shouldn't silently schedule a job for tomorrow 9am.
export async function markWon(contact: Contact) {
  return transitionStage(contact, 'job')
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
  // firing, the operator is now on the Job stage either way.
  if (schedErr) {
    console.error('[fieldhorse] approveQuote schedule insert failed', schedErr)
  }

  return { data, error: null, scheduleError: schedErr ?? null }
}

// Work wrapped. Stays a 'job' (no more invoice stage), completed_at
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
  id?: string | null
}

export async function logPayment(contact: Contact, { id, amount, method, kind, reference, paid_on, invoice_id }: LogPaymentOpts) {
  const normalizedAmount = Number(amount) || 0
  const normalizedKind = ['deposit','progress','final','retainage','other'].includes(kind ?? '') ? (kind as string) : 'other'
  // Client-minted id makes the write idempotent: if the request commits but
  // the response is lost and the operator retaps, the sheet passes the SAME
  // id and the upsert no-ops instead of double-recording the payment (which
  // would inflate the balance and wrongly auto-close the job). Callers that
  // don't pass an id get a fresh one, safe, just not retry-dedup'd.
  const paymentId = id
    || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : undefined)
  const payload: Record<string, any> = {
    ...(paymentId ? { id: paymentId } : {}),
    user_id: contact.user_id,
    contact_id: contact.id,
    amount: normalizedAmount,
    method: method || 'check',
    // kind tags the payment for the invoice balance breakdown.
    // Whitelist-validated by the migration 022 check constraint;
    // defaults to 'other' so legacy callers stay valid.
    kind: normalizedKind,
    reference: reference || null,
    paid_on: paid_on || todayYmd(),
    // Optional pointer to the fh_invoices row this payment satisfies
    // (migration 047). Contact-level payments pass nothing.
    invoice_id: invoice_id || null
  }
  const { error: insErr } = await supabase
    .from('fh_payments')
    .upsert(payload as any, { onConflict: 'id', ignoreDuplicates: true })
  if (insErr) return { error: insErr }

  // Write a notification for the contractor's own inbox so the bell
  // badge pings when a payment is recorded (even if they recorded it
  // themselves, confirms the entry landed and surfaces on Activity).
  // Best-effort; never blocks the main return path.
  try {
    // Exact to the cent: a $1,234.50 payment must not read "$1,235".
    const money = moneyExact(normalizedAmount)
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
    // instead of swallowing, recurring failures here would signal an
    // RLS regression on fh_notifications that we should investigate.
    if (notifErr) {
      console.error('[fieldhorse] logPayment notification insert failed', notifErr)
    }
  } catch (e) {
    console.error('[fieldhorse] logPayment notification threw', e)
  }

  // Re-read everything the job's money depends on. Every read is scoped
  // to the job (contact_id) and left to RLS for the org: payments,
  // invoices and change orders carry whichever teammate created them, so
  // filtering on the job creator's user_id silently dropped rows (an
  // admin's invoice never settled, an admin's change order was missing
  // from the contract and the job auto-closed early).
  //
  // The true contract is the base amount PLUS approved change orders :
  // matching contractTotals()/statement math. Without the COs, a job with an
  // approved change order auto-closes on the base amount while CO money is
  // still owed, silently dropping it from statements and A/R.
  //
  // Re-read the contract amount rather than trusting the caller's
  // in-memory contact row, a quote edited moments earlier (or on
  // another device) could make a stale cached amount auto-close a job
  // that still owes money, or miss a close that should fire.
  const [paysRes, invsRes, cosRes, freshRes] = await Promise.all([
    supabase
      .from('fh_payments')
      .select('amount, invoice_id')
      .eq('contact_id', contact.id),
    supabase
      .from('fh_invoices')
      .select('id, amount, status, sequence_number')
      .eq('contact_id', contact.id),
    supabase
      .from('fh_change_orders')
      .select('amount, status')
      .eq('contact_id', contact.id)
      .eq('status', 'approved'),
    supabase
      .from('fh_contacts')
      .select('amount, stage')
      .eq('id', contact.id)
      .maybeSingle()
  ])
  const pays = paysRes.data || []
  const total = pays.reduce((s, p) => s + Number(p.amount || 0), 0)
  const coErr = cosRes.error
  const freshContact = freshRes.data
  const baseAmount = Number((freshContact?.amount ?? contact.amount) || 0)
  const currentStage = freshContact?.stage ?? contact.stage
  // If the CO fetch fails we can't know the true contract, so fail safe:
  // skip the auto-close rather than treat a failed fetch as "no COs" and
  // prematurely close a job that still owes change order money.
  const contractAmount = coErr
    ? null
    : baseAmount + (cosRes.data || []).reduce((s, c) => s + Number(c.amount || 0), 0)

  // Settle the job's invoices from its payments. A payment linked to an
  // invoice pays that one first; a payment logged against the job pays
  // open invoices oldest first, so a fully paid job no longer keeps a
  // 'sent' invoice that nags as past due (and invites a second payment
  // for the same money). An invoice only flips to 'paid' when payments
  // actually COVER it: partial pay is an explicit feature and must leave
  // a residual balance. Best-effort: the payment rows remain the source
  // of truth for money math either way.
  if (paysRes.error || invsRes.error) {
    console.error('[fieldhorse] logPayment invoice settle skipped', paysRes.error || invsRes.error)
  } else {
    const invs = invsRes.data || []
    const paidIds = invoicesPaidInFull({ invoices: invs, payments: pays, contractTotal: contractAmount })
    if (paidIds.length > 0) {
      const { error: paidErr } = await supabase
        .from('fh_invoices')
        .update({ status: 'paid' })
        .in('id', paidIds)
        .in('status', ['draft', 'sent', 'overdue'])
      if (paidErr) {
        console.error('[fieldhorse] logPayment invoice status update failed', paidErr)
      }
    }
    // A partial payment against a draft means the bill went out: it reads
    // 'sent' with a residual balance from here on.
    const target = invoice_id ? invs.find((inv) => inv.id === invoice_id) : null
    if (target && target.status === 'draft' && !paidIds.includes(target.id)) {
      const { error: sentErr } = await supabase
        .from('fh_invoices')
        .update({ status: 'sent' })
        .eq('id', target.id)
        .eq('status', 'draft')
      if (sentErr) {
        console.error('[fieldhorse] logPayment invoice status update failed', sentErr)
      }
    }
  }

  // Auto-close only when there's a real contract amount that's now fully
  // paid. Guarding on amount > 0 stops a job with no amount yet (e.g. a
  // freshly created quick invoice before line items set the total) from
  // auto-closing on its first payment, `total >= 0` is otherwise always true.
  let closed = false
  if (contractAmount != null) {
    if (contractAmount > 0 && total >= contractAmount && currentStage !== 'closed') {
      const { error: closeErr } = await supabase.from('fh_contacts').update({ stage: 'closed' }).eq('id', contact.id).eq('user_id', contact.user_id)
      closed = !closeErr
    }
  } else {
    console.error('[fieldhorse] logPayment approved-CO fetch failed; skipping auto-close', coErr)
  }
  return { total, closed }
}

export async function recalcCost(contactId: string | undefined, userId: string | undefined) {
  if (!contactId || !userId) return 0
  // The job OWNER anchors the labor split (lib/labor.ts skips the
  // owner's punches, their job-screen clock already books through
  // fh_expenses). Resolve it from the contact rather than assuming the
  // caller is the owner: when an admin/manager triggered a recalc, the
  // old code computed a garbage number from the caller's perspective
  // and then no-op'd the write behind a user_id filter.
  const { data: contactRow } = await supabase
    .from('fh_contacts')
    .select('id, user_id, org_id')
    .eq('id', contactId)
    .maybeSingle()
  const ownerId = contactRow?.user_id || userId
  // Crew and foreman can read only their own time punches, so a recalc
  // they trigger (clocking out, logging an expense) would write a cost
  // missing everyone else's labor. Leave the cached cost alone for them;
  // the next recalc by an owner, admin or manager (timesheet approval,
  // expense or sub edits) brings it up to date.
  if (contactRow?.org_id) {
    const { data: moneyVisible, error: visErr } = await supabase.rpc('fh_money_visible', { p_org_id: contactRow.org_id })
    if (!visErr && moneyVisible === false) return null
  }
  // No user_id filter on the sums: the job screen shows ALL fh_subs /
  // fh_expenses rows on the contact (org RLS), so the cached cost must
  // count them all too, filtering to the caller's own rows dropped
  // every sub/expense a different org member logged.
  const [{ data: subs }, { data: exps }, crewLabor] = await Promise.all([
    supabase
      .from('fh_subs')
      .select('rate')
      .eq('contact_id', contactId),
    supabase
      .from('fh_expenses')
      .select('amount')
      .eq('contact_id', contactId),
    // Crew clock ins (other org members' completed punches × their
    // hourly rate). The owner's own job-screen clock already lands in
    // fh_expenses as category='Labor', see lib/labor.ts for the split.
    crewLaborForContact(contactId, ownerId)
  ])
  const subsTotal = (subs || []).reduce((s, r) => s + Number(r.rate || 0), 0)
  const expsTotal = (exps || []).reduce((s, r) => s + Number(r.amount || 0), 0)
  const cost = subsTotal + expsTotal + crewLabor.cost
  await supabase.from('fh_contacts').update({ cost }).eq('id', contactId)
  return cost
}

export function margin(contact: { amount?: number | null; cost?: number | null } | null | undefined) {
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

// ─── detail routing ─────────────────────────────────────────────
// THE stage → detail-URL mapping. Work, the desktop rail, Home's
// pipeline, and universal search all consume this one function :
// the audit found five drifting inline copies of it.
//   opts.financials: land on the money tab (opt-in, Home's pipeline
//   uses it for invoice-age rows; list surfaces open the overview).
export function detailRoute(
  c: { id: string; stage?: string | null },
  opts?: { financials?: boolean }
) {
  const stage = String(c?.stage || '').toLowerCase()
  if (stage === 'lead' || stage === 'lost') return `/leads/${c.id}`
  if (stage === 'quote') return `/quotes/${c.id}?tab=quote`
  return opts?.financials ? `/jobs/${c.id}?tab=financials` : `/jobs/${c.id}`
}

// ─── list-card display vocabulary ───────────────────────────────
// Friendlier than the formal pipeline labels (job→Active, closed→Done)
//, used by every unified deal card (Work list, desktop rail). One map,
// or the rail and the card drift ("Complete" vs "Done", audit finding).
export const LIST_STAGE_META: Record<string, { label: string; color: string }> = {
  lead:    { label: 'Lead',   color: 'var(--v3-stage-lead)' },
  quote:   { label: 'Quote',  color: 'var(--v3-stage-quote)' },
  job:     { label: 'Active', color: 'var(--v3-stage-active)' },
  invoice: { label: 'Active', color: 'var(--v3-stage-active)' },
  // Done uses the stage-closed steel, NOT a second green, Active and
  // Done rendered as two near-identical greens, making in-progress vs
  // finished indistinguishable at a glance (UI audit #33). Green is
  // reserved for the in-progress money stage.
  closed:  { label: 'Done',   color: 'var(--v3-stage-closed)' },
  lost:    { label: 'Lost',   color: 'var(--v3-text-muted)' }
}
