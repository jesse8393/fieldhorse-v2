// SnowClients — desktop /clients in the Snow direction.
//
// Drop-in replacement for DesktopClientsDirectory. Same props from
// Clients.tsx, table-first instead of card grid:
//
//   [Eyebrow · stats]                                  [Search...] [+ New]
//   [KPI: Total · Active · Lifetime · Outstanding AR]
//   [(optional duplicates banner)]
//   [Filter pills]
//   [Sortable table: Name · Active jobs · Lifetime · Outstanding · Last activity]
//
// Click a row → onOpenClient.

import { useMemo, useState } from 'react'
import { Plus, Search, ArrowUp, ArrowDown, AlertTriangle } from 'lucide-react'

type Props = {
  rows: any[]
  filtered: any[]
  loading: boolean
  q: string
  setQ: (q: string) => void
  filter: string
  setFilter: (id: string) => void
  filterCounts: Record<string, number | undefined>
  rollupFor: (clientId: string) => { lifetime: number; outstanding: number; active?: number; activeCount?: number; won?: number; wonCount?: number; paid?: number; paidTotal?: number }
  jobs: any[]
  screenStats: { totalClients?: number; activeAccounts?: number; lifetimeRevenue?: number; outstandingAR?: number } | null
  topClientId: string | null
  totalLifetime: number
  duplicateClusters: any[]
  duplicateCount: number
  onOpenClient: (id: string) => void
  onNewClient: () => void
  onReviewDuplicates: () => void
}

type SortKey = 'name' | 'active' | 'lifetime' | 'outstanding' | 'last_activity_at'
type SortDir = 'asc' | 'desc'

const FILTERS = [
  { id: 'all',      label: 'All' },
  { id: 'active',   label: 'Active' },
  { id: 'inactive', label: 'Inactive' }
]

function money(n: any) {
  const v = Number(n || 0)
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`
  return `$${Math.round(v).toLocaleString()}`
}
function fullMoney(n: any) {
  const v = Number(n || 0)
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export default function SnowClients(props: Props) {
  const { rows, filtered, loading, q, setQ, filter, setFilter, filterCounts, rollupFor,
    screenStats, duplicateCount, onOpenClient, onNewClient, onReviewDuplicates } = props

  const [sortKey, setSortKey] = useState<SortKey>('last_activity_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function toggleSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(k)
      setSortDir(k === 'name' ? 'asc' : 'desc')
    }
  }

  // pre-compute the rollups once per render
  const enriched = useMemo(() => {
    return filtered.map((c) => ({ row: c, rollup: rollupFor(c.id) }))
  }, [filtered, rollupFor])

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...enriched].sort((a, b) => {
      if (sortKey === 'name') {
        return (a.row.name || '').localeCompare(b.row.name || '') * dir
      }
      if (sortKey === 'active') {
        return ((a.rollup.active || a.rollup.activeCount || 0) - (b.rollup.active || b.rollup.activeCount || 0)) * dir
      }
      if (sortKey === 'lifetime') {
        return ((a.rollup.lifetime || 0) - (b.rollup.lifetime || 0)) * dir
      }
      if (sortKey === 'outstanding') {
        return ((a.rollup.outstanding || 0) - (b.rollup.outstanding || 0)) * dir
      }
      // last_activity_at
      const at = new Date(a.row.last_activity_at || a.row.created_at || 0).getTime()
      const bt = new Date(b.row.last_activity_at || b.row.created_at || 0).getTime()
      return (at - bt) * dir
    })
  }, [enriched, sortKey, sortDir])

  return (
    <div style={{ padding: '20px 8px 48px', color: 'var(--v3-text)' }}>

      {/* HEADER ============================================== */}
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div style={{ minWidth: 0 }}>
          <div style={eyebrowStyle}>Directory · {rows.length} {rows.length === 1 ? 'client' : 'clients'}</div>
          <h1 style={{ margin: '6px 0 0', fontFamily: 'var(--font-display)', fontSize: 32, lineHeight: 1.05, letterSpacing: '0.01em', color: 'var(--v3-text)' }}>
            Clients
          </h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--v3-text-muted)', pointerEvents: 'none' }} />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search clients, phones, emails..."
              style={searchInput}
            />
          </div>
          <button type="button" onClick={onNewClient} style={primaryBtn}>
            <Plus size={14} strokeWidth={2.5} />
            New client
          </button>
        </div>
      </header>

      {/* KPI ROW ============================================ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        <KPITile label="Total clients"     value={String(screenStats?.totalClients ?? rows.length)} />
        <KPITile label="Active accounts"   value={String(screenStats?.activeAccounts ?? 0)} sub="with open jobs" />
        <KPITile label="Lifetime revenue"  value={money(screenStats?.lifetimeRevenue ?? props.totalLifetime ?? 0)} accent />
        <KPITile label="Outstanding AR"    value={money(screenStats?.outstandingAR ?? 0)}
                 sub={(screenStats?.outstandingAR ?? 0) > 0 ? 'still owed' : 'all paid'}
                 subTone={(screenStats?.outstandingAR ?? 0) > 0 ? 'warn' : 'muted'} />
      </div>

      {/* DUPLICATES BANNER ================================== */}
      {duplicateCount > 0 && (
        <button
          type="button"
          onClick={onReviewDuplicates}
          style={{
            width: '100%', textAlign: 'left',
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px',
            marginBottom: 14,
            background: 'color-mix(in srgb, var(--v3-primary) 8%, var(--v3-surface, #141110))',
            border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
            borderRadius: 6,
            color: 'var(--v3-text)',
            cursor: 'pointer',
            fontFamily: 'var(--font-body)',
            fontSize: 13
          }}
        >
          <AlertTriangle size={14} style={{ color: 'var(--v3-primary)', flexShrink: 0 }} />
          <span style={{ flex: 1 }}>
            <strong style={{ fontWeight: 700 }}>{duplicateCount}</strong> possible duplicate {duplicateCount === 1 ? 'client' : 'clients'} detected.
          </span>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--v3-primary)' }}>Review →</span>
        </button>
      )}

      {/* FILTER PILLS ====================================== */}
      <div role="tablist" aria-label="Status filter" style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {FILTERS.map((f) => {
          const on = filter === f.id
          const count = filterCounts[f.id]
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setFilter(f.id)}
              style={pillStyle(on)}
            >
              {f.label}
              {count != null && <span style={{ opacity: 0.75, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{count}</span>}
            </button>
          )
        })}
      </div>

      {/* TABLE ============================================== */}
      <section style={panelStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-body)' }}>
          <thead>
            <tr>
              <SortableTh active={sortKey === 'name'}             dir={sortDir} onClick={() => toggleSort('name')}>Client</SortableTh>
              <SortableTh active={sortKey === 'active'}           dir={sortDir} onClick={() => toggleSort('active')} align="right">Active jobs</SortableTh>
              <SortableTh active={sortKey === 'lifetime'}         dir={sortDir} onClick={() => toggleSort('lifetime')} align="right">Lifetime</SortableTh>
              <SortableTh active={sortKey === 'outstanding'}      dir={sortDir} onClick={() => toggleSort('outstanding')} align="right">Outstanding</SortableTh>
              <SortableTh active={sortKey === 'last_activity_at'} dir={sortDir} onClick={() => toggleSort('last_activity_at')} align="right">Last activity</SortableTh>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} style={{ ...tdStyle, color: 'var(--v3-text-muted)', textAlign: 'center', padding: '24px 16px' }}>Loading…</td></tr>
            )}
            {!loading && sorted.length === 0 && (
              <tr><td colSpan={5} style={{ ...tdStyle, color: 'var(--v3-text-muted)', textAlign: 'center', padding: '32px 16px' }}>
                {filter !== 'all' || q ? 'No clients match that filter.' : 'No clients yet — hit + New client.'}
              </td></tr>
            )}
            {!loading && sorted.map(({ row, rollup }) => {
              const activeN = rollup.active || rollup.activeCount || 0
              const initial = (row.name || '·').trim().charAt(0).toUpperCase()
              return (
                <tr
                  key={row.id}
                  onClick={() => onOpenClient(row.id)}
                  style={trRowStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--v3-surface-2, rgba(255, 240, 210, 0.03))')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span aria-hidden="true" style={avatarStyle}>{initial}</span>
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280 }}>{row.name || 'Unnamed'}</span>
                        {row.company_name && (
                          <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280 }}>{row.company_name}</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {activeN > 0 ? (
                      <span style={activePillStyle}>{activeN} active</span>
                    ) : (
                      <span style={{ color: 'var(--v3-text-muted)', fontSize: 12 }}>—</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--v3-text)' }}>{fullMoney(rollup.lifetime || 0)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: rollup.outstanding > 0 ? 'var(--v3-danger-bright, #f5a294)' : 'var(--v3-text-muted)' }}>
                    {rollup.outstanding > 0 ? fullMoney(rollup.outstanding) : '—'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{relTime(row.last_activity_at || row.created_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {!loading && sorted.length > 0 && (
        <div style={{ marginTop: 12, fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)', textAlign: 'right' }}>
          {sorted.length} {sorted.length === 1 ? 'client' : 'clients'} {filter !== 'all' ? `in ${filter}` : 'total'}{q ? ` matching "${q}"` : ''}
        </div>
      )}
    </div>
  )
}

// ============================================================
// PRIMITIVES (same styling as SnowHome / SnowJobs)
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
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: subTone === 'warn' ? 'var(--v3-primary)' : 'var(--v3-text-muted)' }}>{sub}</span>
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

function relTime(input: any) {
  if (!input) return '—'
  const d = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(d.getTime())) return '—'
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000)
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m`
  const h = Math.floor(diffMin / 60)
  if (h < 24) return `${h}h`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d`
  if (days < 30) return `${Math.floor(days / 7)}w`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: 'var(--v3-primary)',
  color: 'var(--v3-on-primary, #141414)',
  border: 'none',
  borderRadius: 4,
  padding: '8px 14px',
  fontFamily: 'var(--font-body)',
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: '0.02em',
  cursor: 'pointer',
  boxShadow: '0 0 0 1px color-mix(in srgb, var(--v3-primary) 30%, transparent), 0 2px 8px color-mix(in srgb, var(--v3-primary) 20%, transparent)'
}

const searchInput: React.CSSProperties = {
  width: 320,
  padding: '8px 12px 8px 32px',
  borderRadius: 4,
  background: 'var(--v3-surface, #141110)',
  border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
  color: 'var(--v3-text)',
  fontFamily: 'var(--font-body)',
  fontSize: 13,
  outline: 'none'
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
  flexShrink: 0,
  width: 32, height: 32,
  borderRadius: 6,
  background: 'var(--v3-surface-2, rgba(255, 240, 210, 0.04))',
  border: '1px solid color-mix(in srgb, var(--v3-primary) 22%, transparent)',
  display: 'grid', placeItems: 'center',
  fontFamily: 'var(--font-display)',
  fontSize: 14,
  letterSpacing: '0.04em',
  color: 'var(--v3-primary)'
}

const activePillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--v3-success-bright, #4ade80) 14%, transparent)',
  border: '1px solid color-mix(in srgb, var(--v3-success-bright, #4ade80) 30%, transparent)',
  color: 'var(--v3-success-bright, #4ade80)',
  fontFamily: 'var(--font-body)',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em'
}

function pillStyle(on: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '6px 12px',
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
