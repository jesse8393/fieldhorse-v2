// SnowJobs — desktop /jobs in the Snow direction.
//
// Drop-in replacement for DesktopJobsBoard. Same props from Jobs.tsx,
// table-first instead of card-grid:
//
//   [Eyebrow · stats]                                [Search...] [+ New lead]
//   [KPI: Pipeline · Active · Needs eyes · Won YTD]
//   [Filter pills: All · Lead · Quote · Active · Won]
//   [Real sortable table: Job · Client · Stage · Amount · Updated]
//
// Click a row → onOpenJob (the wrapping Jobs.tsx drawer still works).

import { useMemo, useState } from 'react'
import { Plus, Search, ArrowUp, ArrowDown } from 'lucide-react'
import { ACTIVE_STAGES } from '../../lib/stages.ts'

type Props = {
  contacts: any[]
  filtered: any[]
  loading: boolean
  filter: string
  setFilter: (id: string) => void
  search: string
  setSearch: (q: string) => void
  photoUrlByJob: Record<string, string>
  featuredId: string | null
  tabCounts: Record<string, number | undefined>
  onOpenJob: (contact: any) => void
  onNewLead: () => void
}

type SortKey = 'name' | 'stage' | 'amount' | 'updated_at'
type SortDir = 'asc' | 'desc'

const FILTERS = [
  { id: 'all',    label: 'All' },
  { id: 'lead',   label: 'Lead' },
  { id: 'quote',  label: 'Quote' },
  { id: 'active', label: 'Doing' },
  { id: 'won',    label: 'Complete' }
]

const STAGE_ORDER: Record<string, number> = {
  lead: 1, quote: 2, job: 3, invoice: 4, closed: 5, lost: 6
}

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
function kFormat(n: any) {
  const v = Number(n || 0)
  if (v >= 1000) return `$${Math.round(v / 1000)}K`
  return fullMoney(v)
}

export default function SnowJobs(props: Props) {
  const { contacts, filtered, loading, filter, setFilter, search, setSearch, tabCounts, onOpenJob, onNewLead } = props

  const [sortKey, setSortKey] = useState<SortKey>('updated_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function toggleSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(k)
      setSortDir(k === 'amount' || k === 'updated_at' ? 'desc' : 'asc')
    }
  }

  // sort the filtered set
  const rows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === 'name') {
        return (a.name || '').localeCompare(b.name || '') * dir
      }
      if (sortKey === 'stage') {
        return ((STAGE_ORDER[a.stage] || 99) - (STAGE_ORDER[b.stage] || 99)) * dir
      }
      if (sortKey === 'amount') {
        return (Number(a.amount || 0) - Number(b.amount || 0)) * dir
      }
      // updated_at
      const at = new Date(a.updated_at || a.created_at || 0).getTime()
      const bt = new Date(b.updated_at || b.created_at || 0).getTime()
      return (at - bt) * dir
    })
    return sorted
  }, [filtered, sortKey, sortDir])

  // KPI computations (live off the *unfiltered* contacts so the tiles
  // reflect the whole pipeline, not whatever filter is active)
  const kpi = useMemo(() => {
    const pipeline = contacts
      .filter((c) => ACTIVE_STAGES.includes(c.stage as string))
      .reduce((s, c) => s + Number(c.amount || 0), 0)
    const active = contacts.filter((c) => ACTIVE_STAGES.includes(c.stage as string)).length
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const needEyes = contacts.filter((c) => {
      if (!ACTIVE_STAGES.includes(c.stage as string)) return false
      const last = new Date(c.updated_at || c.created_at || 0).getTime()
      return Number.isFinite(last) && last < sevenDaysAgo
    }).length
    const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime()
    const wonYTD = contacts
      .filter((c) => (c.stage === 'invoice' || c.stage === 'closed'))
      .filter((c) => {
        const t = new Date(c.updated_at || c.created_at || 0).getTime()
        return Number.isFinite(t) && t >= yearStart
      })
      .reduce((s, c) => s + Number(c.amount || 0), 0)
    return { pipeline, active, needEyes, wonYTD }
  }, [contacts])

  return (
    <div style={{ padding: '20px 8px 48px', color: 'var(--v3-text)' }}>

      {/* HEADER ============================================== */}
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div style={{ minWidth: 0 }}>
          <div style={eyebrowStyle}>Pipeline · {contacts.length} total</div>
          <h1 style={{ margin: '6px 0 0', fontFamily: 'var(--font-display)', fontSize: 32, lineHeight: 1.05, letterSpacing: '0.01em', color: 'var(--v3-text)' }}>
            Jobs <span style={{ color: 'var(--v3-primary)' }}>& Pipeline</span>
          </h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--v3-text-muted)', pointerEvents: 'none' }} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search jobs, contacts, numbers..."
              style={{
                width: 320,
                padding: '8px 12px 8px 32px',
                borderRadius: 4,
                background: 'var(--v3-surface, #141110)',
                border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
                color: 'var(--v3-text)',
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                outline: 'none'
              }}
            />
          </div>
          <button type="button" onClick={onNewLead} style={primaryBtn}>
            <Plus size={14} strokeWidth={2.5} />
            New lead
          </button>
        </div>
      </header>

      {/* KPI ROW ============================================ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        <KPITile label="Total pipeline" value={money(kpi.pipeline)} accent />
        <KPITile label="Active deals" value={String(kpi.active)} sub="in motion" />
        <KPITile label="Need eyes" value={String(kpi.needEyes)} sub="7+ days stale" subTone={kpi.needEyes > 0 ? 'warn' : 'muted'} />
        <KPITile label="Won YTD" value={kFormat(kpi.wonYTD)} sub="this year" />
      </div>

      {/* FILTER PILLS ====================================== */}
      <div role="tablist" aria-label="Stage filter" style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {FILTERS.map((f) => {
          const on = filter === f.id
          const count = tabCounts[f.id]
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setFilter(f.id)}
              style={{
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
              }}
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
              <SortableTh active={sortKey === 'name'}      dir={sortDir} onClick={() => toggleSort('name')}>Job</SortableTh>
              <SortableTh active={sortKey === 'stage'}     dir={sortDir} onClick={() => toggleSort('stage')}>Stage</SortableTh>
              <SortableTh active={sortKey === 'amount'}    dir={sortDir} onClick={() => toggleSort('amount')} align="right">Amount</SortableTh>
              <SortableTh active={sortKey === 'updated_at'} dir={sortDir} onClick={() => toggleSort('updated_at')} align="right">Updated</SortableTh>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={4} style={{ ...tdStyle, color: 'var(--v3-text-muted)', textAlign: 'center', padding: '24px 16px' }}>Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={4} style={{ ...tdStyle, color: 'var(--v3-text-muted)', textAlign: 'center', padding: '32px 16px' }}>
                {filter !== 'all' || search ? 'No jobs match that filter.' : 'No jobs yet — hit + New lead.'}
              </td></tr>
            )}
            {!loading && rows.map((c) => (
              <tr
                key={c.id}
                onClick={() => onOpenJob(c)}
                style={trRowStyle}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--v3-surface-2, rgba(255, 240, 210, 0.03))')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={tdStyle}>
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>{c.name || 'Untitled'}</span>
                    {(c.job_title || c.job_type) && (
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>{c.job_title || c.job_type}</span>
                    )}
                  </div>
                </td>
                <td style={tdStyle}><StageChip stage={c.stage} /></td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--v3-text)' }}>{fullMoney(c.amount || 0)}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{relTime(c.updated_at || c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* FOOTER COUNT ====================================== */}
      {!loading && rows.length > 0 && (
        <div style={{ marginTop: 12, fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)', textAlign: 'right' }}>
          {rows.length} {rows.length === 1 ? 'job' : 'jobs'} {filter !== 'all' ? `in ${filter}` : 'total'}{search ? ` matching "${search}"` : ''}
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

function StageChip({ stage }: { stage: string }) {
  const map: Record<string, { label: string; tone: string }> = {
    lead:    { label: 'Lead',    tone: 'var(--stage-lead, #6B7CA8)'   },
    quote:   { label: 'Quote',   tone: 'var(--stage-quote, #B07A4A)'  },
    job:     { label: 'Active',  tone: 'var(--stage-job, #4F8C5E)'    },
    invoice: { label: 'Invoice', tone: 'var(--stage-invoice, #C9963A)'},
    closed:  { label: 'Closed',  tone: 'var(--steel, #5C5C5C)'         },
    lost:    { label: 'Lost',    tone: 'var(--v3-danger, #C0392B)'     },
  }
  const m = map[stage] || { label: stage || '—', tone: 'var(--steel)' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '2px 8px', borderRadius: 999,
      background: `color-mix(in srgb, ${m.tone} 14%, transparent)`,
      border: `1px solid color-mix(in srgb, ${m.tone} 28%, transparent)`,
      color: m.tone,
      fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.08em', textTransform: 'uppercase'
    }}>
      <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, background: m.tone }} />
      {m.label}
    </span>
  )
}

function relTime(input: any) {
  if (!input) return ''
  const d = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(d.getTime())) return ''
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

const tdStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.06))',
  verticalAlign: 'middle'
}

const trRowStyle: React.CSSProperties = {
  cursor: 'pointer',
  transition: 'background 120ms ease'
}
