// SnowInvoices — desktop /invoices in the Snow direction.
//
// New desktop dispatch target for Invoices.tsx. Same data, table-first
// AR aging view instead of the mobile card stack.
//
//   [Eyebrow]                                            [Outstanding | All]
//   [Invoices]
//   [KPI: Outstanding · Current 0-30 · Late 31-60 · Overdue 60+]
//   [Sortable table: Job · Client · Aged · Amount · Paid · Balance · Action]
//
// Click row → onOpenJob. Click "Log payment" → onPayRow (opens the
// existing V3PaymentSheet wrapped by Invoices.tsx).

import { useMemo, useState } from 'react'
import { ArrowUp, ArrowDown, DollarSign, FileText } from 'lucide-react'

type Row = {
  job: any
  amount: number
  paid: any
  balance: number
  ageDays: number
  bucket: string
  isOutstanding: boolean
}

type Props = {
  rows: Row[]
  filtered: Row[]
  totals: Record<string, number>
  loading: boolean
  filter: 'outstanding' | 'all'
  setFilter: (f: 'outstanding' | 'all') => void
  onOpenJob: (jobId: string) => void
  onPayRow: (row: Row) => void
}

type SortKey = 'job' | 'aged' | 'amount' | 'balance'
type SortDir = 'asc' | 'desc'

function fullMoney(n: any) {
  return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function money(n: any) {
  const v = Number(n || 0)
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`
  return `$${Math.round(v).toLocaleString()}`
}

function resolveClient(j: any): string {
  const cli = j?.fh_clients || {}
  return j?.name || cli?.name || 'Unnamed'
}

const BUCKET_TONE: Record<string, { label: string; tone: string }> = {
  '0-30':  { label: 'Current',  tone: 'var(--v3-text-muted)' },
  '31-60': { label: 'Late',     tone: 'var(--v3-primary)' },
  '60+':   { label: 'Overdue',  tone: 'var(--v3-danger-bright, #f5a294)' }
}

export default function SnowInvoices(props: Props) {
  const { filtered, totals, loading, filter, setFilter, onOpenJob, onPayRow } = props

  const [sortKey, setSortKey] = useState<SortKey>('balance')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else {
      setSortKey(k)
      setSortDir(k === 'job' ? 'asc' : 'desc')
    }
  }

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (sortKey === 'job') return resolveClient(a.job).localeCompare(resolveClient(b.job)) * dir
      if (sortKey === 'aged') return (a.ageDays - b.ageDays) * dir
      if (sortKey === 'amount') return (a.amount - b.amount) * dir
      return (a.balance - b.balance) * dir
    })
  }, [filtered, sortKey, sortDir])

  return (
    <div style={{ padding: '20px 8px 48px', color: 'var(--v3-text)' }}>

      {/* HEADER ============================================== */}
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div style={{ minWidth: 0 }}>
          <div style={eyebrowStyle}>AR · {totals.count ?? 0} outstanding</div>
          <h1 style={{ margin: '6px 0 0', fontFamily: 'var(--font-display)', fontSize: 32, lineHeight: 1.05, letterSpacing: '0.01em', color: 'var(--v3-text)' }}>
            Invoices <span style={{ color: 'var(--v3-primary)' }}>& AR</span>
          </h1>
        </div>
        <div role="tablist" aria-label="Invoice filter" style={{ display: 'flex', gap: 6 }}>
          <button type="button" role="tab" aria-selected={filter === 'outstanding'} onClick={() => setFilter('outstanding')} style={pillStyle(filter === 'outstanding')}>Outstanding</button>
          <button type="button" role="tab" aria-selected={filter === 'all'} onClick={() => setFilter('all')} style={pillStyle(filter === 'all')}>All</button>
        </div>
      </header>

      {/* KPI ROW ============================================ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        <KPITile label="Outstanding total"  value={money(totals.total)}     accent />
        <KPITile label="Current (0-30 d)"    value={money(totals['0-30'])}   sub="newest" />
        <KPITile label="Late (31-60 d)"      value={money(totals['31-60'])}  sub={totals['31-60'] > 0 ? 'follow up' : 'clear'} subTone={totals['31-60'] > 0 ? 'warn' : 'muted'} />
        <KPITile label="Overdue (60+ d)"     value={money(totals['60+'])}     sub={totals['60+'] > 0 ? 'collections' : 'clear'} subTone={totals['60+'] > 0 ? 'danger' : 'muted'} />
      </div>

      {/* TABLE ============================================== */}
      <section style={panelStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-body)' }}>
          <thead>
            <tr>
              <SortableTh active={sortKey === 'job'}     dir={sortDir} onClick={() => toggleSort('job')}>Job / Client</SortableTh>
              <th style={thStaticStyle}>Aging</th>
              <SortableTh active={sortKey === 'aged'}    dir={sortDir} onClick={() => toggleSort('aged')} align="right">Aged</SortableTh>
              <SortableTh active={sortKey === 'amount'}  dir={sortDir} onClick={() => toggleSort('amount')} align="right">Contract</SortableTh>
              <th style={{ ...thStaticStyle, textAlign: 'right' }}>Paid</th>
              <SortableTh active={sortKey === 'balance'} dir={sortDir} onClick={() => toggleSort('balance')} align="right">Balance</SortableTh>
              <th style={{ ...thStaticStyle, textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} style={{ ...tdStyle, color: 'var(--v3-text-muted)', textAlign: 'center', padding: '24px 16px' }}>Loading…</td></tr>
            )}
            {!loading && sorted.length === 0 && (
              <tr><td colSpan={7} style={{ ...tdStyle, color: 'var(--v3-text-muted)', textAlign: 'center', padding: '32px 16px' }}>
                {filter === 'outstanding' ? 'Nothing outstanding. You\'re paid up.' : 'No money jobs yet.'}
              </td></tr>
            )}
            {!loading && sorted.map((r) => {
              const clientName = resolveClient(r.job)
              const tone = BUCKET_TONE[r.bucket]
              return (
                <tr
                  key={r.job.id}
                  style={trRowStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--v3-surface-2, rgba(255, 240, 210, 0.03))')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={tdStyle} onClick={() => onOpenJob(r.job.id)}>
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, cursor: 'pointer' }}>
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>{clientName}</span>
                      {(r.job.job_title || r.job.job_type) && (
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>{r.job.job_title || r.job.job_type}</span>
                      )}
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '2px 8px', borderRadius: 999,
                      background: `color-mix(in srgb, ${tone.tone} 14%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${tone.tone} 28%, transparent)`,
                      color: tone.tone,
                      fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
                      letterSpacing: '0.08em', textTransform: 'uppercase'
                    }}>
                      <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, background: tone.tone }} />
                      {tone.label}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--v3-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{r.ageDays}d</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: 'var(--v3-text)' }}>{fullMoney(r.amount)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: 13, fontVariantNumeric: 'tabular-nums', color: 'var(--v3-text-muted)' }}>{r.paid > 0 ? fullMoney(r.paid) : '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: r.balance > 0 ? 'var(--v3-primary)' : 'var(--v3-success-bright, #4ade80)' }}>
                    {r.balance > 0 ? fullMoney(r.balance) : 'Paid'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
                      {r.balance > 0.5 && (
                        <button type="button" onClick={() => onPayRow(r)} style={tableActionBtn}>
                          <DollarSign size={11} /> Log payment
                        </button>
                      )}
                      <button type="button" onClick={() => onOpenJob(r.job.id)} style={tableSecondaryBtn}>
                        <FileText size={11} /> Open
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {!loading && sorted.length > 0 && (
        <div style={{ marginTop: 12, fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)', textAlign: 'right' }}>
          {sorted.length} {sorted.length === 1 ? 'invoice' : 'invoices'} {filter === 'outstanding' ? 'outstanding' : 'total'}
        </div>
      )}
    </div>
  )
}

// ============================================================
// PRIMITIVES
// ============================================================

function KPITile({ label, value, sub, subTone, accent }: any) {
  const valColor = accent ? 'var(--v3-primary)' : 'var(--v3-text)'
  return (
    <div style={{
      background: 'var(--v3-surface, #141110)',
      border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
      borderRadius: 6,
      padding: '16px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      minHeight: 104
    }}>
      <span style={eyebrowStyle}>{label}</span>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 30, lineHeight: 1, letterSpacing: '-0.01em', color: valColor, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {sub && (
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: subTone === 'danger' ? 'var(--v3-danger-bright, #f5a294)' : subTone === 'warn' ? 'var(--v3-primary)' : 'var(--v3-text-muted)' }}>{sub}</span>
      )}
    </div>
  )
}

function SortableTh({ children, active, dir, onClick, align }: any) {
  return (
    <th
      onClick={onClick}
      style={{
        textAlign: align || 'left',
        fontFamily: 'var(--font-body)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: active ? 'var(--v3-text)' : 'var(--v3-text-muted)',
        padding: '12px 16px',
        borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
        cursor: 'pointer',
        userSelect: 'none'
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: align === 'right' ? 'flex-end' : 'flex-start', width: '100%' }}>
        {children}
        {active && (dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
      </span>
    </th>
  )
}

// ============================================================
// STYLES
// ============================================================

const eyebrowStyle: React.CSSProperties = {
  fontFamily: 'var(--font-body)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--v3-text-muted)'
}

const panelStyle: React.CSSProperties = {
  background: 'var(--v3-surface, #141110)',
  border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
  borderRadius: 6,
  overflow: 'hidden'
}

const thStaticStyle: React.CSSProperties = {
  textAlign: 'left',
  fontFamily: 'var(--font-body)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--v3-text-muted)',
  padding: '12px 16px',
  borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))'
}

const tdStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.06))',
  verticalAlign: 'middle'
}

const trRowStyle: React.CSSProperties = {
  transition: 'background 120ms ease'
}

const tableActionBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  background: 'var(--v3-primary)',
  color: 'var(--v3-on-primary, #141414)',
  border: 'none', borderRadius: 4,
  padding: '5px 10px',
  fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
  letterSpacing: '0.04em', cursor: 'pointer'
}

const tableSecondaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  background: 'transparent',
  color: 'var(--v3-text-muted)',
  border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
  borderRadius: 4,
  padding: '5px 10px',
  fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600,
  letterSpacing: '0.04em', cursor: 'pointer'
}

function pillStyle(on: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center',
    padding: '6px 14px',
    borderRadius: 999,
    background: on ? 'var(--v3-primary)' : 'var(--v3-surface, #141110)',
    border: on ? '1px solid var(--v3-primary)' : '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
    color: on ? 'var(--v3-on-primary, #141414)' : 'var(--v3-text-muted)',
    fontFamily: 'var(--font-body)',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease'
  }
}
