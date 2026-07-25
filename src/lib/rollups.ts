// Money rollups — single source of truth for "lifetime / outstanding /
// active" computations across Clients list, Client detail, Home KPIs,
// and Analytics. Two earlier divergences (Clients-list said $0 lifetime
// while Client-detail said $62K, Analytics said Won YTD $0 while Jobs
// list showed Won 2) both came from per-screen ad-hoc aggregations.
// Centralize here so the four surfaces can never drift again.

import { parseDateOnly } from './dates.ts'

// Structural inputs — callers pass full fh_contacts / fh_payments rows
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
// alias of 'job' (pre-migration rows). Every job is a won deal now —
// a converted lead counts as won the moment it becomes a job.
//
// BILLING_STAGES includes 'closed': a job moved to Closed with money
// still owed (the Mark Complete sheet never checks the balance) must
// keep showing in "outstanding" — statements and the A/R screen count
// it, so the list rollups must too or the surfaces disagree.
const BILLING_STAGES = new Set(['job', 'invoice', 'closed'])
const ACTIVE_PIPELINE_STAGES = new Set(['lead', 'quote', 'job', 'invoice'])
const WON_STAGES = new Set(['job', 'invoice', 'closed'])

// Sum of APPROVED change orders per contact. Same rule as
// statement.ts's approvedCoByContact — approved COs adjust the true
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
// lifetime    — sum of job amounts for WON deals (job/invoice/closed).
//               Lost bids and raw leads are money that never existed;
//               counting them made a client with one $2K job and a $9K
//               lost bid read "Lifetime $11K".
// outstanding — sum of (contract - paid) per job for jobs in billing
//               stages (job/invoice/closed), where contract = amount +
//               approved change orders. This is the SAME definition the
//               Invoices screen and client statements use, so all three
//               surfaces agree. Balances of ≤ $0.50 are ignored, same
//               as statement.ts, so rounding dust never bills.
// activeCount — count of jobs in any active pipeline stage.
// wonCount    — count of won deals: stage in (job, closed) — plus the
//               legacy 'invoice' alias.
// paidTotal   — sum of all payments received against these jobs.
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
// Date-only values ("YYYY-MM-DD", e.g. paid_on) parse as LOCAL midnight —
// a raw new Date() parse lands them at UTC midnight, which is Dec 31 of
// last year in every US timezone, silently dropping Jan-1 rows from YTD.
export function filterYTD<T extends Record<string, unknown>>(rows: T[] | null | undefined, dateField: string, now = new Date()): T[] {
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime()
  return (rows || []).filter((r) => {
    const v = r?.[dateField]
    if (!v) return false
    const d = parseDateOnly(v as string)
    return d != null && d.getTime() >= yearStart
  })
}

// Resolve when each contact was WON: the first transition into a won
// stage from the audit log (migration 023). Jobs edited later keep
// their true win date — filtering by updated_at re-booked a $50K job
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
  const wonAt = wonAtByContact(transitions)
  return (jobs || []).filter((j) => {
    if (!WON_STAGES.has(j.stage || '')) return false
    const anchor = (j.id ? wonAt.get(j.id) : undefined) ?? parseDateOnly(j.updated_at)?.getTime() ?? NaN
    return Number.isFinite(anchor) && anchor >= yearStart
  })
}

// Profit YTD = sum of (amount - cost) for jobs won this calendar year.
// Losses subtract — clamping each job at 0 overstated profit by hiding
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
// Sales funnel over a trailing window, computed from the stage-
// transition audit log (migration 023) + contact created_at dates.
// Counts are distinct contacts, not transition rows, so a lead bounced
// back and re-quoted only counts once.
export type FunnelStats = {
  newLeads: number          // contacts created in the window
  quoted: number            // distinct contacts that hit 'quote'
  won: number               // distinct contacts that hit 'job' (won)
  lost: number              // distinct contacts that hit 'lost'
  quoteRate: number         // quoted / newLeads, 0..1
  winRate: number           // won / (won + lost), 0..1
  avgDaysToDecision: number // first 'quote' → first 'job'/'lost', days
}

type TransitionRow = {
  contact_id: string
  to_stage: string
  transitioned_at: string
}

export function computeFunnel(
  transitions: TransitionRow[] | null | undefined,
  contacts: Record<string, unknown>[] | null | undefined,
  windowDays = 90,
  now = new Date()
): FunnelStats {
  const cutoff = new Date(now.getTime() - windowDays * 86400000)

  const newLeads = (contacts || []).filter((c) => {
    const created = new Date(String(c.created_at || ''))
    return !Number.isNaN(created.getTime()) && created >= cutoff
  }).length

  const quotedSet = new Set<string>()
  const wonSet = new Set<string>()
  const lostSet = new Set<string>()
  // Per contact: the LATEST decision (won/lost) inside the window wins.
  // Counting a contact in both sets (lost in May, reopened and won in
  // June) double-counted it in winRate's denominator.
  const latestDecision = new Map<string, { stage: 'job' | 'lost'; at: number }>()
  // Per contact: first quote time + first decision (won/lost) AFTER it.
  const firstQuote = new Map<string, number>()
  const firstDecisionAfterQuote = new Map<string, number>()

  for (const t of transitions || []) {
    const at = new Date(t.transitioned_at)
    if (Number.isNaN(at.getTime())) continue
    const inWindow = at >= cutoff
    if (t.to_stage === 'quote') {
      if (inWindow) quotedSet.add(t.contact_id)
      if (!firstQuote.has(t.contact_id)) firstQuote.set(t.contact_id, at.getTime())
    } else if (t.to_stage === 'job' || t.to_stage === 'lost') {
      if (inWindow) {
        const prev = latestDecision.get(t.contact_id)
        if (!prev || at.getTime() >= prev.at) {
          latestDecision.set(t.contact_id, { stage: t.to_stage, at: at.getTime() })
        }
      }
      noteDecision(t.contact_id, at.getTime())
    }
  }
  for (const [id, d] of latestDecision) {
    if (d.stage === 'job') wonSet.add(id)
    else lostSet.add(id)
  }

  function noteDecision(id: string, time: number) {
    const q = firstQuote.get(id)
    if (q == null || time < q) return
    if (!firstDecisionAfterQuote.has(id)) firstDecisionAfterQuote.set(id, time)
  }

  let daysSum = 0
  let daysN = 0
  for (const [id, decidedAt] of firstDecisionAfterQuote) {
    const q = firstQuote.get(id)
    if (q == null) continue
    // Only average decisions inside the window so ancient history
    // doesn't skew "how fast do customers answer me lately".
    if (decidedAt < cutoff.getTime()) continue
    daysSum += (decidedAt - q) / 86400000
    daysN += 1
  }

  const won = wonSet.size
  const lost = lostSet.size
  return {
    newLeads,
    quoted: quotedSet.size,
    won,
    lost,
    quoteRate: newLeads === 0 ? 0 : Math.min(1, quotedSet.size / newLeads),
    winRate: won + lost === 0 ? 0 : won / (won + lost),
    avgDaysToDecision: daysN === 0 ? 0 : daysSum / daysN
  }
}
