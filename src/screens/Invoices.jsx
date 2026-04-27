import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Receipt, FileDown, DollarSign, AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useProfile } from '../contexts/ProfileContext.jsx'
import { generateInvoice, downloadPdf } from '../lib/pdf.js'
import { logPayment } from '../lib/pipeline.js'
import { toastSuccess, toastError } from '../lib/toast.js'
import { SkeletonList } from '../components/Skeleton.jsx'
import EmptyState from '../components/EmptyState.jsx'

// Invoices / AR screen — Phase 19 / Upgrade Move #A3+#A4.
//
// Aggregates jobs in the active money pipeline (stage in ['job',
// 'invoice']) and computes outstanding balance per job by subtracting
// paid totals from contract amount. Auto-buckets by aging.
//
// V1 simplifications (flag for future):
//   - Aging anchor is the contact's created_at since we don't track
//     `invoiced_at` history. A future migration can add that column +
//     this screen will switch to it.
//   - "Generate invoice PDF" pulls a single line item from the job's
//     contract amount; line-item invoicing per change order is deferred.
//   - "Mark paid" inserts a single fh_payment for the FULL balance.
//     Partial-payment UI is deferred.

const AGING_BUCKETS = [
  { id: '0-30',  label: 'Current (0–30 d)',   max: 30,  color: 'var(--ink-muted)' },
  { id: '31-60', label: 'Late (31–60 d)',     max: 60,  color: 'var(--field-gold-bright)' },
  { id: '60+',   label: 'Overdue (60+ d)',    max: Infinity, color: 'var(--alert-red)' }
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

  const refresh = async () => {
    if (!user) return
    setLoading(true)
    const [{ data: js }, { data: ps }] = await Promise.all([
      supabase.from('fh_contacts').select('*').in('stage', ['job', 'invoice', 'closed']).order('created_at', { ascending: false }),
      supabase.from('fh_payments').select('*')
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

  async function handleMarkPaid(row) {
    if (!window.confirm(`Mark ${fmtMoney(row.balance)} as paid for ${row.job.name}?`)) return
    const { error } = await logPayment(row.job, {
      amount: row.balance,
      method: 'check',
      reference: '',
      paid_on: new Date().toISOString().slice(0, 10)
    })
    if (error) {
      toastError("Couldn't record payment", error.message)
      return
    }
    toastSuccess('Payment recorded', `${fmtMoney(row.balance)} for ${row.job.name}`)
    await refresh()
  }

  return (
    <div style={{ padding: '20px 20px 80px' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
          <Receipt size={12} />
          Money owed
        </div>
        <h1 className="fh-font-serif" style={{ margin: '6px 0 0', fontSize: 'clamp(28px, 7vw, 36px)', lineHeight: 1.05, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}>
          {totals.count > 0 ? (
            <>
              {fmtMoney(totals.total)} <em className="fh-font-serif-italic fh-text-gradient-gold">outstanding.</em>
            </>
          ) : (
            <>All <em className="fh-font-serif-italic fh-text-gradient-gold">caught up.</em></>
          )}
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)' }}>
          {totals.count > 0
            ? `${totals.count} job${totals.count === 1 ? '' : 's'} with a balance. Tap any row to download the invoice PDF or mark paid.`
            : 'No jobs with an outstanding balance right now.'}
        </p>
      </div>

      {/* Aging buckets */}
      {totals.total > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 18 }}>
          {AGING_BUCKETS.map((b) => (
            <div key={b.id} style={{ padding: '12px 10px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--rule)' }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: b.color, marginBottom: 4 }}>
                {b.label}
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(18px, 4.5vw, 22px)', color: 'var(--ink-strong)' }}>
                {fmtMoney(totals[b.id])}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <FilterPill active={filter === 'outstanding'} onClick={() => setFilter('outstanding')} label="Outstanding" />
        <FilterPill active={filter === 'all'} onClick={() => setFilter('all')} label="All money jobs" />
      </div>

      {loading && <SkeletonList rows={4} />}
      {!loading && filtered.length === 0 && (
        <EmptyState
          title={filter === 'outstanding' ? 'Nothing outstanding.' : 'No jobs in money Pipeline yet.'}
          body={filter === 'outstanding' ? 'Every active job is paid in full.' : 'Approve a quote to move it into the money Pipeline.'}
        />
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map((r) => (
          <InvoiceRow key={r.job.id} row={r} onPDF={() => handleGeneratePDF(r)} onPaid={() => handleMarkPaid(r)} />
        ))}
      </ul>
    </div>
  )
}

function FilterPill({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '7px 12px',
        borderRadius: 999,
        border: active ? '1px solid var(--field-gold-bright)' : '1px solid var(--rule)',
        background: active ? 'rgba(201,150,58,0.15)' : 'var(--surface-2)',
        color: active ? 'var(--field-gold-bright)' : 'var(--ink-strong)',
        fontFamily: 'var(--font-body)',
        fontSize: 12,
        fontWeight: active ? 700 : 500,
        cursor: 'pointer'
      }}
    >
      {label}
    </button>
  )
}

function InvoiceRow({ row, onPDF, onPaid }) {
  const { job, amount, paid, balance, ageDays, bucket, isOutstanding } = row
  const bucketMeta = AGING_BUCKETS.find((b) => b.id === bucket) || AGING_BUCKETS[0]
  const pctPaid = amount > 0 ? Math.min(100, Math.max(0, (paid / amount) * 100)) : 0
  return (
    <li style={{ borderRadius: 12, background: 'var(--surface-2)', border: isOutstanding ? `1px solid ${bucket === '60+' ? 'rgba(192,57,43,0.35)' : 'var(--rule)'}` : '1px solid var(--rule)', padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link to={`/jobs/${job.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ink-strong)', textDecoration: 'none' }}>
            <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14 }}>{job.name || 'Unnamed job'}</span>
            <ExternalLink size={11} color="var(--ink-faint)" />
          </Link>
          {job.job_title && <div style={{ marginTop: 2, fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)' }}>{job.job_title}</div>}
        </div>
        <div style={{ flexShrink: 0, textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(18px, 4.5vw, 22px)', color: balance > 0 ? 'var(--ink-strong)' : 'var(--signal-green)' }}>
            {balance > 0 ? fmtMoney(balance) : 'PAID'}
          </div>
          {isOutstanding && (
            <div style={{ marginTop: 2, fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: bucketMeta.color }}>
              {ageDays} d · {bucketMeta.label.split(' ')[0]}
            </div>
          )}
        </div>
      </div>

      {/* Paid progress */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', marginBottom: 4 }}>
          <span>{fmtMoney(paid)} paid of {fmtMoney(amount)}</span>
          <span>{Math.round(pctPaid)}%</span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
          <div style={{ width: `${pctPaid}%`, height: '100%', background: pctPaid >= 100 ? 'var(--signal-green)' : 'linear-gradient(90deg, var(--field-gold-deep), var(--field-gold-bright))', transition: 'width 220ms ease' }} />
        </div>
      </div>

      {isOutstanding && (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onPDF}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--rule)', background: 'var(--surface-2)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            <FileDown size={12} /> Invoice PDF
          </button>
          <button
            type="button"
            onClick={onPaid}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))', color: 'var(--onyx)', fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: '0.12em', cursor: 'pointer' }}
          >
            <DollarSign size={12} /> MARK PAID
          </button>
        </div>
      )}
    </li>
  )
}
