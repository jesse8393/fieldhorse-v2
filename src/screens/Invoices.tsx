import { lazy, Suspense, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Receipt, FileDown, DollarSign, ChevronRight, Check, Send, CheckCircle2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase.ts'
import { useInvoicesBundle, useInvalidateInvoices } from '../lib/queries.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useProfile } from '../contexts/ProfileContext.tsx'
import {
  createInvoice, sendInvoiceEmail, buildInvoicePdf, setInvoiceStatus
} from '../lib/invoices.ts'
// Lazy — pdf.js + transitive jspdf + autoTable deps are ~430KB. Only
// loads on the first PDF action (per-row Generate or Email Invoice).
async function loadPdf(): Promise<any> {
  return import('../lib/pdf.js')
}
import { toastSuccess, toastError } from '../lib/toast.ts'
import { hapticTap } from '../lib/haptics.ts'
import { useFhMotion } from '../lib/motion.ts'
import { SkeletonList } from '../components/Skeleton.tsx'
import SectionHeader from '../components/v3/SectionHeader.tsx'
import { FilterPill, Eyebrow, StampNumber } from '../components/v3'
// V3PaymentSheet is lazy — only loads when an operator taps "Mark Paid".
// Avoids dragging ~440KB into the initial Invoices route chunk.
const V3PaymentSheet = lazy(() => import('../components/V3PaymentSheet.tsx'))
import { useConfirm } from '../components/ConfirmSheet.tsx'
import StatementSheet from '../components/StatementSheet.tsx'
import { useNavigate } from 'react-router-dom'
import { useIsDesktop } from '../lib/useMediaQuery.ts'
const SnowInvoices = lazy(() => import('../components/desktop/SnowInvoicesBuild.tsx'))

// Invoices / AR — v3 money command screen.
//
// Pipeline v2: two layers on one screen.
//   1. ISSUED INVOICES — real fh_invoices rows (deposit / draws /
//      final), each with its own status + send / download / mark-paid.
//   2. JOB BALANCES — per-job outstanding (contract − paid), the
//      who-owes-me-what aging view, kept from the original screen.
// The per-job Email action now creates a first-class invoice for the
// balance instead of firing an untracked ad-hoc PDF.

const AGING_BUCKETS = [
  { id: '0-30',  label: 'Current',  short: '0–30 d',  max: 30,        color: 'var(--v3-text-muted)',     accent: 'rgba(255, 255, 255, 0.18)' },
  { id: '31-60', label: 'Late',     short: '31–60 d', max: 60,        color: 'var(--v3-primary)',         accent: 'color-mix(in srgb, var(--v3-primary) 40%, transparent)' },
  { id: '60+',   label: 'Overdue',  short: '60+ d',   max: Infinity,  color: 'var(--v3-danger-bright)',   accent: 'color-mix(in srgb, var(--v3-danger) 50%, transparent)' }
]

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

function fmtMoney(n: any) {
  return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export default function Invoices() {
  const { user } = useAuth()
  const { profile } = useProfile()
  const { data: bundle, isLoading: loading } = useInvoicesBundle(user?.id)
  const refresh = useInvalidateInvoices()
  const jobs = bundle?.jobs ?? []
  const payments = bundle?.payments ?? []
  const invoices = bundle?.invoices ?? []
  const [filter, setFilter] = useState('outstanding') // 'outstanding' | 'all'
  // Row whose Mark Paid sheet is open. null = closed. Stores the full row
  // so the sheet can prefill amount=balance and pass the contact (job).
  // When the sheet was opened from a specific issued invoice, `invoice`
  // rides along so the payment settles that fh_invoices row.
  const [payingRow, setPayingRow] = useState<any>(null)
  // Which row is mid-send (job.id or invoice.id) and which just
  // succeeded — drives the per-row Email button's loading + Sent morph.
  const [sendingId, setSendingId] = useState<any>(null)
  const [sentId, setSentId] = useState<any>(null)
  const confirm = useConfirm()

  // Fast lookup: contact_id → job row (for invoice card labels + sends).
  const jobById = useMemo(() => {
    const m = new Map()
    for (const j of jobs) m.set(j.id, j)
    return m
  }, [jobs])

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
      const amount = Number(j.amount || 0)
      const paid = paidByJob.get(j.id) || 0
      const balance = amount - paid
      const ageDays = Math.floor((now - new Date(j.created_at as any).getTime()) / 86400000)
      const bucket = bucketFor(ageDays)
      const isOutstanding = balance > 0.5 && j.stage !== 'lost'
      out.push({ job: j, amount, paid, balance, ageDays, bucket, isOutstanding })
    }
    return out.sort((a, b) => b.balance - a.balance)
  }, [jobs, paidByJob])

  const filtered = filter === 'outstanding' ? rows.filter((r) => r.isOutstanding) : rows

  // BY-CLIENT A/R rollup — group every outstanding job balance under
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
  // job + effective status — a 'sent' invoice past its due date reads
  // as overdue at display time without a background job mutating rows.
  const invoiceRows = useMemo(() => {
    const now = Date.now()
    return invoices.map((inv) => {
      const job = jobById.get(inv.contact_id) || null
      const pastDue = inv.status === 'sent' && inv.due_at && new Date(inv.due_at).getTime() < now
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

  // Month-to-date collection pace — payments logged in the current
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
      const t = p.paid_on ? new Date(p.paid_on as any).getTime() : new Date(p.created_at as any).getTime()
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
    // Prefer customer-facing company_email (migration 015) over the
    // operator's auth email so invoices show the public address.
    email: profile?.company_email || (profile as any)?.email || '',
    website: profile?.company_website || '',
    logo_url: profile?.logo_url || null,
    brand_accent_hex: profile?.brand_accent_hex || null,
    license_number: profile?.license_number || '',
    insured_text: profile?.insured_text || ''
  }), [profile])

  async function handleGeneratePDF(row: any) {
    // Audit caught this as a no-op. Wrap in try/catch so a jsPDF
    // failure surfaces a real error instead of silently swallowing,
    // and so the user sees a toast immediately on click instead of
    // wondering if anything happened.
    try {
      const { generateInvoice, downloadPdf } = await loadPdf()
      // generateInvoice() became async in 4D-2D — pre-fetches the
      // contractor's logo via loadLogoForPdf before rendering.
      const c = resolveClient(row.job)
      // Pull payments for this job so the new PDF's Balance Summary +
      // Payment History sections render with real data instead of the
      // synthetic "Less: payments received" row the old generator used.
      const { data: jobPayments } = await supabase
        .from('fh_payments')
        .select('*')
        .eq('contact_id', row.job.id)
        .order('paid_on', { ascending: false })
      const result = await generateInvoice({
        company,
        contact: {
          id: row.job.id,
          name: c.name || row.job.client_name || 'Client',
          address: c.address,
          phone: c.phone,
          email: c.email,
          job_title: row.job.job_title
        },
        lineItems: [
          {
            description: row.job.job_title || 'Construction services per agreement',
            qty: 1,
            rate: row.amount,
            amount: row.amount
          }
        ],
        taxRate: 0,
        notes: '',
        dueDate: '',
        invoiceId: row.job.id,
        payments: jobPayments || [],
        contractTotal: row.amount,
        previouslyPaid: row.paid
      })
      if (!result?.doc) throw new Error('PDF generator returned no document')
      downloadPdf(result)
      toastSuccess('Invoice PDF downloaded', result.filename)
    } catch (e: any) {
      console.error('[invoices] PDF generation failed:', e)
      toastError("Couldn't generate PDF", e?.message || 'Try again')
    }
  }

  // Mark Paid now opens the shared V3PaymentSheet. The sheet handles
  // method / reference / paid_on / partial amount and calls logPayment
  // through the existing pipeline (auto-close cascade preserved).
  function openPaymentSheet(row: any) {
    setPayingRow(row)
  }

  // Payments scoped to one job — feeds the per-invoice PDF's balance
  // summary + payment history blocks.
  function paymentsForJob(jobId: string) {
    return payments.filter((p) => p.contact_id === jobId)
  }

  // Email the remaining balance straight from a job row. Pipeline v2:
  // this now mints a real fh_invoices row first, so the send is tracked
  // (status, due date, mark-paid) instead of an untracked ad-hoc PDF.
  async function handleSendEmail(row: any) {
    const job = row?.job
    if (!user || !job) return
    const c = resolveClient(job)
    if (!c.email) {
      toastError('Add a client email first', `Open the linked client to add an email for ${c.name || 'this client'}.`)
      return
    }
    setSendingId(job.id)
    try {
      const { data: invoice, error } = await createInvoice({
        contact: job,
        userId: user.id,
        title: 'Balance due',
        amount: row.balance,
        due_at: new Date(Date.now() + 14 * 86400000).toISOString()
      })
      if (error || !invoice) throw new Error(error?.message || "Couldn't create the invoice")
      const res = await sendInvoiceEmail({
        invoice,
        contact: job,
        company,
        userId: user.id,
        recipientEmail: c.email,
        payments: paymentsForJob(job.id)
      })
      if (res.ok) {
        toastSuccess(`Invoice sent to ${res.recipient}`, res.filename)
        setSentId(job.id)
        setTimeout(() => setSentId(null), 2400)
      } else if (res.reason === 'sender_not_configured') {
        toastError("Email NOT sent — sender isn't configured", 'Downloaded the PDF so you can email it manually. Saved as a draft invoice.')
      } else {
        throw new Error(res.message || 'Send failed')
      }
      refresh()
    } catch (e: any) {
      toastError("Couldn't send invoice", e?.message || 'Try again')
    } finally {
      setSendingId(null)
    }
  }

  // Per-invoice actions — operate on the first-class fh_invoices rows.
  async function handleInvoiceSend(r: any) {
    const { invoice, job } = r
    if (!user || !job) {
      toastError("Couldn't resolve the job", 'This invoice belongs to a job that is no longer in the money pipeline.')
      return
    }
    const c = resolveClient(job)
    if (!c.email) {
      toastError('Add a client email first', `Open the linked client to add an email for ${c.name || 'this client'}.`)
      return
    }
    setSendingId(invoice.id)
    try {
      const res = await sendInvoiceEmail({
        invoice,
        contact: job,
        company,
        userId: user.id,
        recipientEmail: c.email,
        payments: paymentsForJob(job.id)
      })
      if (res.ok) {
        toastSuccess(`Invoice sent to ${res.recipient}`, res.filename)
        setSentId(invoice.id)
        setTimeout(() => setSentId(null), 2400)
        refresh()
      } else if (res.reason === 'sender_not_configured') {
        toastError("Email NOT sent — sender isn't configured", 'Downloaded the PDF so you can email it manually.')
      } else {
        throw new Error(res.message || 'Send failed')
      }
    } catch (e: any) {
      toastError("Couldn't send invoice", e?.message || 'Try again')
    } finally {
      setSendingId(null)
    }
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
        payments: paymentsForJob(job.id)
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

  const { stagger, item } = useFhMotion()
  const allCaughtUp = !loading && totals.count === 0
  const navigate = useNavigate()
  const isDesktop = useIsDesktop()

  if (isDesktop) {
    return (
      <>
        <Suspense fallback={null}>
          <SnowInvoices
            rows={rows}
            filtered={filtered}
            totals={totals}
            loading={loading}
            filter={filter as 'outstanding' | 'all'}
            setFilter={(f) => setFilter(f)}
            clientAR={clientAR}
            onOpenJob={(jobId) => navigate(`/jobs/${jobId}?tab=financials`)}
            onOpenClient={(clientId) => navigate(`/clients/${clientId}`)}
            onStatement={(g) => setStatementClient(g)}
            onPayRow={(r) => setPayingRow(r)}
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
          userId={user?.id}
        />
      </>
    )
  }

  return (
    <motion.div
      className="v3-screen"
      variants={stagger}
      initial="hidden"
      animate="show"
      // paddingBottom was 120 — defensive clearance for the bottom nav
      // but it left a huge dead void below the last invoice card on
      // short lists. Bottom nav is ~56-64px tall; safe-area-inset-bottom
      // covers the iOS home indicator. Sum gives enough breathing room
      // for the last card's tap target without printing a half-screen
      // of empty surface.
      style={{
        paddingBottom: 'calc(76px + env(safe-area-inset-bottom, 0px))',
        position: 'relative',
        background: 'var(--v3-bg)'
      }}
    >
      {/* COCKPIT — black-glass A/R panel: title eyebrow + state chip +
          headline total + aging bar + 3-cell aging breakdown.
          Backdrop-filter + neutral inner highlight match the v3 black-
          glass treatment shipped on Schedule/Notes/Home cockpits. */}
      <motion.div variants={item} style={{ padding: '8px 20px 12px' }}>
        <div style={{
          position: 'relative',
          padding: '14px 16px',
          borderRadius: 16,
          background: 'var(--v3-surface-glass)',
          backdropFilter: 'blur(14px) saturate(1.1)',
          WebkitBackdropFilter: 'blur(14px) saturate(1.1)',
          border: '1px solid var(--v3-border)',
          boxShadow: '0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 8px 22px rgba(0, 0, 0, 0.40)',
          overflow: 'hidden'
        }}>
          {/* Gold radial sweep behind the hero number — ported from
              owed-hero__sweep in the design handoff. Adds the premium
              "money sits on warm light" feel without changing layout. */}
          <span aria-hidden="true" style={{
            position: 'absolute',
            top: '-40%',
            right: '-15%',
            width: '70%',
            height: '180%',
            background: 'radial-gradient(45% 30% at 50% 50%, rgba(228, 190, 111, 0.14), transparent 70%)',
            pointerEvents: 'none'
          }} />
          {/* Top row: section eyebrow + state chip (urgency lives here, not in the total) */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <Eyebrow tone="gold">
              <Receipt size={11} aria-hidden="true" />
              Money Owed
            </Eyebrow>
            {!loading && <BalanceStateChip totals={totals} />}
          </div>

          {/* Headline total — always linen. Magnitude is the noun; state lives
              in the chip above. Stripe / Mercury pattern. */}
          <div style={{ marginTop: 8 }}>
            {loading ? (
              <span className="v3-skeleton" style={{ display: 'inline-block', width: 200, height: 48, borderRadius: 6 }} />
            ) : (
              <StampNumber
                size="2xl"
                style={{ display: 'block', lineHeight: 0.95 }}
              >
                {fmtMoney(totals.total)}
              </StampNumber>
            )}
            <Eyebrow as="div" style={{ marginTop: 6 }}>Total Outstanding</Eyebrow>
          </div>

          {/* Aging visualization + 3-cell breakdown */}
          {!loading && totals.total > 0 && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--v3-border)', position: 'relative' }}>
              <AgingBar totals={totals} />
              <div style={{
                marginTop: 10,
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 10
              }}>
                {AGING_BUCKETS.map((b) => {
                  const value = totals[b.id]
                  const isOverdueCell = b.id === '60+'
                  const tone = isOverdueCell && value > 0
                    ? 'danger'
                    : value > 0
                      ? 'default'
                      : 'muted'
                  return (
                    <div key={b.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                      <StampNumber size="md" tone={tone}>{fmtMoney(value)}</StampNumber>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <Eyebrow style={{ whiteSpace: 'nowrap' }}>{b.label}</Eyebrow>
                        <span style={{
                          fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 600,
                          letterSpacing: '0.08em', textTransform: 'uppercase',
                          color: 'var(--v3-text-faint, color-mix(in srgb, var(--v3-text-muted) 70%, transparent))',
                          whiteSpace: 'nowrap'
                        }}>{b.short}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Month-to-date collection pace — positive momentum signal that
              balances the alarm of outstanding totals. Ported from
              owed-hero__tip in the design handoff. */}
          {!loading && collectionPace.monthCollected > 0 && (
            <div style={{
              marginTop: 12,
              paddingTop: 10,
              borderTop: '1px solid var(--v3-border)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: 'var(--font-body)',
              fontSize: 11,
              color: 'var(--v3-text-muted)',
              position: 'relative'
            }}>
              <Check size={11} aria-hidden="true" color="var(--v3-success-bright)" strokeWidth={2.4} />
              <span>
                <span style={{ color: 'var(--v3-text)', fontWeight: 600 }}>
                  {fmtMoney(collectionPace.monthCollected)}
                </span>
                {' collected this month'}
                {collectionPace.deltaPct !== null && (
                  <>
                    {' · pace '}
                    <span style={{
                      color: collectionPace.deltaPct >= 0
                        ? 'var(--v3-success-bright)'
                        : 'var(--v3-danger-bright)',
                      fontWeight: 600
                    }}>
                      {collectionPace.deltaPct >= 0 ? '+' : ''}{collectionPace.deltaPct}%
                    </span>
                    {' vs avg'}
                  </>
                )}
              </span>
            </div>
          )}
        </div>
      </motion.div>

      {/* ISSUED INVOICES — first-class fh_invoices rows. Every deposit,
          progress draw, and final bill lives here with its own status
          + actions. Created from the job screen's Send Invoice sheet
          (or the per-job Email button below). */}
      {!loading && shownInvoiceRows.length > 0 && (
        <motion.div
          variants={item}
          className="v3-section"
          style={{ margin: '0 var(--v3-gutter) 24px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
            <SectionHeader label={filter === 'outstanding' ? 'Open invoices' : 'All invoices'} />
            <span style={{
              fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
              color: 'var(--v3-text-muted)', fontVariantNumeric: 'tabular-nums'
            }}>
              {shownInvoiceRows.length}
            </span>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {shownInvoiceRows.map((r) => (
              <InvoiceCard
                key={r.invoice.id}
                row={r}
                isSending={sendingId === r.invoice.id}
                isSent={sentId === r.invoice.id}
                onSend={() => handleInvoiceSend(r)}
                onDownload={() => handleInvoiceDownload(r)}
                onVoid={() => handleInvoiceVoid(r)}
                onMarkPaid={() => {
                  if (!r.job) return
                  setPayingRow({
                    job: r.job,
                    balance: Number(r.invoice.amount || 0),
                    invoice: r.invoice
                  })
                }}
              />
            ))}
          </ul>
        </motion.div>
      )}

      {/* BY-CLIENT A/R — who owes you, worst-aged first. Outstanding
          filter only; one tap fires a statement across all their jobs. */}
      {!loading && filter === 'outstanding' && clientAR.length > 0 && (
        <motion.div
          variants={item}
          className="v3-section"
          style={{ margin: '0 var(--v3-gutter) 24px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
            <SectionHeader label="Who owes you" />
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: 'var(--v3-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
              {clientAR.length}
            </span>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {clientAR.map((g: any) => {
              const b = AGING_BUCKETS.find((x) => x.id === g.worst) || AGING_BUCKETS[0]
              return (
                <li key={g.clientId}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, background: 'var(--v3-surface)', border: '1px solid var(--v3-border)' }}>
                    <button
                      type="button"
                      onClick={() => { hapticTap(); navigate(`/clients/${g.clientId}`) }}
                      style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, color: 'var(--v3-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {g.client.company_name || g.client.name || 'Client'}
                        </span>
                        <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 999, color: b.color, border: `1px solid ${b.accent}` }}>
                          {b.label}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--v3-text-muted)', marginTop: 2 }}>
                        {g.jobs.length} {g.jobs.length === 1 ? 'property' : 'properties'}
                      </div>
                    </button>
                    <span style={{ flexShrink: 0, fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 800, color: 'var(--v3-text)', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtMoney(g.total)}
                    </span>
                    <button
                      type="button"
                      onClick={() => { hapticTap(); setStatementClient(g) }}
                      aria-label={`Statement for ${g.client.company_name || g.client.name || 'client'}`}
                      style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 11px', borderRadius: 10, background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border-strong)', color: 'var(--v3-text)', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
                    >
                      <Receipt size={13} /> Statement
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </motion.div>
      )}

      {/* FILTER + LIST SECTION */}
      <motion.div
        variants={item}
        className="v3-section"
        style={{ margin: '0 var(--v3-gutter) 28px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
          <SectionHeader label={filter === 'outstanding' ? 'Job balances' : 'All money jobs'} />
          <div style={{ display: 'flex', gap: 6 }}>
            <FilterPill size="sm" active={filter === 'outstanding'} onClick={() => { hapticTap(); setFilter('outstanding') }}>Outstanding</FilterPill>
            <FilterPill size="sm" active={filter === 'all'} onClick={() => { hapticTap(); setFilter('all') }}>All</FilterPill>
          </div>
        </div>

        {loading && <SkeletonList rows={3} />}

        {!loading && filtered.length === 0 && (
          <div className="v3-empty">
            <Receipt size={20} color="var(--v3-text-muted)" style={{ margin: '0 auto 8px' }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
              {filter === 'outstanding' ? 'Nothing outstanding.' : 'No money jobs yet.'}
            </div>
            <div style={{ fontSize: 12 }}>
              {filter === 'outstanding'
                ? 'Every active job is paid in full.'
                : 'Approve a quote to move it into the money pipeline.'}
            </div>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map((r) => (
              <PaymentCard
                key={r.job.id}
                row={r}
                isSending={sendingId === r.job.id}
                isSent={sentId === r.job.id}
                onEmail={() => handleSendEmail(r)}
                onPDF={() => handleGeneratePDF(r)}
                onPaid={async () => {
                  // Phase 11 stabilization — confirm before opening the
                  // payment sheet so accidental Mark Paid taps in a
                  // dense list don't begin the log-payment flow.
                  const name = r.job?.name || 'this job'
                  const amt = Number(r.balance || 0).toLocaleString(undefined, {
                    style: 'currency', currency: 'USD', maximumFractionDigits: 0
                  })
                  const ok = await confirm({
                    title: `Log payment for ${name}?`,
                    body: `Opens the payment sheet pre-filled with ${amt}.`,
                    confirmLabel: 'Open sheet'
                  })
                  if (!ok) return
                  openPaymentSheet(r)
                }}
              />
            ))}
          </ul>
        )}
      </motion.div>

      {/* Payment sheet — shared V3PaymentSheet from ContactDetail.
          Opens when the operator taps Mark Paid on a row, prefilled with
          that row's balance. On submit, logPayment cascades through
          pipeline.ts (auto-close on overpayment) and we refresh. */}
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

      {/* Client statement — fired from a "Who owes you" row */}
      <StatementSheet
        open={!!statementClient}
        onClose={() => setStatementClient(null)}
        client={statementClient?.client || null}
        jobs={statementClient?.jobs || []}
        payments={payments}
        userId={user?.id}
      />
    </motion.div>
  )
}

/* ============================================================
   BalanceStateChip — small premium state pill that lives in the
   cockpit top-right. Carries the urgency signal so the headline
   total can stay calm linen. Three variants:
     - none:    muted "All caught up" with check (zero outstanding)
     - collect: gold-tinted "Collect · N" (outstanding, no overdue)
     - overdue: danger-tinted "Overdue · N" (60+ exists)
   ============================================================ */
function BalanceStateChip({ totals }: any) {
  const overdueCount = totals['60+'] > 0 ? totals.count : 0
  // Variant selection — overdue beats collect beats none.
  let variant
  if (totals.count === 0) variant = 'none'
  else if (totals['60+'] > 0) variant = 'overdue'
  else variant = 'collect'

  const styles = ({
    none: {
      bg: 'var(--v3-surface-2)',
      border: 'var(--v3-border-strong)',
      color: 'var(--v3-text-muted)'
    },
    collect: {
      bg: 'var(--v3-primary-soft)',
      border: 'color-mix(in srgb, var(--v3-primary) 35%, transparent)',
      color: 'var(--v3-primary)'
    },
    overdue: {
      bg: 'var(--v3-danger-soft)',
      border: 'color-mix(in srgb, var(--v3-danger) 38%, transparent)',
      color: 'var(--v3-danger-bright)'
    }
  } as Record<string, any>)[variant]

  const label = variant === 'none'
    ? 'All caught up'
    : variant === 'overdue'
      ? `Overdue · ${overdueCount}`
      : `Collect · ${totals.count}`

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 9px',
        borderRadius: 999,
        background: styles.bg,
        border: `1px solid ${styles.border}`,
        color: styles.color,
        fontFamily: 'var(--font-body)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums'
      }}
    >
      {variant === 'none' && <Check size={10} aria-hidden="true" strokeWidth={2.4} />}
      {label}
    </span>
  )
}

/* ============================================================
   AgingBar — single 6px segmented pill showing Current / Late /
   Overdue proportions of total outstanding. Mirrors the prototype
   owed-aging__bar pattern; segments collapse to zero-width when
   their bucket is empty.
   ============================================================ */
function AgingBar({ totals }: any) {
  const total = totals.total || 0
  if (total <= 0) return null
  const pct = (n: any) => (Number(n) / total) * 100
  return (
    <div
      role="img"
      aria-label="Outstanding balance by age"
      style={{
        display: 'flex',
        height: 6,
        borderRadius: 999,
        background: 'var(--v3-track, rgba(255, 240, 210, 0.05))',
        overflow: 'hidden'
      }}
    >
      {AGING_BUCKETS.map((b) => {
        const w = pct(totals[b.id])
        if (w <= 0) return null
        return (
          <span
            key={b.id}
            aria-hidden="true"
            style={{
              width: `${w}%`,
              background: b.color,
              transition: 'width 220ms ease'
            }}
          />
        )
      })}
    </div>
  )
}

/* ============================================================
   InvoiceCard — one issued fh_invoices row. Compact: status spine +
   title/job + amount/due + actions (Send · Download · Mark paid ·
   Void). Paid/void rows render quiet with no actions.
   ============================================================ */
const INVOICE_STATUS_META: Record<string, { label: string; color: string }> = {
  draft:   { label: 'Draft',   color: 'var(--v3-text-muted)' },
  sent:    { label: 'Sent',    color: 'var(--v3-primary)' },
  overdue: { label: 'Overdue', color: 'var(--v3-danger-bright)' },
  paid:    { label: 'Paid',    color: 'var(--v3-success-bright, #4ade80)' },
  void:    { label: 'Void',    color: 'var(--v3-text-muted)' }
}

function shortDate(iso: any) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function InvoiceCard({ row, isSending, isSent, onSend, onDownload, onMarkPaid, onVoid }: any) {
  const { invoice, job, effStatus } = row
  const meta = INVOICE_STATUS_META[effStatus] || INVOICE_STATUS_META.draft
  const settled = effStatus === 'paid' || effStatus === 'void'
  const title = invoice.title || `Invoice #${invoice.sequence_number}`

  return (
    <li>
      <article style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '12px 14px 12px 20px',
        borderRadius: 12,
        background: 'var(--v3-surface)',
        border: effStatus === 'overdue'
          ? '1px solid color-mix(in srgb, var(--v3-danger) 40%, transparent)'
          : '1px solid var(--v3-border)',
        opacity: settled ? 0.72 : 1,
        overflow: 'hidden'
      }}>
        <span aria-hidden="true" style={{
          position: 'absolute', left: 0, top: 10, bottom: 10, width: 3,
          background: meta.color, borderRadius: '0 3px 3px 0', pointerEvents: 'none'
        }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14,
              color: 'var(--v3-text)',
              textDecoration: effStatus === 'void' ? 'line-through' : 'none'
            }}>
              {title}
            </div>
            <div style={{
              marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              fontSize: 11, color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)'
            }}>
              {job ? (
                <Link to={`/jobs/${job.id}?tab=financials`} style={{ color: 'var(--v3-text-muted)', textDecoration: 'none' }}>
                  {job.name || 'Job'} ›
                </Link>
              ) : (
                <span>Job removed</span>
              )}
              {invoice.due_at && <span>· due {shortDate(invoice.due_at)}</span>}
              {invoice.issued_at && effStatus !== 'draft' && <span>· sent {shortDate(invoice.issued_at)}</span>}
            </div>
          </div>
          <div style={{ flexShrink: 0, textAlign: 'right' }}>
            <div style={{
              fontFamily: 'var(--font-display)', fontSize: 18, lineHeight: 1,
              color: 'var(--v3-text)', fontVariantNumeric: 'tabular-nums',
              textDecoration: effStatus === 'void' ? 'line-through' : 'none'
            }}>
              {fmtMoney(invoice.amount)}
            </div>
            <span style={{
              marginTop: 4,
              display: 'inline-flex', alignItems: 'center',
              padding: '2px 8px', borderRadius: 999,
              background: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
              border: `1px solid color-mix(in srgb, ${meta.color} 35%, transparent)`,
              color: meta.color,
              fontSize: 9, fontWeight: 700, letterSpacing: '0.14em',
              textTransform: 'uppercase', lineHeight: 1.4
            }}>
              {meta.label}
            </span>
          </div>
        </div>
        {!settled && (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <InvoiceAction onClick={onSend} disabled={isSending} success={isSent}>
              {isSent ? <CheckCircle2 size={12} /> : <Send size={12} />}
              {isSent ? 'Sent' : isSending ? 'Sending…' : effStatus === 'draft' ? 'Send' : 'Resend'}
            </InvoiceAction>
            <InvoiceAction onClick={onDownload}>
              <FileDown size={12} /> PDF
            </InvoiceAction>
            <InvoiceAction onClick={onMarkPaid} primary>
              <DollarSign size={12} /> Mark paid
            </InvoiceAction>
            <InvoiceAction onClick={onVoid}>
              Void
            </InvoiceAction>
          </div>
        )}
      </article>
    </li>
  )
}

function InvoiceAction({ children, onClick, disabled, primary, success }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '8px 11px', minHeight: 34, borderRadius: 8,
        border: success
          ? '1px solid color-mix(in srgb, var(--v3-success) 55%, transparent)'
          : primary
            ? '1px solid color-mix(in srgb, var(--v3-primary) 60%, transparent)'
            : '1px solid var(--v3-border-strong)',
        background: success
          ? 'linear-gradient(180deg, var(--v3-success-bright) 0%, var(--v3-success) 100%)'
          : primary
            ? 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)'
            : 'var(--v3-surface-2)',
        color: success ? '#0a0a0a' : primary ? 'var(--v3-on-primary)' : 'var(--v3-text)',
        fontFamily: 'var(--font-body)', fontSize: 11,
        fontWeight: primary ? 700 : 600,
        cursor: disabled ? 'wait' : 'pointer',
        WebkitTapHighlightColor: 'transparent'
      }}
    >
      {children}
    </button>
  )
}

/* ============================================================
   PaymentCard — premium v3 invoice card.
   Layout:
     ┌──────────────────────────────────────────────────┐
     │  [spine]  Job name          $24,400  ›           │
     │           Project type      45 d · LATE          │
     │           ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░ 42% paid     │
     │           [Invoice PDF]    [MARK PAID]           │
     └──────────────────────────────────────────────────┘
   Functions preserved: PDF generation + mark paid via parent props.
   ============================================================ */
function PaymentCard({ row, onPDF, onPaid, onEmail, isSending, isSent }: any) {
  const { job, amount, paid, balance, ageDays, bucket, isOutstanding } = row
  const bucketMeta = AGING_BUCKETS.find((b) => b.id === bucket) || AGING_BUCKETS[0]
  const pctPaid = amount > 0 ? Math.min(100, Math.max(0, (paid / amount) * 100)) : 0
  const isOverdue = bucket === '60+'

  return (
    <li>
      <motion.article
        whileHover={{ y: -2 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: '14px 14px 14px 22px',
          borderRadius: 14,
          background: 'var(--v3-surface-glass)',
          backdropFilter: 'blur(14px) saturate(1.1)',
          WebkitBackdropFilter: 'blur(14px) saturate(1.1)',
          border: isOverdue
            ? '1px solid color-mix(in srgb, var(--v3-danger) 40%, transparent)'
            : '1px solid var(--v3-border-strong)',
          boxShadow: '0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 4px 14px rgba(0, 0, 0, 0.30)',
          overflow: 'hidden'
        }}
      >
        {/* Aging-color spine — left edge */}
        <span aria-hidden="true" style={{
          position: 'absolute',
          left: 0, top: 12, bottom: 12,
          width: 4,
          background: `linear-gradient(180deg, ${bucketMeta.color}, color-mix(in srgb, ${bucketMeta.color} 40%, transparent))`,
          borderRadius: '0 4px 4px 0',
          pointerEvents: 'none'
        }} />

        {/* Top row: name/project + amount/age */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Link
              to={`/invoices/${job.id}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                color: 'var(--v3-text)',
                textDecoration: 'none'
              }}
            >
              <span style={{
                fontFamily: 'var(--font-body)',
                fontWeight: 700,
                fontSize: 15,
                letterSpacing: '-0.005em'
              }}>
                {job.name || 'Unnamed job'}
              </span>
              <ChevronRight size={12} color="var(--v3-text-muted)" />
            </Link>
            {job.job_title && (
              <div style={{
                marginTop: 2,
                fontSize: 12,
                color: 'var(--v3-text-muted)',
                fontFamily: 'var(--font-body)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '100%'
              }}>
                {job.job_title}
              </div>
            )}
          </div>
          <div style={{ flexShrink: 0, textAlign: 'right' }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(20px, 5vw, 26px)',
              lineHeight: 1,
              color: balance > 0 ? 'var(--v3-text)' : 'var(--v3-success-bright)',
              fontVariantNumeric: 'tabular-nums',
              textShadow: balance > 0 ? '0 1px 0 rgba(255, 255, 255, 0.06)' : 'none'
            }}>
              {balance > 0 ? fmtMoney(balance) : 'PAID'}
            </div>
            {isOutstanding && (
              <div style={{
                marginTop: 4,
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px 8px',
                borderRadius: 999,
                background: `color-mix(in srgb, ${bucketMeta.color} 12%, transparent)`,
                border: `1px solid ${bucketMeta.accent}`,
                color: bucketMeta.color,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                lineHeight: 1.4
              }}>
                {ageDays} d · {bucketMeta.label}
              </div>
            )}
          </div>
        </div>

        {/* Paid progress — visible payment momentum */}
        <div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            color: 'var(--v3-text-muted)',
            fontFamily: 'var(--font-body)',
            marginBottom: 5
          }}>
            <span>{fmtMoney(paid)} paid of {fmtMoney(amount)}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--v3-text)' }}>
              {Math.round(pctPaid)}%
            </span>
          </div>
          <div style={{
            height: 6,
            borderRadius: 999,
            background: 'var(--v3-track)',
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${pctPaid}%`,
              height: '100%',
              background: pctPaid >= 100
                ? 'var(--v3-success-bright)'
                : 'linear-gradient(90deg, var(--v3-primary-deep), var(--v3-primary))',
              borderRadius: 999,
              transition: 'width 220ms ease',
              boxShadow: pctPaid >= 100
                ? '0 0 8px rgba(74, 222, 128, 0.40)'
                : 'none'
            }} />
          </div>
        </div>

        {/* Action row: Email + PDF + Mark Paid (only on outstanding) */}
        {isOutstanding && (
          <div style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            paddingTop: 4,
            flexWrap: 'wrap'
          }}>
            {/* Email — primary send action. Mirrors the Send button on
                InvoiceDetail. User shouldn't have to dive into the detail
                page just to email the client. */}
            <button
              type="button"
              onClick={onEmail}
              disabled={isSending}
              title={!resolveClient(row.job).email ? 'Add a client email first on the linked client' : 'Email the invoice to the client'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 14px',
                minHeight: 40,
                borderRadius: 10,
                border: isSent
                  ? '1px solid color-mix(in srgb, var(--v3-success) 55%, transparent)'
                  : '1px solid var(--v3-border-strong)',
                background: isSent
                  ? 'linear-gradient(180deg, var(--v3-success-bright) 0%, var(--v3-success) 100%)'
                  : 'var(--v3-surface-2)',
                color: isSent ? '#0a0a0a' : (isSending ? 'var(--v3-text-muted)' : 'var(--v3-text)'),
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                fontWeight: 600,
                cursor: isSending ? 'wait' : 'pointer',
                WebkitTapHighlightColor: 'transparent',
                transition: 'background 200ms ease, border-color 200ms ease, color 200ms ease'
              }}
            >
              {isSent ? <CheckCircle2 size={13} /> : <Send size={13} />}
              {isSent ? 'Sent' : isSending ? 'Sending…' : 'Email'}
            </button>
            <button
              type="button"
              onClick={onPDF}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 14px',
                minHeight: 40,
                borderRadius: 10,
                border: '1px solid var(--v3-border-strong)',
                background: 'var(--v3-surface-2)',
                color: 'var(--v3-text)',
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent'
              }}
            >
              <FileDown size={13} /> Download
            </button>
            <button
              type="button"
              onClick={onPaid}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 14px',
                minHeight: 40,
                borderRadius: 10,
                border: '1px solid color-mix(in srgb, var(--v3-primary) 60%, transparent)',
                background: 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
                color: 'var(--v3-on-primary)',
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.04em',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                boxShadow: '0 0 0 3px rgba(229, 193, 88, 0.10), 0 4px 12px rgba(229, 193, 88, 0.18), 0 1px 0 rgba(255, 255, 255, 0.30) inset'
              }}
            >
              <DollarSign size={13} /> Mark Paid
            </button>
          </div>
        )}
      </motion.article>
    </li>
  )
}
