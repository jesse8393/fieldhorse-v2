import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Receipt, FileDown, DollarSign, ExternalLink, Check } from 'lucide-react'
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

  const refresh = async () => {
    if (!user) return
    setLoading(true)
    const [{ data: js }, { data: ps }] = await Promise.all([
      supabase.from('fh_contacts').select('*').eq('user_id', user.id).in('stage', ['job', 'invoice', 'closed']).order('created_at', { ascending: false }),
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

  const company = useMemo(() => ({
    name: profile?.company_name || profile?.full_name || 'My Company',
    address: profile?.company_address || '',
    phone: profile?.company_phone || '',
    email: profile?.email || ''
  }), [profile])

  function handleGeneratePDF(row) {
    // Audit caught this as a no-op. Wrap in try/catch so a jsPDF
    // failure surfaces a real error instead of silently swallowing,
    // and so the user sees a toast immediately on click instead of
    // wondering if anything happened.
    try {
      const result = generateInvoice({
        company,
        contact: {
          name: row.job.name || row.job.client_name || 'Client',
          address: row.job.address || '',
          phone: row.job.phone || '',
          email: row.job.email || ''
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

  const { stagger, item } = useFhMotion()
  const allCaughtUp = !loading && totals.count === 0

  return (
    <motion.div
      className="v3-screen"
      variants={stagger}
      initial="hidden"
      animate="show"
      style={{ paddingBottom: 120, position: 'relative', background: 'var(--v3-bg)' }}
    >
      {/* COCKPIT — black-glass A/R panel: title eyebrow + state chip +
          headline total + aging bar + 3-cell aging breakdown.
          Backdrop-filter + neutral inner highlight match the v3 black-
          glass treatment shipped on Schedule/Notes/Home cockpits. */}
      <motion.div variants={item} style={{ padding: '8px 20px 12px' }}>
        <div style={{
          padding: '14px 16px',
          borderRadius: 16,
          background: 'var(--v3-surface-glass)',
          backdropFilter: 'blur(14px) saturate(1.1)',
          WebkitBackdropFilter: 'blur(14px) saturate(1.1)',
          border: '1px solid var(--v3-border)',
          boxShadow: '0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 8px 22px rgba(0, 0, 0, 0.40)'
        }}>
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
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--v3-border)' }}>
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
                onPDF={() => handleGeneratePDF(r)}
                onPaid={() => openPaymentSheet(r)}
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
function PaymentCard({ row, onPDF, onPaid }) {
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
              to={`/jobs/${job.id}`}
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
              <ExternalLink size={11} color="var(--v3-text-muted)" />
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

        {/* Action row: PDF + Mark Paid (only on outstanding) */}
        {isOutstanding && (
          <div style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            paddingTop: 4
          }}>
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
              <FileDown size={13} /> Invoice PDF
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
