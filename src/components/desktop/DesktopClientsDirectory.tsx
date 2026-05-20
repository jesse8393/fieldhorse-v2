import { useMemo, useState, useEffect } from 'react'
import { Plus, Search, Phone, Mail, MessageSquare, Map } from 'lucide-react'
import { hapticTap, hapticMedium } from '../../lib/haptics.ts'

/**
 * DesktopClientsDirectory — desktop-first composition for /clients at >=900px.
 *
 * Phase 7 of the Responsive Desktop Command Center. Replaces the
 * stretched ClientTile grid with a real directory layout patterned on
 * _reference/fieldhorse-v3-design/desktop-flows-1.jsx::DesktopClients.
 *
 * Layout:
 *   ┌─ page header ────────────────────────────────────────────────┐
 *   │ EYEBROW · {n} clients · ${k}M lifetime          [+ New client]│
 *   │ Clients                                                       │
 *   │ {x} owe a balance · ${y}K outstanding                         │
 *   ├─ KPI strip (4 cards) ───────────────────────────────────────┤
 *   │ Lifetime billed | Active jobs | Outstanding | Avg job size   │
 *   ├─ list + detail (1.6fr / 1fr) ──────────────────────────────┤
 *   │ ┌──────────────────────┐  ┌──────────────────────────────┐  │
 *   │ │ search + filter pills │  │ avatar + name + meta + chips │  │
 *   │ │ row · row · row       │  │ KPI mini grid                │  │
 *   │ │ ...                   │  │ Active jobs list             │  │
 *   │ │                       │  │ Call · Email · + New job     │  │
 *   │ └──────────────────────┘  └──────────────────────────────┘  │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * The detail panel selects the first client by default and updates
 * when the operator clicks any list row. Clicking the avatar / row
 * twice (or pressing Enter on a focused row) navigates to the full
 * client detail page via onOpenClient.
 *
 * Active jobs in the detail panel pull from the same `jobs` array
 * that the parent Clients screen already fetches.
 */

function money(n: any) {
  const v = Number(n || 0)
  if (!v) return '$0'
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 1 : 2)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}K`
  return `$${Math.round(v).toLocaleString()}`
}

function clientInitials(name: any) {
  if (!name) return '·'
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
}

function relative(date: any) {
  if (!date) return null
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return null
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

const FILTERS = [
  { id: 'all',    label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'recent', label: 'Recent' }
]

export default function DesktopClientsDirectory({
  rows,
  filtered,
  loading,
  q,
  setQ,
  filter,
  setFilter,
  filterCounts,
  rollupFor,
  jobs,
  screenStats,
  topClientId,
  totalLifetime,
  onOpenClient,
  onNewClient
}: any) {
  const [selectedId, setSelectedId] = useState(null)
  // Default selection follows the filtered list — top-of-list when
  // available, with a graceful fallback when the filter empties.
  useEffect(() => {
    if (!filtered || filtered.length === 0) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !filtered.some((r: any) => r.id === selectedId)) {
      setSelectedId(filtered[0].id)
    }
  }, [filtered, selectedId])

  const selected = useMemo(
    () => (selectedId ? filtered?.find((r: any) => r.id === selectedId) || null : null),
    [filtered, selectedId]
  )

  // Active jobs for the selected client — derived from the jobs array
  // already fetched by Clients.jsx (no extra round-trip).
  const selectedJobs = useMemo(() => {
    if (!selected || !Array.isArray(jobs)) return []
    return jobs.filter((j) => j.client_id === selected.id)
  }, [selected, jobs])

  // KPI strip values — totals across all (unfiltered) clients.
  const avgJobSize = useMemo(() => {
    if (!Array.isArray(jobs) || jobs.length === 0) return 0
    const total = jobs.reduce((s, j) => s + Number(j.amount || 0), 0)
    return Math.round(total / jobs.length)
  }, [jobs])

  return (
    <div className="dt-clients">
      {/* PAGE HEADER */}
      <header className="dt-clients__head">
        <div className="dt-clients__head-text">
          <span className="dt-clients__eyebrow">
            {loading ? 'Loading…' : (
              <>
                <strong>{rows?.length || 0}</strong> {rows?.length === 1 ? 'client' : 'clients'}
                {totalLifetime > 0 && <> · <strong>{money(totalLifetime)}</strong> lifetime</>}
              </>
            )}
          </span>
          <h1 className="dt-clients__h1">Clients</h1>
          {!loading && screenStats?.outstanding > 0 && (
            <p className="dt-clients__sub">
              {screenStats.owesAccounts} owe a balance · <strong>{money(screenStats.outstanding)}</strong> outstanding
            </p>
          )}
        </div>
        <div className="dt-clients__head-actions">
          <button
            type="button"
            className="dt-clients__primary"
            onClick={() => { hapticMedium(); onNewClient?.() }}
          >
            <Plus size={14} strokeWidth={2.4} />
            <span>New client</span>
          </button>
        </div>
      </header>

      {/* KPI STRIP */}
      <div className="dt-clients__kpis">
        <KpiCard label="Lifetime billed" value={money(totalLifetime || 0)} sub={`across ${rows?.length || 0} ${rows?.length === 1 ? 'client' : 'clients'}`} />
        <KpiCard label="Active jobs" value={String(screenStats?.activeAccounts || 0)} sub={`${(jobs || []).filter((j: any) => j.stage === 'job' || j.stage === 'invoice').length} in motion`} />
        <KpiCard label="Outstanding" value={money(screenStats?.outstanding || 0)} sub={`${screenStats?.owesAccounts || 0} client${screenStats?.owesAccounts === 1 ? '' : 's'} owe`} tone={screenStats?.outstanding > 0 ? 'alert' : 'muted'} />
        <KpiCard label="Avg job size" value={money(avgJobSize)} sub={`across ${(jobs || []).length} ${(jobs || []).length === 1 ? 'job' : 'jobs'}`} />
      </div>

      {/* LIST + DETAIL */}
      <div className="dt-clients__split">
        {/* LIST PANE */}
        <div className="dt-card dt-clients__list-card">
          <div className="dt-clients__list-head">
            <div className="dt-clients__search">
              <Search size={13} aria-hidden="true" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search clients"
                aria-label="Search clients"
              />
            </div>
            <div className="dt-clients__filt-pills">
              {FILTERS.map((f) => {
                const on = filter === f.id
                const count = filterCounts?.[f.id]
                return (
                  <button
                    key={f.id}
                    type="button"
                    className={`dt-filt${on ? ' dt-filt--on' : ''}`}
                    onClick={() => { hapticTap(); setFilter(f.id) }}
                  >
                    {f.label}
                    {count != null && <span className="dt-filt__c">{count}</span>}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="dt-clients__list">
            {loading && Array.from({ length: 6 }).map((_, i) => (
              <div key={`sk-${i}`} className="dt-clients__row dt-clients__row--skeleton" aria-hidden="true">
                <span className="dt-clients__row-av" />
                <span style={{ flex: 1, height: 14, background: 'rgba(255,255,255,0.06)', borderRadius: 4 }} />
                <span style={{ width: 60, height: 14, background: 'rgba(255,255,255,0.06)', borderRadius: 4 }} />
              </div>
            ))}
            {!loading && (filtered?.length || 0) === 0 && (
              <div className="dt-clients__empty">
                <p>No clients match.</p>
              </div>
            )}
            {!loading && (filtered || []).map((c: any) => {
              const r = rollupFor ? rollupFor(c.id) : { lifetime: 0, outstanding: 0, activeCount: 0 }
              const isSelected = c.id === selectedId
              const isTop = c.id === topClientId
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`dt-clients__row${isSelected ? ' is-selected' : ''}${isTop ? ' is-top' : ''}`}
                  onClick={() => { hapticTap(); setSelectedId(c.id) }}
                  onDoubleClick={() => { hapticTap(); onOpenClient?.(c.id) }}
                >
                  <span className="dt-clients__row-av" aria-hidden="true">
                    {clientInitials(c.name)}
                  </span>
                  <div className="dt-clients__row-main">
                    <span className="dt-clients__row-name">{c.name || 'Unnamed client'}</span>
                    <span className="dt-clients__row-sub">
                      {c.company_name || (r.outstanding > 0
                        ? `${money(r.outstanding)} outstanding`
                        : r.activeCount > 0
                          ? `${r.activeCount} active`
                          : c.last_activity_at
                            ? `Last · ${relative(c.last_activity_at)}`
                            : 'No activity yet')}
                    </span>
                  </div>
                  <div className="dt-clients__row-money">
                    <span className="dt-clients__row-amt">{money(r.lifetime)}</span>
                    <span className="dt-clients__row-jobs">
                      {r.activeCount > 0 ? `${r.activeCount} active` : '0 active'}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* DETAIL PANE */}
        <aside className="dt-card dt-clients__detail">
          {!selected ? (
            <div className="dt-clients__detail-empty">
              <p>Select a client on the left to see their account.</p>
            </div>
          ) : (
            <DetailContent
              client={selected}
              rollup={rollupFor ? rollupFor(selected.id) : null}
              jobs={selectedJobs}
              onOpenClient={onOpenClient}
            />
          )}
        </aside>
      </div>
    </div>
  )
}

function KpiCard({ label, value, sub, tone }: any) {
  return (
    <div className={`dt-card dt-kpi${tone === 'alert' ? ' dt-kpi--alert' : ''}`}>
      <span className="dt-kpi__label">{label}</span>
      <span className="dt-kpi__value">{value}</span>
      {sub && <span className="dt-kpi__sub">{sub}</span>}
    </div>
  )
}

function DetailContent({ client, rollup, jobs, onOpenClient }: any) {
  const r = rollup || { lifetime: 0, outstanding: 0, activeCount: 0 }
  const totalAmt = (jobs || []).reduce((s: any, j: any) => s + Number(j.amount || 0), 0)
  const avgMargin = null  // FieldHorse doesn't track per-job cost yet — omit field.
  return (
    <div className="dt-clients__detail-inner">
      <div className="dt-clients__detail-head">
        <span className="dt-clients__detail-av" aria-hidden="true">
          {clientInitials(client.name)}
        </span>
        <div className="dt-clients__detail-meta">
          <span className="dt-clients__detail-name">{client.name || 'Unnamed client'}</span>
          {client.company_name && (
            <span className="dt-clients__detail-sub">{client.company_name}</span>
          )}
          {client.last_activity_at && (
            <span className="dt-clients__detail-sub">
              Last activity · {relative(client.last_activity_at) || '—'}
            </span>
          )}
          <div className="dt-clients__detail-chips">
            {r.activeCount > 0 && <span className="dt-pill dt-pill--gold">{r.activeCount} ACTIVE</span>}
            {r.outstanding > 0 && <span className="dt-pill dt-pill--alert">{money(r.outstanding)} OWED</span>}
            {r.activeCount === 0 && r.outstanding === 0 && r.lifetime > 0 && (
              <span className="dt-pill dt-pill--good">PAID UP</span>
            )}
          </div>
        </div>
      </div>

      <div className="dt-clients__detail-mini">
        <MiniStat label="LIFETIME" value={money(r.lifetime)} />
        <MiniStat label="JOBS" value={String((jobs || []).length)} />
        <MiniStat label="TOTAL" value={money(totalAmt)} />
      </div>

      <div className="dt-clients__detail-jobs">
        <span className="dt-clients__detail-eyebrow">
          Jobs · {(jobs || []).length}
        </span>
        {(jobs || []).length === 0 ? (
          <p className="dt-clients__detail-empty-line">No jobs linked yet.</p>
        ) : (
          <ul className="dt-clients__detail-job-list">
            {(jobs || []).slice(0, 6).map((j: any) => (
              <li key={j.id} className="dt-clients__detail-job-row">
                <div>
                  <span className="dt-clients__detail-job-name">
                    {j.job_title || j.job_type || j.name || 'Untitled'}
                  </span>
                  <span className="dt-clients__detail-job-meta">
                    {String(j.stage || 'lead').toUpperCase()}
                    {j.proposal_status === 'sent' && ' · sent'}
                    {j.proposal_status === 'approved' && ' · approved'}
                  </span>
                </div>
                <span className="dt-clients__detail-job-amt">{money(j.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="dt-clients__detail-actions">
        {client.phone ? (
          <a className="dt-detail-btn" href={`tel:${client.phone}`} onClick={hapticTap}>
            <Phone size={13} aria-hidden="true" /> Call
          </a>
        ) : (
          <span className="dt-detail-btn dt-detail-btn--disabled">Call</span>
        )}
        {client.phone ? (
          <a className="dt-detail-btn" href={`sms:${client.phone}`} onClick={hapticTap}>
            <MessageSquare size={13} aria-hidden="true" /> Text
          </a>
        ) : null}
        {client.email ? (
          <a className="dt-detail-btn" href={`mailto:${client.email}`} onClick={hapticTap}>
            <Mail size={13} aria-hidden="true" /> Email
          </a>
        ) : null}
        {client.address ? (
          <a className="dt-detail-btn" href={`https://maps.apple.com/?address=${encodeURIComponent(client.address)}`} target="_blank" rel="noopener noreferrer" onClick={hapticTap}>
            <Map size={13} aria-hidden="true" /> Map
          </a>
        ) : null}
        <button
          type="button"
          className="dt-detail-btn dt-detail-btn--primary"
          onClick={() => { hapticMedium(); onOpenClient?.(client.id) }}
        >
          Open client →
        </button>
      </div>
    </div>
  )
}

function MiniStat({ label, value }: any) {
  return (
    <div className="dt-mini-stat">
      <span className="dt-mini-stat__l">{label}</span>
      <span className="dt-mini-stat__v">{value}</span>
    </div>
  )
}
