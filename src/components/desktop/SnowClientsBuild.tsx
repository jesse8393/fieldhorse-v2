// SnowClientsBuild — desktop /clients in the Build direction.
//
// Drop-in for SnowClients at >=900px. Same props, same handlers.
// Treats clients as a relationship desk, not a contact list.
//
// Table logic runs on TanStack Table (headless): sortable columns +
// a real CSV export of the current view. Search/filter stay upstream
// in the parent screen (the topbar input drives `filtered`).

import { useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Bell,
  ChevronRight,
  FileDown,
  Search,
  Plus,
  AlertTriangle,
} from 'lucide-react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  createColumnHelper,
} from '@tanstack/react-table'
import type { SortingState } from '@tanstack/react-table'
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

// One enriched row per client — rollup + status derived once so the
// sort accessors and the render read the same values.
type ClientRow = {
  client: any
  status: { label: string; tone: string; rank: number }
  lastTouch: number
  outstanding: number
  activeCount: number
  nextAction: string
}

const columnHelper = createColumnHelper<ClientRow>()

const COLUMNS = [
  columnHelper.accessor((r) => r.client.name || 'Unnamed', { id: 'name', header: 'Client' }),
  columnHelper.accessor((r) => r.status.rank, { id: 'status', header: 'Status' }),
  columnHelper.accessor((r) => r.lastTouch, { id: 'last', header: 'Last touch' }),
  columnHelper.accessor((r) => r.outstanding, { id: 'outstanding', header: 'Open value' }),
  columnHelper.accessor((r) => r.activeCount, { id: 'active', header: 'Active jobs' }),
  columnHelper.accessor((r) => r.nextAction, { id: 'next', header: 'Next action' }),
]

function toCsv(rows: ClientRow[]): string {
  const esc = (v: unknown) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = 'Client,Status,Last activity,Outstanding,Active jobs,Next action,Phone,Email'
  const body = rows.map((r) => [
    esc(r.client.name || 'Unnamed'),
    r.status.label,
    r.client.last_activity_at ? new Date(r.client.last_activity_at).toISOString().slice(0, 10) : '',
    r.outstanding.toFixed(2),
    r.activeCount,
    esc(r.nextAction),
    esc(r.client.phone || ''),
    esc(r.client.email || ''),
  ].join(','))
  return [head, ...body].join('\n')
}

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

  // Enrich once per (filtered|rollup) change; TanStack sorts over this.
  const enriched: ClientRow[] = useMemo(() => filtered.map((r: any) => {
    const ro = rollupFor(r.id)
    const last = new Date(r.last_activity_at || 0).getTime()
    const lastTouch = Number.isFinite(last) ? last : 0
    const stale = lastTouch > 0 && Date.now() - lastTouch > 30 * 24 * 60 * 60 * 1000
    const isActive = ro.activeCount > 0
    const status = !isActive
      ? { label: 'Dormant', tone: 'neutral', rank: 0 }
      : stale
        ? { label: 'Cooling', tone: 'warn', rank: 1 }
        : { label: 'Active', tone: 'good', rank: 2 }
    const nextAction = ro.outstanding > 0 ? 'Chase invoice' : stale && isActive ? 'Follow up' : isActive ? 'On track' : 'Re-engage'
    return { client: r, status, lastTouch, outstanding: ro.outstanding, activeCount: ro.activeCount, nextAction }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [filtered, rollupFor])

  const [sorting, setSorting] = useState<SortingState>([])
  const table = useReactTable({
    data: enriched,
    columns: COLUMNS,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })
  const viewRows = table.getRowModel().rows

  function exportCsv() {
    const csv = toCsv(viewRows.map((r) => r.original))
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'fieldhorse-clients.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

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
              <button type="button" onClick={exportCsv} disabled={loading || viewRows.length === 0}>
                <FileDown size={12} aria-hidden="true" /> Export CSV
              </button>
            </header>

            <div className="fh-build-table__head is-clients">
              {table.getFlatHeaders().map((header) => {
                const dir = header.column.getIsSorted()
                return (
                  <button
                    key={header.id}
                    type="button"
                    className={`fh-build-sort${dir ? ' is-sorted' : ''}`}
                    onClick={header.column.getToggleSortingHandler()}
                    aria-label={`Sort by ${String(header.column.columnDef.header)}`}
                    aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
                  >
                    {String(header.column.columnDef.header)}
                    {dir === 'asc' ? <ArrowUp size={10} /> : dir === 'desc' ? <ArrowDown size={10} /> : <ArrowUpDown size={10} className="fh-build-sort__hint" />}
                  </button>
                )
              })}
              <span />
            </div>

            {loading && (
              <div className="fh-build-table__empty">Loading clients…</div>
            )}
            {!loading && viewRows.length === 0 && (
              <div className="fh-build-table__empty">No clients match. <button type="button" className="fh-build-inline-link" onClick={onNewClient}>+ New Client</button>.</div>
            )}
            {!loading && viewRows.slice(0, 60).map((tr) => {
              const { client: r, status, outstanding, activeCount, nextAction } = tr.original
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
                  <span className="fh-build-num" style={{ color: outstanding > 0 ? 'var(--v3-primary, #c9963a)' : undefined, fontWeight: outstanding > 0 ? 700 : 500 }}>
                    {outstanding > 0 ? moneyFull(outstanding) : '—'}
                  </span>
                  <span className="fh-build-num">{activeCount}</span>
                  <span className="fh-build-truncate fh-build-rel">{nextAction}</span>
                  <ChevronRight size={13} />
                </button>
              )
            })}

            {!loading && viewRows.length > 60 && (
              <div className="fh-build-table__more">
                Showing first 60 of {viewRows.length.toLocaleString()}. Sort or search to surface the rest, or Export CSV for everything.
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

