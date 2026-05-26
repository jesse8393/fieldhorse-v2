// SnowSubs — desktop /subs in the Snow direction.
//
// New desktop dispatch on Subs.tsx at >=900px. Card grid flips to a
// sortable directory table.

import { useMemo, useState } from 'react'
import { Plus, Search, ArrowUp, ArrowDown } from 'lucide-react'

type SubRow = {
  key: string
  name: string
  phone: string
  trades: Set<string>
  jobsCount: number
  totalRate: number
  lastWorked: Date | null
}

type Props = {
  filtered: SubRow[]
  loading: boolean
  q: string
  setQ: (q: string) => void
  tradeFilter: string
  setTradeFilter: (t: string) => void
  allTrades: string[]
  screenStats: { totalSubs?: number; activeRecent?: number; totalBilled?: number; topTrade?: string | null } | null
  onAddSub: () => void
  onOpenSub: (key: string) => void
}

type SortKey = 'name' | 'jobs' | 'billed' | 'last'
type SortDir = 'asc' | 'desc'

function money(n: number) {
  if (!n) return '$0'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n).toLocaleString()}`
}
function fullMoney(n: number) {
  if (!n) return '$0'
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function fmtPhone(s: string): string {
  const d = String(s || '').replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d.startsWith('1')) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return s
}
function relTime(d: Date | null): string {
  if (!d) return '—'
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000)
  if (diffMin < 60) return `${diffMin}m`
  const h = Math.floor(diffMin / 60)
  if (h < 24) return `${h}h`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d`
  if (days < 30) return `${Math.floor(days / 7)}w`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function SnowSubs(props: Props) {
  const { filtered, loading, q, setQ, tradeFilter, setTradeFilter, allTrades, screenStats, onAddSub, onOpenSub } = props

  const [sortKey, setSortKey] = useState<SortKey>('last')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir(k === 'name' ? 'asc' : 'desc') }
  }

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name) * dir
      if (sortKey === 'jobs') return (a.jobsCount - b.jobsCount) * dir
      if (sortKey === 'billed') return (a.totalRate - b.totalRate) * dir
      const at = a.lastWorked ? a.lastWorked.getTime() : 0
      const bt = b.lastWorked ? b.lastWorked.getTime() : 0
      return (at - bt) * dir
    })
  }, [filtered, sortKey, sortDir])

  return (
    <div style={{ padding: '20px 8px 48px', color: 'var(--v3-text)' }}>

      {/* HEADER ============================================ */}
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div style={{ minWidth: 0 }}>
          <div style={eyebrowStyle}>Directory · {filtered.length} {filtered.length === 1 ? 'sub' : 'subs'}</div>
          <h1 style={{ margin: '6px 0 0', fontFamily: 'var(--font-display)', fontSize: 32, lineHeight: 1.05, letterSpacing: '0.01em', color: 'var(--v3-text)' }}>
            Subs <span style={{ color: 'var(--v3-primary)' }}>& Vendors</span>
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--v3-text-muted)', pointerEvents: 'none' }} />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search subs, trades, phones..."
              style={searchInput}
            />
          </div>
          <button type="button" onClick={onAddSub} style={primaryBtn}>
            <Plus size={14} strokeWidth={2.5} />
            Add sub
          </button>
        </div>
      </header>

      {/* KPI ROW ============================================ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        <KPITile label="Total subs"        value={String(screenStats?.totalSubs ?? filtered.length)} />
        <KPITile label="Active (30 days)"  value={String(screenStats?.activeRecent ?? 0)} sub="on a job recently" />
        <KPITile label="Total billed"      value={money(screenStats?.totalBilled ?? 0)} accent />
        <KPITile label="Top trade"         value={screenStats?.topTrade || '—'} sub={`${allTrades.length} trades total`} />
      </div>

      {/* TRADE FILTER PILLS ================================ */}
      {allTrades.length > 0 && (
        <div role="tablist" aria-label="Trade filter" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          <button type="button" onClick={() => setTradeFilter('')} style={pillStyle(tradeFilter === '')}>All</button>
          {allTrades.map((t) => (
            <button key={t} type="button" onClick={() => setTradeFilter(t)} style={pillStyle(tradeFilter === t)}>{t}</button>
          ))}
        </div>
      )}

      {/* TABLE ============================================== */}
      <section style={panelStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-body)' }}>
          <thead>
            <tr>
              <SortableTh active={sortKey === 'name'}   dir={sortDir} onClick={() => toggleSort('name')}>Sub</SortableTh>
              <th style={thStaticStyle}>Trades</th>
              <SortableTh active={sortKey === 'jobs'}   dir={sortDir} onClick={() => toggleSort('jobs')}   align="right">Jobs</SortableTh>
              <SortableTh active={sortKey === 'billed'} dir={sortDir} onClick={() => toggleSort('billed')} align="right">Total billed</SortableTh>
              <SortableTh active={sortKey === 'last'}   dir={sortDir} onClick={() => toggleSort('last')}   align="right">Last worked</SortableTh>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} style={{ ...tdStyle, color: 'var(--v3-text-muted)', textAlign: 'center', padding: '24px 16px' }}>Loading…</td></tr>}
            {!loading && sorted.length === 0 && (
              <tr><td colSpan={5} style={{ ...tdStyle, color: 'var(--v3-text-muted)', textAlign: 'center', padding: '32px 16px' }}>
                {q || tradeFilter ? 'No subs match that filter.' : 'No subs yet — hit + Add sub.'}
              </td></tr>
            )}
            {!loading && sorted.map((g) => {
              const initial = (g.name || '·').trim().charAt(0).toUpperCase()
              return (
                <tr
                  key={g.key}
                  onClick={() => onOpenSub(g.key)}
                  style={trRowStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--v3-surface-2, rgba(255, 240, 210, 0.03))')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span aria-hidden="true" style={avatarStyle}>{initial}</span>
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}>{g.name}</span>
                        {g.phone && (
                          <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>{fmtPhone(g.phone)}</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {Array.from(g.trades).slice(0, 4).map((t) => (
                        <span key={t} style={tradeChipStyle}>{t}</span>
                      ))}
                      {g.trades.size > 4 && (
                        <span style={{ ...tradeChipStyle, color: 'var(--v3-text-muted)' }}>+{g.trades.size - 4}</span>
                      )}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: 13, fontVariantNumeric: 'tabular-nums', color: 'var(--v3-text)' }}>{g.jobsCount}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: g.totalRate > 0 ? 'var(--v3-text)' : 'var(--v3-text-muted)' }}>{fullMoney(g.totalRate)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{relTime(g.lastWorked)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {!loading && sorted.length > 0 && (
        <div style={{ marginTop: 12, fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)', textAlign: 'right' }}>
          {sorted.length} {sorted.length === 1 ? 'sub' : 'subs'} {tradeFilter ? `in ${tradeFilter}` : 'total'}{q ? ` matching "${q}"` : ''}
        </div>
      )}
    </div>
  )
}

// ============================================================
// PRIMITIVES
// ============================================================

function KPITile({ label, value, sub, accent }: any) {
  const valColor = accent ? 'var(--v3-primary)' : 'var(--v3-text)'
  return (
    <div style={{
      background: 'var(--v3-surface, #141110)',
      border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
      borderRadius: 6, padding: '16px 18px',
      display: 'flex', flexDirection: 'column', gap: 8,
      minHeight: 104
    }}>
      <span style={eyebrowStyle}>{label}</span>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 30, lineHeight: 1, letterSpacing: '-0.01em', color: valColor, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {sub && <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)' }}>{sub}</span>}
    </div>
  )
}

function SortableTh({ children, active, dir, onClick, align }: any) {
  return (
    <th onClick={onClick} style={{
      textAlign: align || 'left',
      fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.14em', textTransform: 'uppercase',
      color: active ? 'var(--v3-text)' : 'var(--v3-text-muted)',
      padding: '12px 16px',
      borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
      cursor: 'pointer', userSelect: 'none'
    }}>
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
  fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
  letterSpacing: '0.18em', textTransform: 'uppercase',
  color: 'var(--v3-text-muted)'
}

const panelStyle: React.CSSProperties = {
  background: 'var(--v3-surface, #141110)',
  border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
  borderRadius: 6, overflow: 'hidden'
}

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: 'var(--v3-primary)',
  color: 'var(--v3-on-primary, #141414)',
  border: 'none', borderRadius: 4, padding: '8px 14px',
  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
  letterSpacing: '0.02em', cursor: 'pointer',
  boxShadow: '0 0 0 1px color-mix(in srgb, var(--v3-primary) 30%, transparent), 0 2px 8px color-mix(in srgb, var(--v3-primary) 20%, transparent)'
}

const searchInput: React.CSSProperties = {
  width: 320, padding: '8px 12px 8px 32px', borderRadius: 4,
  background: 'var(--v3-surface, #141110)',
  border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
  color: 'var(--v3-text)', fontFamily: 'var(--font-body)',
  fontSize: 13, outline: 'none'
}

const thStaticStyle: React.CSSProperties = {
  textAlign: 'left',
  fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
  letterSpacing: '0.14em', textTransform: 'uppercase',
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
  cursor: 'pointer',
  transition: 'background 120ms ease'
}

const avatarStyle: React.CSSProperties = {
  flexShrink: 0, width: 32, height: 32, borderRadius: 6,
  background: 'var(--v3-surface-2, rgba(255, 240, 210, 0.04))',
  border: '1px solid color-mix(in srgb, var(--v3-primary) 22%, transparent)',
  display: 'grid', placeItems: 'center',
  fontFamily: 'var(--font-display)', fontSize: 14,
  letterSpacing: '0.04em', color: 'var(--v3-primary)'
}

const tradeChipStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  padding: '2px 8px', borderRadius: 999,
  background: 'var(--v3-surface-2, rgba(255, 240, 210, 0.04))',
  border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
  color: 'var(--v3-text)',
  fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 600,
  letterSpacing: '0.04em'
}

function pillStyle(on: boolean): React.CSSProperties {
  return {
    padding: '5px 12px', borderRadius: 999,
    background: on ? 'var(--v3-primary)' : 'var(--v3-surface, #141110)',
    border: on ? '1px solid var(--v3-primary)' : '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
    color: on ? 'var(--v3-on-primary, #141414)' : 'var(--v3-text-muted)',
    fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
    letterSpacing: '0.06em', textTransform: 'uppercase',
    cursor: 'pointer', transition: 'background 120ms ease, color 120ms ease'
  }
}
