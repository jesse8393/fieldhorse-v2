import { lazy, Suspense, useMemo } from 'react'
import { useInvoicesBundle, useInvalidateInvoices } from '../lib/queries.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import DataErrorState from '../components/DataErrorState.tsx'
import { approvedCoByContact } from '../lib/statement.ts'
import { parseDateOnly } from '../lib/dates.ts'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useIsDesktop } from '../lib/useMediaQuery.ts'
import { useNow } from '../lib/useNow.ts'
const SnowInvoices = lazy(() => import('../components/desktop/SnowInvoicesBuild.tsx'))
import MoneyPhone from './money/MoneyPhone.tsx'
import type { MoneyFilter } from './money/types.ts'

// Money (/invoices): invoices and what each job owes.
//
// Pipeline v2: two layers on one screen.
//   1. INVOICES, real fh_invoices rows (a job's deposit, draws and final,
//      or a bill against a client with no job, D62), each with its own
//      status. A row opens the invoice's screen, /invoices/:id, where
//      Send, PDF, Collect payment, Remind and Void live (D57).
//   2. JOB BALANCES, per-job outstanding (contract less paid), the
//      who-owes-me-what aging view, kept from the original screen.
//
// Below 900 px the screen is MoneyPhone (src/screens/money/) and from
// 900 px up it is SnowInvoicesBuild (src/components/desktop/): this file
// loads the data and builds the rows both read.

function bucketFor(days: any) {
  if (days <= 30) return '0-30'
  if (days <= 60) return '31-60'
  return '60+'
}

// Resolve client info for a job row: prefer the denormalized fields on
// the job, fall back to the joined fh_clients row. Edits to the client
// card don't propagate back to the job row, so the linked client is
// the source of truth when the job row is stale or empty.
function resolveClient(job: any) {
  const cli = job?.fh_clients || {}
  return {
    name:    job?.name    || cli.name    || '',
    email:   job?.email   || cli.email   || '',
    phone:   job?.phone   || cli.phone   || '',
    address: job?.address || cli.address || ''
  }
}

export default function Invoices() {
  const { user } = useAuth()
  // isPending, not isLoading: the query waits, disabled, until the company
  // is known (useOrgScope), and TanStack does not call a waiting query
  // loading, so both screens would draw $0.00 and "paid in full" for money
  // nobody has asked for yet.
  const { data: bundle, isPending: loading, isError } = useInvoicesBundle(user?.id)
  const refresh = useInvalidateInvoices()
  // The clock every number below reads, refreshed each minute and when the
  // tab comes back, so ages, the week and the month roll over while the
  // screen stays open (Phase 8, task 6).
  const now = useNow()
  // Memoized so the lists below keep one identity until the bundle changes.
  const jobs = useMemo(() => bundle?.jobs ?? [], [bundle])
  const payments = useMemo(() => bundle?.payments ?? [], [bundle])
  const invoices = useMemo(() => bundle?.invoices ?? [], [bundle])
  const changeOrders = useMemo(() => bundle?.changeOrders ?? [], [bundle])
  // Approved change orders raise each job's true contract; without this
  // the balances below understate what a job with signed COs owes.
  const approvedCoByJob = useMemo(() => approvedCoByContact(changeOrders), [changeOrders])
  // View toggle in the URL (?view=), survives refresh, shareable
  // (UI audit #30). 'outstanding' | 'all'.
  const [searchParams, setSearchParams] = useSearchParams()
  const filter = searchParams.get('view') === 'all' ? 'all' : 'outstanding'
  const setFilter = (next: string) => {
    const sp = new URLSearchParams(searchParams)
    if (next === 'outstanding') sp.delete('view')
    else sp.set('view', next)
    setSearchParams(sp, { replace: true })
  }
  // Log payment on a job balance (the desktop table) is the job's payment
  // screen, and a customer's statement its own screen (D57).
  const navigate = useNavigate()
  const openPayment = (r: { job: { id: string } }) => navigate(`/jobs/${r.job.id}/payment`)
  const openStatement = (g: { clientId: string }) => navigate(`/clients/${g.clientId}/statement`)

  // Receivable-age anchor per job: the earliest OPEN (issued but not
  // paid/void/draft) invoice's due date, else its issue date. A/R aging
  // must run from when the bill went out, NOT the job's creation date,
  // or a job that ran for months reads as "90d overdue" the day it's
  // first billed. Jobs with no issued invoice fall back to created_at.
  const arAnchorByJob = useMemo(() => {
    const m = new Map<string, number>()
    for (const inv of invoices) {
      const st = String((inv as any).status || '').toLowerCase()
      if (st === 'paid' || st === 'void' || st === 'draft') continue
      const cid = (inv as any).contact_id
      if (!cid) continue
      const anchor = (inv as any).due_at || (inv as any).issued_at || (inv as any).created_at
      const t = anchor ? new Date(anchor).getTime() : NaN
      if (!Number.isFinite(t)) continue
      const prev = m.get(cid)
      if (prev == null || t < prev) m.set(cid, t)
    }
    return m
  }, [invoices])

  // Roll up payment totals per contact for fast lookup.
  const paidByJob = useMemo(() => {
    const m = new Map()
    for (const p of payments) {
      const id = p.contact_id
      if (!id) continue
      m.set(id, (m.get(id) || 0) + Number(p.amount || 0))
    }
    return m
  }, [payments])

  // Compute the row for each job: balance, age, bucket. Filter out
  // closed+fully-paid since they're done.
  const rows = useMemo(() => {
    const out = []
    const nowMs = now.getTime()
    for (const j of jobs) {
      const amount = Number(j.amount || 0) + (approvedCoByJob.get(j.id) || 0)
      const paid = paidByJob.get(j.id) || 0
      const balance = amount - paid
      // Age from the receivable date (oldest open invoice), not the job
      // creation date. Unbilled jobs anchor to created_at as a fallback.
      const anchorMs = arAnchorByJob.get(j.id) ?? new Date(j.created_at as any).getTime()
      const ageDays = Math.floor((nowMs - anchorMs) / 86400000)
      const bucket = bucketFor(ageDays)
      const isOutstanding = balance > 0.5 && j.stage !== 'lost'
      out.push({ job: j, amount, paid, balance, ageDays, bucket, isOutstanding })
    }
    return out.sort((a, b) => b.balance - a.balance)
  }, [jobs, paidByJob, approvedCoByJob, arAnchorByJob, now])

  // Memoized so `filtered` keeps a stable identity across unrelated
  // re-renders, it feeds TanStack Table (SnowInvoicesBuild) as `data`,
  // and a fresh array every render forces a full row-model rebuild.
  const filtered = useMemo(
    () => filter === 'outstanding' ? rows.filter((r) => r.isOutstanding) : rows,
    [rows, filter]
  )
  // BY-CLIENT A/R rollup, group every outstanding job balance under
  // its linked client so "who owes me, and how overdue" reads at a
  // glance. Each group carries the client's jobs + the worst aging
  // bucket among them, and names the customer whose statement screen opens.
  const clientAR = useMemo(() => {
    const groups = new Map<string, any>()
    for (const r of rows) {
      if (!r.isOutstanding) continue
      const cid = (r.job as any).client_id
      if (!cid) continue // unlinked jobs stay in the job-balance list only
      let g = groups.get(cid)
      if (!g) {
        const cli = resolveClient(r.job)
        g = {
          clientId: cid,
          client: {
            id: cid,
            name: cli.name,
            company_name: (r.job as any).fh_clients?.company_name || null,
            email: cli.email,
            address: cli.address
          },
          jobs: [],
          total: 0,
          worst: '0-30'
        }
        groups.set(cid, g)
      }
      g.jobs.push(r.job)
      g.total += r.balance
      // Track the most-overdue bucket across the client's jobs.
      if (r.bucket === '60+') g.worst = '60+'
      else if (r.bucket === '31-60' && g.worst !== '60+') g.worst = '31-60'
    }
    return Array.from(groups.values()).sort((a, b) => b.total - a.total)
  }, [rows])

  const totals = useMemo(() => {
    const out: Record<string, number> = { '0-30': 0, '31-60': 0, '60+': 0, total: 0, count: 0 }
    for (const r of rows) {
      if (!r.isOutstanding) continue
      out[r.bucket] += r.balance
      out.total += r.balance
      out.count++
    }
    return out
  }, [rows])

  // Month-to-date collection pace, payments logged in the current
  // calendar month vs the trailing-3-month monthly average. Surfaces
  // as the cockpit's "X collected this month · pace ±Y% vs avg" tip
  // (ported from owed-hero__tip in the design handoff).
  const collectionPace = useMemo(() => {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1).getTime()
    let monthCollected = 0
    let priorTotal = 0
    for (const p of payments) {
      // paid_on is date-only, parse LOCAL so a payment dated the 1st
      // doesn't bucket into the prior month (UTC parse shifts it back
      // a day in every US timezone).
      const t = (parseDateOnly(p.paid_on) || parseDateOnly(p.created_at))?.getTime() ?? NaN
      const amt = Number(p.amount || 0)
      if (t >= startOfMonth) monthCollected += amt
      else if (t >= threeMonthsAgo) priorTotal += amt
    }
    const priorMonthlyAvg = priorTotal / 3
    let deltaPct = null
    if (priorMonthlyAvg > 0) {
      deltaPct = Math.round(((monthCollected - priorMonthlyAvg) / priorMonthlyAvg) * 100)
    }
    return { monthCollected, deltaPct }
  }, [payments, now])

  const isDesktop = useIsDesktop()

  // Never render financial totals from a failed load, a fetch error would
  // otherwise fall through to "$0 · all caught up", telling a contractor
  // they're owed nothing when the data simply didn't arrive.
  if (isError) {
    return (
      <div className="v3-screen" style={{ padding: '24px 24px' }}>
        <DataErrorState
          title="Couldn't load invoices & payments"
          message="We couldn't reach your billing data. Check your connection and retry, your numbers are safe."
          onRetry={() => refresh()}
        />
      </div>
    )
  }

  if (isDesktop) {
    return (
      <>
        <Suspense fallback={null}>
          <SnowInvoices
            bundle={bundle}
            loading={loading}
            jobBalances={filtered}
            totals={totals}
            clientAR={clientAR}
            collectionPace={collectionPace}
            filter={filter as MoneyFilter}
            onFilterChange={(f) => setFilter(f)}
            now={now}
            onStatement={openStatement}
            onPayRow={openPayment}
          />
        </Suspense>
      </>
    )
  }

  // Phone: the Money screen. It takes the same rows and handlers the
  // desktop table gets; a statement opens as the customer's statement screen.
  return (
    <>
      <MoneyPhone
        bundle={bundle}
        loading={loading}
        jobBalances={filtered}
        totals={totals}
        clientAR={clientAR}
        collectionPace={collectionPace}
        filter={filter as MoneyFilter}
        onFilterChange={(f) => setFilter(f)}
        now={now}
        onStatement={openStatement}
      />
    </>
  )
}
