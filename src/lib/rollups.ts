// Money rollups, single source of truth for "lifetime / outstanding /
// active" computations across Clients list, Client detail, Home KPIs,
// and Analytics. Two earlier divergences (Clients-list said $0 lifetime
// while Client-detail said $62K, Analytics said Won YTD $0 while Jobs
// list showed Won 2) both came from per-screen ad-hoc aggregations.
// Centralize here so the four surfaces can never drift again.

import { parseDateOnly } from './dates.ts'

// Structural inputs, callers pass full fh_contacts / fh_payments rows
// or partial picks of them, so these list only the fields read here and
// keep every field optional/nullable.
type JobRow = {
  id?: string | null
  client_id?: string | null
  amount?: number | string | null
  cost?: number | string | null
  stage?: string | null
  updated_at?: string | null
}
type PaymentRow = {
  contact_id?: string | null
  amount?: number | string | null
}
type ChangeOrderRow = {
  contact_id?: string | null
  amount?: number | string | null
  status?: string | null
}

export type JobRollup = {
  lifetime: number
  outstanding: number
  activeCount: number
  wonCount: number
  paidTotal: number
}

// Pipeline v2: 'invoice' survives in these sets only as the legacy
// alias of 'job' (pre-migration rows). Every job is a won deal now :
// a converted lead counts as won the moment it becomes a job.
//
// BILLING_STAGES includes 'closed': a job moved to Closed with money
// still owed (the Mark Complete sheet never checks the balance) must
// keep showing in "outstanding", statements and the A/R screen count
// it, so the list rollups must too or the surfaces disagree.
const BILLING_STAGES = new Set(['job', 'invoice', 'closed'])
const ACTIVE_PIPELINE_STAGES = new Set(['lead', 'quote', 'job', 'invoice'])
const WON_STAGES = new Set(['job', 'invoice', 'closed'])

// Sum of APPROVED change orders per contact. Same rule as
// statement.ts's approvedCoByContact, approved COs adjust the true
// contract, pending/declined ones don't.
function coByContact(changeOrders: ChangeOrderRow[] | null | undefined) {
  const m = new Map<string, number>()
  for (const co of changeOrders || []) {
    if (co?.status !== 'approved' || !co.contact_id) continue
    m.set(co.contact_id, (m.get(co.contact_id) || 0) + Number(co.amount || 0))
  }
  return m
}

// Sum payments per contact_id from a flat fh_payments array.
function paidByContact(payments: PaymentRow[] | null | undefined) {
  const m = new Map<string, number>()
  for (const p of payments || []) {
    if (!p.contact_id) continue
    m.set(p.contact_id, (m.get(p.contact_id) || 0) + Number(p.amount || 0))
  }
  return m
}

// Roll up a list of jobs (fh_contacts rows) + payments into the bento
// metrics every client surface displays.
//
//   { lifetime, outstanding, activeCount, wonCount, paidTotal }
//
// lifetime   , sum of job amounts for WON deals (job/invoice/closed).
//               Lost bids and raw leads are money that never existed;
//               counting them made a client with one $2K job and a $9K
//               lost bid read "Lifetime $11K".
// outstanding, sum of (contract - paid) per job for jobs in billing
//               stages (job/invoice/closed), where contract = amount +
//               approved change orders. This is the SAME definition the
//               Invoices screen and client statements use, so all three
//               surfaces agree. Balances of ≤ $0.50 are ignored, same
//               as statement.ts, so rounding dust never bills.
// activeCount, count of jobs in any active pipeline stage.
// wonCount   , count of won deals: stage in (job, closed), plus the
//               legacy 'invoice' alias.
// paidTotal  , sum of all payments received against these jobs.
export function rollupJobs(
  jobs: JobRow[] | null | undefined,
  payments: PaymentRow[] | null | undefined,
  changeOrders: ChangeOrderRow[] | null | undefined = []
): JobRollup {
  const paidMap = paidByContact(payments)
  const coMap = coByContact(changeOrders)
  let lifetime = 0
  let outstanding = 0
  let activeCount = 0
  let wonCount = 0
  let paidTotal = 0
  for (const j of jobs || []) {
    const amount = Number(j.amount || 0)
    const stage = j.stage || ''
    if (ACTIVE_PIPELINE_STAGES.has(stage)) activeCount += 1
    if (WON_STAGES.has(stage)) {
      wonCount += 1
      lifetime += amount + (coMap.get(j.id || '') || 0)
    }
    if (BILLING_STAGES.has(stage)) {
      const contract = amount + (coMap.get(j.id || '') || 0)
      const bal = contract - (paidMap.get(j.id || '') || 0)
      if (bal > 0.5) outstanding += bal
    }
  }
  for (const p of payments || []) paidTotal += Number(p.amount || 0)
  return { lifetime, outstanding, activeCount, wonCount, paidTotal }
}

// Group rollupJobs() by client_id. Returns Map<client_id, rollup>.
// Used by Clients list to render per-row lifetime/outstanding/active
// without 60 round-trips.
export function rollupByClient(
  jobs: JobRow[] | null | undefined,
  payments: PaymentRow[] | null | undefined,
  changeOrders: ChangeOrderRow[] | null | undefined = []
) {
  const byClient = new Map<string, JobRollup>()
  // Bucket jobs by client_id.
  const jobsByClient = new Map<string, JobRow[]>()
  for (const j of jobs || []) {
    if (!j.client_id) continue
    const arr = jobsByClient.get(j.client_id) || []
    arr.push(j)
    jobsByClient.set(j.client_id, arr)
  }
  // Bucket payments and change orders by client via the job they hit.
  const jobToClient = new Map<string, string>()
  for (const j of jobs || []) {
    if (j.client_id && j.id) jobToClient.set(j.id, j.client_id)
  }
  const paysByClient = new Map<string, PaymentRow[]>()
  for (const p of payments || []) {
    const cid = p.contact_id ? jobToClient.get(p.contact_id) : undefined
    if (!cid) continue
    const arr = paysByClient.get(cid) || []
    arr.push(p)
    paysByClient.set(cid, arr)
  }
  const cosByClient = new Map<string, ChangeOrderRow[]>()
  for (const co of changeOrders || []) {
    const cid = co.contact_id ? jobToClient.get(co.contact_id) : undefined
    if (!cid) continue
    const arr = cosByClient.get(cid) || []
    arr.push(co)
    cosByClient.set(cid, arr)
  }
  for (const [cid, jArr] of jobsByClient) {
    byClient.set(cid, rollupJobs(jArr, paysByClient.get(cid) || [], cosByClient.get(cid) || []))
  }
  return byClient
}

// Year-to-date filter helper. Pass a date column name (e.g. "updated_at"
// for jobs or "paid_on" for payments). Used by Analytics for YTD numbers.
// Date-only values ("year month day", e.g. paid_on) parse as LOCAL midnight :
// a raw new Date() parse lands them at UTC midnight, which is Dec 31 of
// last year in every US timezone, silently dropping Jan-1 rows from YTD.
export function filterYTD<T extends Record<string, unknown>>(rows: T[] | null | undefined, dateField: string, now = new Date()): T[] {
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime()
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
  return (rows || []).filter((r) => {
    const v = r?.[dateField]
    if (!v) return false
    const d = parseDateOnly(v as string)
    return d != null && d.getTime() >= yearStart && d.getTime() < tomorrow
  })
}

type TransitionRow = {
  contact_id: string
  to_stage: string
  transitioned_at: string
}

// Resolve when each contact was WON: the first transition into a won
// stage from the audit log (migration 023). Jobs edited later keep
// their true win date, filtering by updated_at re-booked a $50K job
// closed last year into this year's totals whenever a typo was fixed.
function wonAtByContact(transitions: TransitionRow[] | null | undefined) {
  const m = new Map<string, number>()
  for (const t of transitions || []) {
    if (!WON_STAGES.has(t.to_stage)) continue
    const at = new Date(t.transitioned_at).getTime()
    if (!Number.isFinite(at)) continue
    const prev = m.get(t.contact_id)
    if (prev == null || at < prev) m.set(t.contact_id, at)
  }
  return m
}

// Filter won jobs to those won this calendar year. Uses the transition
// log when the job appears in it; falls back to updated_at for legacy
// jobs that predate the audit log.
function wonThisYear(jobs: JobRow[] | null | undefined, transitions: TransitionRow[] | null | undefined, now: Date) {
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime()
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
  const wonAt = wonAtByContact(transitions)
  return (jobs || []).filter((j) => {
    if (!WON_STAGES.has(j.stage || '')) return false
    const anchor = (j.id ? wonAt.get(j.id) : undefined) ?? parseDateOnly(j.updated_at)?.getTime() ?? NaN
    return Number.isFinite(anchor) && anchor >= yearStart && anchor < tomorrow
  })
}

// Profit YTD = sum of (amount - cost) for jobs won this calendar year.
// Losses subtract, clamping each job at 0 overstated profit by hiding
// every over-budget job. A job with no cost recorded still counts its
// full amount (cost 0 is indistinguishable from "not tracked" here;
// Analytics' avg-margin note covers that caveat).
export function profitYTD(jobs: JobRow[] | null | undefined, transitions: TransitionRow[] | null | undefined = null, now = new Date()) {
  return wonThisYear(jobs, transitions, now).reduce((s, j) => {
    const amount = Number(j.amount || 0)
    const cost = Number(j.cost || 0)
    return s + (amount - cost)
  }, 0)
}

// A missing/zero cost cannot distinguish untracked cost from a true zero.
// Report the observed sample explicitly instead of treating every uncosted
// job as pure profit. Keep legacy profitYTD callers unchanged.
export function profitCoverageYTD(jobs: JobRow[] | null | undefined, transitions: TransitionRow[] | null | undefined = null, now = new Date()) {
  const won = wonThisYear(jobs, transitions, now)
  const costed = won.filter((j) => Number(j.cost) > 0 && Number.isFinite(Number(j.cost)))
  return {
    profit: costed.length ? costed.reduce((sum, j) => sum + Number(j.amount || 0) - Number(j.cost), 0) : null,
    costed: costed.length,
    total: won.length,
    missing: won.length - costed.length
  }
}

// Won YTD = sum of amount for jobs that hit a won stage this year.
export function wonYTD(jobs: JobRow[] | null | undefined, transitions: TransitionRow[] | null | undefined = null, now = new Date()) {
  return wonThisYear(jobs, transitions, now).reduce((s, j) => s + Number(j.amount || 0), 0)
}

// Close rate = won / (won + lost) over jobs that have hit a terminal
// stage. Returns 0..1 (Analytics formats as %).
export function closeRate(jobs: JobRow[] | null | undefined) {
  let won = 0
  let lost = 0
  for (const j of jobs || []) {
    if (WON_STAGES.has(j.stage || '')) won += 1
    else if (j.stage === 'lost') lost += 1
  }
  const total = won + lost
  return total === 0 ? 0 : won / total
}

// Avg margin across won jobs = mean of (amount - cost) / amount.
export function avgMargin(jobs: JobRow[] | null | undefined) {
  const won = (jobs || []).filter((j) => WON_STAGES.has(j.stage || '') && Number(j.amount) > 0)
  if (won.length === 0) return 0
  const sum = won.reduce((s, j) => {
    const a = Number(j.amount || 0)
    const c = Number(j.cost || 0)
    return s + (a - c) / a
  }, 0)
  return sum / won.length
}

// ---------------------------------------------------------------------
// Sales funnel over a trailing window, read from the records themselves
// (Phase 9, D53 and D54): leads on fh_leads, quotes on fh_quotes, and the
// job a quote became through fh_quotes.job_id. Counts are distinct
// records.
export type FunnelStats = {
  newLeads: number          // leads created in the window
  quoted: number            // quotes created in the window
  won: number               // quotes whose job was created in the window
  lost: number              // leads lost and quotes lost, rejected or expired in the window
  quoteRate: number         // quoted / newLeads, 0..1
  winRate: number           // won / (won + lost), 0..1
  avgDaysToDecision: number // quote created to its job created, or to its loss, days
}

type FunnelLead = { status?: string | null; created_at?: string | null; updated_at?: string | null }
type FunnelQuote = { id?: string | null; status?: string | null; job_id?: string | null; created_at?: string | null; updated_at?: string | null }
type FunnelJob = { id?: string | null; created_at?: string | null }

export type FunnelSource = {
  leads: FunnelLead[] | null | undefined
  quotes: FunnelQuote[] | null | undefined
  /** The jobs (fh_contacts rows), for when each quote's job was made. */
  jobs?: FunnelJob[] | null | undefined
}

const LOST_QUOTE_STATUSES = new Set(['lost', 'rejected', 'expired'])

function timeOf(iso: string | null | undefined): number {
  const t = iso ? new Date(iso).getTime() : NaN
  return Number.isFinite(t) ? t : NaN
}

export function computeFunnel(
  source: FunnelSource,
  windowDays = 90,
  now = new Date()
): FunnelStats {
  const cutoff = now.getTime() - windowDays * 86400000
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
  const inWindow = (t: number) => Number.isFinite(t) && t >= cutoff && t < tomorrow

  const leads = source.leads || []
  const quotes = source.quotes || []
  const jobMadeAt = new Map<string, number>()
  for (const j of source.jobs || []) {
    if (j.id) jobMadeAt.set(j.id, timeOf(j.created_at))
  }

  const newLeads = leads.filter((l) => inWindow(timeOf(l.created_at))).length
  let lost = leads.filter((l) => l.status === 'lost' && inWindow(timeOf(l.updated_at))).length

  let quoted = 0
  let won = 0
  let daysSum = 0
  let daysN = 0
  for (const q of quotes) {
    const made = timeOf(q.created_at)
    if (inWindow(made)) quoted += 1
    // Decided: it became a job (when that job was made, else when the
    // quote last changed), or it was lost.
    let decidedAt = NaN
    let outcome: 'won' | 'lost' | null = null
    if (q.job_id) {
      const jobAt = jobMadeAt.get(q.job_id)
      decidedAt = Number.isFinite(jobAt as number) ? (jobAt as number) : timeOf(q.updated_at)
      outcome = 'won'
    } else if (LOST_QUOTE_STATUSES.has(q.status || '')) {
      decidedAt = timeOf(q.updated_at)
      outcome = 'lost'
    }
    if (!outcome || !inWindow(decidedAt)) continue
    if (outcome === 'won') won += 1
    else lost += 1
    if (Number.isFinite(made) && decidedAt >= made) {
      daysSum += (decidedAt - made) / 86400000
      daysN += 1
    }
  }

  return {
    newLeads,
    quoted,
    won,
    lost,
    quoteRate: newLeads === 0 ? 0 : Math.min(1, quoted / newLeads),
    winRate: won + lost === 0 ? 0 : won / (won + lost),
    avgDaysToDecision: daysN === 0 ? 0 : daysSum / daysN
  }
}
