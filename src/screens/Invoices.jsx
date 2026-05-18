import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Receipt, FileDown, DollarSign, ChevronRight, Check, Send, CheckCircle2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useProfile } from '../contexts/ProfileContext.jsx'
import { generateInvoice, downloadPdf } from '../lib/pdf.js'
import { toastSuccess, toastError } from '../lib/toast.js'
import { hapticTap } from '../lib/haptics.js'
import { useFhMotion } from '../lib/motion.js'
import { SkeletonList } from '../components/Skeleton.jsx'
import SectionHeader from '../components/v3/SectionHeader.jsx'
import { FilterPill, Eyebrow, StampNumber } from '../components/v3'
import V3PaymentSheet from '../components/V3PaymentSheet.jsx'
import { useConfirm } from '../components/ConfirmSheet.jsx'

// Invoices / AR — v3 money command screen.
//
// Aggregates jobs in the active money pipeline (stage in ['job',
// 'invoice', 'closed']) and computes outstanding balance per job by
// subtracting paid totals from contract amount. Auto-buckets by aging.
//
// Pure presentation refactor (Session A): every business calculation,
// PDF generation call, mark-paid flow, and Supabase query is unchanged.

const AGING_BUCKETS = [
  { id: '0-30',  label: 'Current',  short: '0–30 d',  max: 30,        color: 'var(--v3-text-muted)',     accent: 'rgba(255, 255, 255, 0.18)' },
  { id: '31-60', label: 'Late',     short: '31–60 d', max: 60,        color: 'var(--v3-primary)',         accent: 'color-mix(in srgb, var(--v3-primary) 40%, transparent)' },
  { id: '60+',   label: 'Overdue',  short: '60+ d',   max: Infinity,  color: 'var(--v3-danger-bright)',   accent: 'color-mix(in srgb, var(--v3-danger) 50%, transparent)' }
]

function bucketFor(days) {
  if (days <= 30) return '0-30'
  if (days <= 60) return '31-60'
  return '60+'
}

// Resolve client info for a job row: prefer the denormalized fields on
// the job, fall back to the joined fh_clients row. Edits to the client
// card don't propagate back to the job row, so the linked client is
// the source of truth when the job row is stale or empty.
function resolveClient(job) {
  const cli = job?.fh_clients || {}
  return {
    name:    job?.name    || cli.name    || '',
    email:   job?.email   || cli.email   || '',
    phone:   job?.phone   || cli.phone   || '',
    address: job?.address || cli.address || ''
  }
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export default function Invoices() {
  const { user } = useAuth()
  const { profile } = useProfile()
  const [jobs, setJobs] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('outstanding') // 'outstanding' | 'all'
  // Row whose Mark Paid sheet is open. null = closed. Stores the full row
  // so the sheet can prefill amount=balance and pass the contact (job).
  const [payingRow, setPayingRow] = useState(null)
  // Which row is mid-send (job.id) and which just succeeded — drives
  // the per-row Email button's loading + green Sent morph.
  const [sendingId, setSendingId] = useState(null)
  const [sentId, setSentId] = useState(null)
  const confirm = useConfirm()

  const refresh = async () => {
    if (!user) return
    setLoading(true)
    // Join fh_clients so each job row can fall back to the linked
    // client's email/name/phone/address when the denormalized fields
    // on the job row are empty (typical when the client is added or
    // edited later from the Client card, not the job).
    const [{ data: js }, { data: ps }] = await Promise.all([
      supabase.from('fh_contacts').select('*, fh_clients(name, email, phone, address)').eq('user_id', user.id).in('stage', ['job', 'invoice', 'closed']).order('created_at', { ascending: false }),
      supabase.from('fh_payments').select('*').eq('user_id', user.id)
    ])
    setJobs(js || [])
    setPayments(ps || [])
    setLoading(false)
  }

  useEffect(() => { refresh() }, [user])

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
      const ageDays = Math.floor((now - new Date(j.created_at).getTime()) / 86400000)
      const bucket = bucketFor(ageDays)
      const isOutstanding = balance > 0.5 && j.stage !== 'lost'
      out.push({ job: j, amount, paid, balance, ageDays, bucket, isOutstanding })
    }
    return out.sort((a, b) => b.balance - a.balance)
  }, [jobs, paidByJob])

  const filtered = filter === 'outstanding' ? rows.filter((r) => r.isOutstanding) : rows

  const totals = useMemo(() => {
    const out = { '0-30': 0, '31-60': 0, '60+': 0, total: 0, count: 0 }
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
      const t = p.paid_on ? new Date(p.paid_on).getTime() : new Date(p.created_at).getTime()
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
    email: profile?.company_email || profile?.email || '',
    website: profile?.company_website || '',
    logo_url: profile?.logo_url || null,
    brand_accent_hex: profile?.brand_accent_hex || null,
    license_number: profile?.license_number || '',
    insured_text: profile?.insured_text || ''
  }), [profile])

  async function handleGeneratePDF(row) {
    // Audit caught this as a no-op. Wrap in try/catch so a jsPDF
    // failure surfaces a real error instead of silently swallowing,
    // and so the user sees a toast immediately on click instead of
    // wondering if anything happened.
    try {
      // generateInvoice() became async in 4D-2D — pre-fetches the
      // contractor's logo via loadLogoForPdf before rendering.
      const c = resolveClient(row.job)
      const result = await generateInvoice({
        company,
        contact: {
          name: c.name || row.job.client_name || 'Client',
          address: c.address,
          phone: c.phone,
          email: c.email
        },
        lineItems: [
          {
            description: row.job.job_title || 'Construction services per agreement',
            qty: 1,
            rate: row.amount,
            amount: row.amount
          },
          ...(row.paid > 0 ? [{
            description: 'Less: payments received',
            qty: 1,
            rate: -row.paid,
            amount: -row.paid
          }] : [])
        ],
        taxRate: 0,
        notes: row.paid > 0
          ? `Balance due reflects ${fmtMoney(row.paid)} previously received.`
          : '',
        dueDate: '',
        invoiceId: row.job.id
      })
      if (!result?.doc) throw new Error('PDF generator returned no document')
      downloadPdf(result)
      toastSuccess('Invoice PDF downloaded', result.filename)
    } catch (e) {
      console.error('[invoices] PDF generation failed:', e)
      toastError("Couldn't generate PDF", e?.message || 'Try again')
    }
  }

  // Mark Paid now opens the shared V3PaymentSheet. The sheet handles
  // method / reference / paid_on / partial amount and calls logPayment
  // through the existing pipeline (auto-close cascade preserved).
  function openPaymentSheet(row) {
    setPayingRow(row)
  }

  // Email an invoice straight from the Money Owed list — mirrors the
  // handleSendInvoice flow on InvoiceDetail (build PDF → upload to
  // job-files → POST /api/send-invoice). The user reported clicking
  // "Invoice PDF" expecting it to send; only the inner detail page
  // had a real Send button. This wires it into the list so the
  // operator never has to dive into the detail page just to email.
  async function handleSendEmail(row) {
    const job = row?.job
    if (!user || !job) return
    const c = resolveClient(job)
    if (!c.email) {
      toastError('Add a client email first', `Open the linked client to add an email for ${c.name || 'this client'}.`)
      return
    }
    setSendingId(job.id)
    try {
      const result = await generateInvoice({
        company,
        contact: {
          name: c.name || 'Client',
          address: c.address,
          phone: c.phone,
          email: c.email
        },
        lineItems: [
          { description: job.job_title || 'Construction services per agreement', qty: 1, rate: row.amount, amount: row.amount },
          ...(row.paid > 0 ? [{ description: 'Less: payments received', qty: 1, rate: -row.paid, amount: -row.paid }] : [])
        ],
        taxRate: 0,
        notes: row.paid > 0 ? `Balance due reflects ${fmtMoney(row.paid)} previously received.` : '',
        dueDate: '',
        invoiceId: job.id
      })
      if (!result?.doc) throw new Error('PDF generator returned no document')

      const blob = result.doc.output('blob')
      const rowId = crypto.randomUUID()
      const path = `${user.id}/${job.id}/${rowId}.pdf`
      const { error: upErr } = await supabase.storage
        .from('job-files')
        .upload(path, blob, { upsert: false, contentType: 'application/pdf' })
      if (upErr) throw new Error(`Couldn't save the invoice PDF: ${upErr.message}`)

      const sendRes = await fetch('/api/send-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: job.id,
          sender_user_id: user.id,
          recipient_email: c.email,
          recipient_name: c.name || null,
          storage_path: path,
          filename: result.filename,
          amount_due: row.balance
        })
      })
      const sendBody = await sendRes.json().catch(() => ({}))

      if (sendRes.status === 503 && sendBody?.error === 'sender_not_configured') {
        toastError("Email NOT sent — sender isn't configured", 'Add Resend keys in Netlify env then try again.')
        return
      }
      if (!sendRes.ok || !sendBody?.ok) {
        const detail = sendBody?.detail || sendBody?.error || 'Unknown provider error'
        const status = sendBody?.provider_status ? ` (HTTP ${sendBody.provider_status})` : ''
        throw new Error(`Resend rejected${status}: ${detail}`)
      }

      toastSuccess(`Invoice sent to ${c.email}`, result.filename)
      setSentId(job.id)
      setTimeout(() => setSentId(null), 2400)
      refresh()
    } catch (e) {
      toastError("Couldn't send invoice", e?.message || 'Try again')
    } finally {
      setSendingId(null)
    }
  }

  const { stagger, item } = useFhMotion()
  const allCaughtUp = !loading && totals.count === 0

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
                      <Eyebrow>
                        {b.label} <span style={{ opacity: 0.55, marginLeft: 2 }}>· {b.short}</span>
                      </Eyebrow>
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

      {/* FILTER + LIST SECTION */}
      <motion.div
        variants={item}
        className="v3-section"
        style={{ margin: '0 var(--v3-gutter) 28px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
          <SectionHeader label={filter === 'outstanding' ? 'Outstanding' : 'All money jobs'} />
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
          pipeline.js (auto-close on overpayment) and we refresh. */}
      <AnimatePresence>
        {payingRow && (
          <V3PaymentSheet
            contact={payingRow.job}
            balance={payingRow.balance}
            onClose={() => setPayingRow(null)}
            onLogged={() => { setPayingRow(null); refresh() }}
          />
        )}
      </AnimatePresence>
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
function BalanceStateChip({ totals }) {
  const overdueCount = totals['60+'] > 0 ? totals.count : 0
  // Variant selection — overdue beats collect beats none.
  let variant
  if (totals.count === 0) variant = 'none'
  else if (totals['60+'] > 0) variant = 'overdue'
  else variant = 'collect'

  const styles = {
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
  }[variant]

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
function AgingBar({ totals }) {
  const total = totals.total || 0
  if (total <= 0) return null
  const pct = (n) => (Number(n) / total) * 100
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
function PaymentCard({ row, onPDF, onPaid, onEmail, isSending, isSent }) {
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
