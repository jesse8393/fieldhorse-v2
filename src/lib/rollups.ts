// Money rollups — single source of truth for "lifetime / outstanding /
// active" computations across Clients list, Client detail, Home KPIs,
// and Analytics. Two earlier divergences (Clients-list said $0 lifetime
// while Client-detail said $62K, Analytics said Won YTD $0 while Jobs
// list showed Won 2) both came from per-screen ad-hoc aggregations.
// Centralize here so the four surfaces can never drift again.

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

export type JobRollup = {
  lifetime: number
  outstanding: number
  activeCount: number
  wonCount: number
  paidTotal: number
}

const ACTIVE_BILLING_STAGES = new Set(['job', 'invoice'])
const ACTIVE_PIPELINE_STAGES = new Set(['lead', 'quote', 'job', 'invoice'])
const WON_STAGES = new Set(['invoice', 'closed'])

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
// lifetime    — sum of every job amount, all stages. Matches the user's
//               mental model of "all the work I've done with this client."
// outstanding — sum of (amount - paid), clipped at 0, only for jobs in
//               billing stages (job + invoice). Closed/lost drop out.
//               Known divergence: this uses raw fh_contacts.amount and
//               does NOT add approved change-order adjustments the way
//               InvoiceDrawsSection / InvoiceTemplate do, so a job with
//               approved COs reports a smaller outstanding here than on
//               the invoice screen. Acceptable for list rollups today;
//               revisit if COs become a primary balance driver.
// activeCount — count of jobs in any active pipeline stage.
// wonCount    — count of jobs where stage in (invoice, closed).
// paidTotal   — sum of all payments received against these jobs.
export function rollupJobs(jobs: JobRow[] | null | undefined, payments: PaymentRow[] | null | undefined): JobRollup {
  const paidMap = paidByContact(payments)
  let lifetime = 0
  let outstanding = 0
  let activeCount = 0
  let wonCount = 0
  let paidTotal = 0
  for (const j of jobs || []) {
    const amount = Number(j.amount || 0)
    const stage = j.stage || ''
    lifetime += amount
    if (ACTIVE_PIPELINE_STAGES.has(stage)) activeCount += 1
    if (WON_STAGES.has(stage)) wonCount += 1
    if (ACTIVE_BILLING_STAGES.has(stage)) {
      const bal = amount - (paidMap.get(j.id || '') || 0)
      outstanding += Math.max(0, bal)
    }
  }
  for (const p of payments || []) paidTotal += Number(p.amount || 0)
  return { lifetime, outstanding, activeCount, wonCount, paidTotal }
}

// Group rollupJobs() by client_id. Returns Map<client_id, rollup>.
// Used by Clients list to render per-row lifetime/outstanding/active
// without 60 round-trips.
export function rollupByClient(jobs: JobRow[] | null | undefined, payments: PaymentRow[] | null | undefined) {
  const byClient = new Map<string, JobRollup>()
  // Bucket jobs by client_id.
  const jobsByClient = new Map<string, JobRow[]>()
  for (const j of jobs || []) {
    if (!j.client_id) continue
    const arr = jobsByClient.get(j.client_id) || []
    arr.push(j)
    jobsByClient.set(j.client_id, arr)
  }
  // Bucket payments by client via the job they hit.
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
  for (const [cid, jArr] of jobsByClient) {
    byClient.set(cid, rollupJobs(jArr, paysByClient.get(cid) || []))
  }
  return byClient
}

// Year-to-date filter helper. Pass a date column name (e.g. "updated_at"
// for jobs or "paid_on" for payments). Used by Analytics for YTD numbers.
export function filterYTD<T extends Record<string, unknown>>(rows: T[] | null | undefined, dateField: string, now = new Date()): T[] {
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime()
  return (rows || []).filter((r) => {
    const v = r?.[dateField]
    if (!v) return false
    const t = new Date(v as string).getTime()
    return Number.isFinite(t) && t >= yearStart
  })
}

// Profit YTD = sum of (amount - cost) for won jobs whose updated_at
// falls in this calendar year. Falls back to amount when cost is null.
export function profitYTD(jobs: JobRow[] | null | undefined, now = new Date()) {
  const wonThisYear = filterYTD(jobs as Record<string, unknown>[], 'updated_at', now).filter((j) => WON_STAGES.has((j.stage as string) || ''))
  return wonThisYear.reduce((s, j) => {
    const amount = Number(j.amount || 0)
    const cost = Number(j.cost || 0)
    return s + Math.max(0, amount - cost)
  }, 0)
}

// Won YTD = sum of amount for jobs that hit a won stage this year.
export function wonYTD(jobs: JobRow[] | null | undefined, now = new Date()) {
  const wonThisYear = filterYTD(jobs as Record<string, unknown>[], 'updated_at', now).filter((j) => WON_STAGES.has((j.stage as string) || ''))
  return wonThisYear.reduce((s, j) => s + Number(j.amount || 0), 0)
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
