import { lazy, Suspense, useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useInvoicesBundle, useInvalidateInvoices } from '../lib/queries.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useProfile } from '../contexts/ProfileContext.tsx'
import { sendInvoiceEmail, buildInvoicePdf, setInvoiceStatus } from '../lib/invoices.ts'
// Lazy, pdf.js + transitive jspdf + autoTable deps are ~430KB. Only
// loads on the first PDF action (per-row Generate or Email Invoice).
async function loadPdf(): Promise<any> {
  return import('../lib/pdf.js')
}
import { toastSuccess, toastError } from '../lib/toast.ts'
import DataErrorState from '../components/DataErrorState.tsx'
// V3PaymentSheet is lazy, only loads when an operator taps "Mark Paid".
// Avoids dragging ~440KB into the initial Invoices route chunk.
const V3PaymentSheet = lazy(() => import('../components/V3PaymentSheet.tsx'))
import { useConfirm } from '../components/ConfirmSheet.tsx'
import StatementSheet from '../components/StatementSheet.tsx'
import { approvedCoByContact } from '../lib/statement.ts'
import { parseDateOnly } from '../lib/dates.ts'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useIsDesktop } from '../lib/useMediaQuery.ts'
const SnowInvoices = lazy(() => import('../components/desktop/SnowInvoicesBuild.tsx'))
import MoneyPhone from './money/MoneyPhone.tsx'
import type { MoneyFilter } from './money/types.ts'

// Invoices / AR, v3 money command screen.
//
// Pipeline v2: two layers on one screen.
//   1. ISSUED INVOICES, real fh_invoices rows (deposit / draws /
//      final), each with its own status + send / download / mark-paid.
//   2. JOB BALANCES, per-job outstanding (contract − paid), the
//      who-owes-me-what aging view, kept from the original screen.
// The per-job Email action now creates a first-class invoice for the
// balance instead of firing an untracked ad-hoc PDF.
//
// Below 900 px the screen is MoneyPhone (src/screens/money/): this file
// still loads the data and owns the send, download, void and payment
// handlers, and hands them down. Per job Email, Download and Mark paid
// live on the job's invoice page (InvoiceDetail, /invoices/:id), which
// the phone's Job balances list links to.

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
  const { profile } = useProfile()
  const { data: bundle, isLoading: loading, isError } = useInvoicesBundle(user?.id)
  const refresh = useInvalidateInvoices()
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
  // Row whose Mark Paid sheet is open. null = closed. Stores the full row
  // so the sheet can prefill amount=balance and pass the contact (job).
  // When the sheet was opened from a specific issued invoice, `invoice`
  // rides along so the payment settles that fh_invoices row.
  const [payingRow, setPayingRow] = useState<any>(null)
  // Which row is mid-send (job.id or invoice.id) and which just
  // succeeded, drives the per-row Email button's loading + Sent morph.
  const [sendingId, setSendingId] = useState<any>(null)
  const [sentId, setSentId] = useState<any>(null)
  const confirm = useConfirm()

  // Fast lookup: contact_id → job row (for invoice card labels + sends).
  const jobById = useMemo(() => {
    const m = new Map()
    for (const j of jobs) m.set(j.id, j)
    return m
  }, [jobs])

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
    const now = Date.now()
    for (const j of jobs) {
      const amount = Number(j.amount || 0) + (approvedCoByJob.get(j.id) || 0)
      const paid = paidByJob.get(j.id) || 0
      const balance = amount - paid
      // Age from the receivable date (oldest open invoice), not the job
      // creation date. Unbilled jobs anchor to created_at as a fallback.
      const anchorMs = arAnchorByJob.get(j.id) ?? new Date(j.created_at as any).getTime()
      const ageDays = Math.floor((now - anchorMs) / 86400000)
      const bucket = bucketFor(ageDays)
      const isOutstanding = balance > 0.5 && j.stage !== 'lost'
      out.push({ job: j, amount, paid, balance, ageDays, bucket, isOutstanding })
    }
    return out.sort((a, b) => b.balance - a.balance)
  }, [jobs, paidByJob, approvedCoByJob, arAnchorByJob])

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
  // bucket among them, and feeds the shared StatementSheet directly.
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

  const [statementClient, setStatementClient] = useState<any>(null)

  // Issued invoices (first-class fh_invoices rows), enriched with their
  // job + effective status, a 'sent' invoice past its due date reads
  // as overdue at display time without a background job mutating rows.
  const invoiceRows = useMemo(() => {
    const now = Date.now()
    return invoices.map((inv) => {
      const job = jobById.get(inv.contact_id) || null
      // due_at can be date-only, LOCAL parse, and a bill due "July 25"
      // isn't overdue until July 25 has fully passed locally.
      const due = parseDateOnly(inv.due_at)
      const pastDue = inv.status === 'sent' && due != null && due.getTime() + 86400000 <= now
      const effStatus = pastDue ? 'overdue' : (inv.status || 'draft')
      return { invoice: inv, job, effStatus }
    })
  }, [invoices, jobById])

  const shownInvoiceRows = useMemo(
    () => filter === 'outstanding'
      ? invoiceRows.filter((r) => ['draft', 'sent', 'overdue'].includes(r.effStatus))
      : invoiceRows,
    [invoiceRows, filter]
  )
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
    const now = new Date()
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
  }, [payments])

  const company = useMemo(() => ({
    name: profile?.company_name || profile?.full_name || 'My Company',
    address: profile?.company_address || '',
    phone: profile?.company_phone || '',
    // Prefer customer facing company_email (migration 015) over the
    // operator's auth email so invoices show the public address.
    email: profile?.company_email || (profile as any)?.email || '',
    website: profile?.company_website || '',
    logo_url: profile?.logo_url || null,
    brand_accent_hex: profile?.brand_accent_hex || null,
    license_number: profile?.license_number || '',
    insured_text: profile?.insured_text || '',
    // Pay link + instructions so the "How to pay" block renders on PDFs
    // downloaded/emailed from this screen too (not just the send sheet).
    payment_link: (profile as any)?.payment_link || '',
    payment_instructions: (profile as any)?.payment_instructions || ''
  }), [profile])

  // Mark paid on an issued invoice links the payment to it, prefilled
  // with what is still due on it: never more than the job's remaining
  // balance, so clearing a bill the job already paid can't record the
  // same money a second time.
  function openInvoicePayment(r: any) {
    if (!r?.job) return
    const amount = Number(r.invoice.amount || 0)
    const jobBalance = rows.find((x) => x.job.id === r.job.id)?.balance ?? amount
    const due = Math.max(0, Math.min(amount, jobBalance))
    setPayingRow({ job: r.job, balance: due, invoice: { ...r.invoice, amount: due } })
  }

  // Payments scoped to one job, feeds the per-invoice PDF's balance
  // summary + payment history blocks.
  function paymentsForJob(jobId: string) {
    return payments.filter((p) => p.contact_id === jobId)
  }

  // Change orders scoped to one job, must be threaded into every PDF /
  // email path or the customer facing balance omits signed CO money
  // (the A/R row already includes it, so the doc would understate).
  function changeOrdersForJob(jobId: string) {
    return changeOrders.filter((co) => (co as any).contact_id === jobId)
  }

  // Per-invoice actions, operate on the first-class fh_invoices rows.
  // Resolves true once the email has gone out, so the phone's Remind and
  // Resend sheets know when to close. A reminder is the same email sent
  // again; only the toast words it differently (decision D6).
  async function handleInvoiceSend(r: any, options: { reminder?: boolean } = {}): Promise<boolean> {
    const { invoice, job } = r
    if (!user || !job) {
      toastError("Couldn't resolve the job", 'This invoice belongs to a job that is no longer in the money pipeline.')
      return false
    }
    const c = resolveClient(job)
    if (!c.email) {
      toastError('Add a client email first', `Open the linked client to add an email for ${c.name || 'this client'}.`)
      return false
    }
    setSendingId(invoice.id)
    try {
      const res = await sendInvoiceEmail({
        invoice,
        contact: job,
        company,
        userId: user.id,
        recipientEmail: c.email,
        payments: paymentsForJob(job.id),
        changeOrders: changeOrdersForJob(job.id)
      })
      if (res.ok) {
        toastSuccess(`${options.reminder ? 'Reminder' : 'Invoice'} sent to ${res.recipient}`, res.filename)
        setSentId(invoice.id)
        setTimeout(() => setSentId(null), 2400)
        refresh()
        return true
      } else if (res.reason === 'sender_not_configured') {
        toastError("Email not sent, sender isn't configured", 'Downloaded the PDF so you can email it manually.')
      } else {
        throw new Error(res.message || 'Send failed')
      }
    } catch (e: any) {
      toastError("Couldn't send invoice", e?.message || 'Try again')
    } finally {
      setSendingId(null)
    }
    return false
  }

  async function handleInvoiceDownload(r: any) {
    const { invoice, job } = r
    if (!job) {
      toastError("Couldn't resolve the job", 'This invoice belongs to a job that is no longer in the money pipeline.')
      return
    }
    try {
      const result = await buildInvoicePdf({
        invoice, contact: job, company,
        payments: paymentsForJob(job.id),
        changeOrders: changeOrdersForJob(job.id)
      })
      const { downloadPdf } = await loadPdf()
      downloadPdf(result)
      toastSuccess('Invoice PDF downloaded', result.filename)
    } catch (e: any) {
      toastError("Couldn't generate PDF", e?.message || 'Try again')
    }
  }

  async function handleInvoiceVoid(r: any) {
    const { invoice } = r
    const ok = await confirm({
      title: `Void ${invoice.title || `invoice #${invoice.sequence_number}`}?`,
      body: 'It stops counting toward the job’s billed total. The record stays for the books.',
      destructive: true,
      confirmLabel: 'Void invoice'
    })
    if (!ok) return
    const { error } = await setInvoiceStatus(invoice, 'void')
    if (error) {
      toastError("Couldn't void", error.message || 'Try again')
      return
    }
    toastSuccess('Invoice voided', '')
    refresh()
  }

  const navigate = useNavigate()
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
            rows={rows}
            filtered={filtered}
            issuedInvoices={shownInvoiceRows}
            totals={totals}
            loading={loading}
            filter={filter as 'outstanding' | 'all'}
            setFilter={(f) => setFilter(f)}
            sendingId={sendingId}
            sentId={sentId}
            clientAR={clientAR}
            onOpenJob={(jobId) => navigate(`/jobs/${jobId}?tab=financials`)}
            onOpenClient={(clientId) => navigate(`/clients/${clientId}`)}
            onStatement={(g) => setStatementClient(g)}
            onPayRow={(r) => setPayingRow(r)}
            onSendInvoice={handleInvoiceSend}
            onDownloadInvoice={handleInvoiceDownload}
            onPayInvoice={openInvoicePayment}
            onVoidInvoice={handleInvoiceVoid}
          />
        </Suspense>
        <AnimatePresence>
          {payingRow && (
            <Suspense fallback={null}>
              <V3PaymentSheet
                contact={payingRow.job}
                balance={payingRow.balance}
                invoice={payingRow.invoice || null}
                onClose={() => setPayingRow(null)}
                onLogged={() => { setPayingRow(null); refresh() }}
              />
            </Suspense>
          )}
        </AnimatePresence>
        <StatementSheet
          open={!!statementClient}
          onClose={() => setStatementClient(null)}
          client={statementClient?.client || null}
          jobs={statementClient?.jobs || []}
          payments={payments}
          changeOrders={changeOrders}
          userId={user?.id}
        />
      </>
    )
  }

  // Phone: the Money screen. It takes the same rows and handlers the
  // desktop table gets; the payment and statement sheets below are the
  // existing ones, opened from its invoice actions and its Who owes you list.
  return (
    <>
      <MoneyPhone
        bundle={bundle}
        loading={loading}
        invoiceRows={invoiceRows}
        jobBalances={filtered}
        totals={totals}
        clientAR={clientAR}
        collectionPace={collectionPace}
        filter={filter as MoneyFilter}
        onFilterChange={(f) => setFilter(f)}
        sendingId={sendingId}
        onSendInvoice={handleInvoiceSend}
        onDownloadInvoice={handleInvoiceDownload}
        onPayInvoice={openInvoicePayment}
        onVoidInvoice={handleInvoiceVoid}
        onStatement={(g) => setStatementClient(g)}
        onRefresh={() => refresh()}
      />
      <AnimatePresence>
        {payingRow && (
          <Suspense fallback={null}>
            <V3PaymentSheet
              contact={payingRow.job}
              balance={payingRow.balance}
              invoice={payingRow.invoice || null}
              onClose={() => setPayingRow(null)}
              onLogged={() => { setPayingRow(null); refresh() }}
            />
          </Suspense>
        )}
      </AnimatePresence>
      <StatementSheet
        open={!!statementClient}
        onClose={() => setStatementClient(null)}
        client={statementClient?.client || null}
        jobs={statementClient?.jobs || []}
        payments={payments}
        changeOrders={changeOrders}
        userId={user?.id}
      />
    </>
  )
}
