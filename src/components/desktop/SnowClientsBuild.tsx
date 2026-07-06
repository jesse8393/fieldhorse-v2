// SnowClientsBuild — desktop /clients in the Build direction.
//
// Drop-in for SnowClients at >=900px. Same props, same handlers.
// Treats clients as a relationship desk, not a contact list.

import {
  ArrowUpRight,
  Bell,
  ChevronRight,
  Search,
  Plus,
  AlertTriangle,
} from 'lucide-react'
import { money, moneyFull } from '../../lib/format.ts'
import MiniMetric from '../MiniMetric.tsx'

type Rollup = {
  activeCount: number
  outstanding: number
  lifetime: number
}

type Props = {
  rows: any[]
  filtered: any[]
  loading: boolean
  q: string
  setQ: (s: string) => void
  filter: string
  setFilter: (s: any) => void
  filterCounts: { all: number; active: number; recent: number }
  rollupFor: (id: string) => Rollup
  jobs?: any[]
  screenStats: { outstanding: number; activeAccounts: number; owesAccounts: number }
  topClientId?: string | null
  totalLifetime?: number
  duplicateClusters?: any[]
  duplicateCount: number
  onOpenClient: (id: string) => void
  onNewClient: () => void
  onReviewDuplicates: () => void
}

function relTime(iso: any) {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const diff = Date.now() - t
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const FILTERS: { key: string; label: string }[] = [
  { key: 'all',    label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'recent', label: 'Recent' },
]

export default function SnowClientsBuild(props: Props) {
  const {
    rows, filtered, loading, q, setQ, filter, setFilter, filterCounts,
    rollupFor, screenStats, totalLifetime,
    duplicateCount, onOpenClient, onNewClient, onReviewDuplicates,
  } = props

  // Derived right-rail metrics
  const cutoff30 = Date.now() - 30 * 24 * 60 * 60 * 1000
  const newThisMonth = rows.filter((r) => {
    const t = new Date(r.created_at || 0).getTime()
    return Number.isFinite(t) && t >= cutoff30
  }).length
  const needsFollowUp = rows.filter((r) => {
    const last = new Date(r.last_activity_at || 0).getTime()
    if (!Number.isFinite(last)) return false
    return Date.now() - last > 30 * 24 * 60 * 60 * 1000 && rollupFor(r.id).activeCount > 0
  }).length

  return (
    <div className="fh-build-page" data-build-screen="SnowClientsBuild">
      <header className="fh-build-topbar">
        <div className="fh-build-search">
          <Search size={14} />
          <input
            className="fh-build-search__input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search clients..."
          />
          <kbd>⌘K</kbd>
        </div>
        <div className="fh-build-topbar__meta">
          <span>{rows.length.toLocaleString()} clients on file</span>
          <span className="fh-build-vline" />
          <span style={{ opacity: 0.6 }}>Weather not set</span>
        </div>
        <button className="fh-build-icon-btn" type="button" onClick={() => window.dispatchEvent(new CustomEvent('fh:navigate', { detail: { to: '/activity' } }))} aria-label="Open activity" title="Activity"><Bell size={16} /></button>
        <button className="fh-build-new-btn" type="button" onClick={onNewClient}>
          <Plus size={15} /> New Client
        </button>
      </header>

      <main className="fh-build-main">
        <section className="fh-build-hero-row fh-build-hero-row--page">
          <div>
            <div className="fh-build-good">Clients</div>
            <h1 className="fh-build-title">RELATIONSHIP DESK.</h1>
          </div>

          <div className="fh-build-focus">
            <div className="fh-build-eyebrow">Filter</div>
            <div className="fh-build-view-toggle fh-build-view-toggle--inline">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={filter === f.key ? 'is-active' : ''}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <p>
              {filtered.length.toLocaleString()} {FILTERS.find((f) => f.key === filter)?.label.toLowerCase()} ·
              {' '}{screenStats.activeAccounts} with open jobs
            </p>
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Total clients" value={rows.length.toLocaleString()} />
            <MiniMetric label="Active relationships" value={String(screenStats.activeAccounts)} accent />
            <MiniMetric label="Outstanding AR" value={money(screenStats.outstanding)} tone={screenStats.outstanding > 0 ? 'warn' : undefined} />
            <MiniMetric label="Needs follow-up" value={String(needsFollowUp)} tone={needsFollowUp > 0 ? 'warn' : undefined} />
          </div>
        </section>

        {duplicateCount > 0 && (
          <button type="button" className="fh-build-banner is-warn" onClick={onReviewDuplicates}>
            <AlertTriangle size={14} />
            <span><strong>{duplicateCount}</strong> potential duplicate{duplicateCount === 1 ? '' : 's'} detected</span>
            <span className="fh-build-banner__cta">Review →</span>
          </button>
        )}

        <div className="fh-build-filterbar">
          {FILTERS.map((f) => {
            const count = (filterCounts as any)[f.key] ?? 0
            const active = filter === f.key
            return (
              <button
                key={f.key}
                type="button"
                className={`fh-build-pill${active ? ' is-active' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <span className="fh-build-pill__count">{count}</span>
              </button>
            )
          })}
        </div>

        <section className="fh-build-content-grid fh-build-content-grid--clients">
          <section className="fh-build-card fh-build-table fh-build-clients-table">
            <header className="fh-build-card-head">
              <div className="fh-build-eyebrow">All relationships · {filtered.length.toLocaleString()}</div>
              <button type="button">Export CSV</button>
            </header>

            <div className="fh-build-table__head is-clients">
              <span>Client</span>
              <span>Status</span>
              <span>Last touch</span>
              <span>Open value</span>
              <span>Active jobs</span>
              <span>Next action</span>
              <span />
            </div>

            {loading && (
              <div className="fh-build-table__empty">Loading clients…</div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="fh-build-table__empty">No clients match. <button type="button" className="fh-build-inline-link" onClick={onNewClient}>+ New Client</button>.</div>
            )}
            {!loading && filtered.slice(0, 60).map((r: any) => {
              const ro = rollupFor(r.id)
              const last = new Date(r.last_activity_at || 0).getTime()
              const stale = Number.isFinite(last) && Date.now() - last > 30 * 24 * 60 * 60 * 1000
              const isActive = ro.activeCount > 0
              const status = !isActive ? { label: 'Dormant', tone: 'neutral' } : stale ? { label: 'Cooling', tone: 'warn' } : { label: 'Active', tone: 'good' }
              const nextAction = ro.outstanding > 0 ? 'Chase invoice' : stale && isActive ? 'Follow up' : isActive ? 'On track' : 'Re-engage'
              return (
                <button
                  key={r.id}
                  type="button"
                  className="fh-build-table__row is-clients"
                  onClick={() => onOpenClient(r.id)}
                >
                  <strong className="fh-build-truncate" title={r.name}>{r.name || 'Unnamed'}</strong>
                  <span className={`fh-build-dot is-${status.tone}`}>{status.label}</span>
                  <span className="fh-build-rel">{relTime(r.last_activity_at)}</span>
                  <span className="fh-build-num" style={{ color: ro.outstanding > 0 ? 'var(--v3-primary, #c9963a)' : undefined, fontWeight: ro.outstanding > 0 ? 700 : 500 }}>
                    {ro.outstanding > 0 ? moneyFull(ro.outstanding) : '—'}
                  </span>
                  <span className="fh-build-num">{ro.activeCount}</span>
                  <span className="fh-build-truncate fh-build-rel">{nextAction}</span>
                  <ChevronRight size={13} />
                </button>
              )
            })}

            {!loading && filtered.length > 60 && (
              <div className="fh-build-table__more">
                Showing first 60 of {filtered.length.toLocaleString()}.
              </div>
            )}
          </section>

          <aside className="fh-build-rail fh-build-rail--page">
            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Total clients</div>
              <strong>{rows.length.toLocaleString()}</strong>
              <span>relationships in book</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Active relationships</div>
              <strong>{screenStats.activeAccounts}</strong>
              <span>with open jobs</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Needs follow-up</div>
              <strong style={{ color: needsFollowUp > 0 ? 'var(--v3-primary-bright)' : undefined }}>{needsFollowUp}</strong>
              <span>cooled 30+ days</span>
              {needsFollowUp > 0 && <div className="fh-build-spark is-gold" />}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Lifetime value</div>
              <strong>{money(totalLifetime || 0)}</strong>
              <span>booked revenue all-time</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">New this month</div>
              <strong>{newThisMonth}</strong>
              <span>added in last 30d</span>
              <div className="fh-build-rail-card__spark">
                <ArrowUpRight size={14} />
                <span>{newThisMonth > 0 ? 'growing' : 'flat'}</span>
              </div>
            </section>
          </aside>
        </section>
      </main>
    </div>
  )
}

