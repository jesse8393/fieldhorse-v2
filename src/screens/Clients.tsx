import { lazy, Suspense, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Search, Briefcase, ChevronRight, AlertTriangle } from 'lucide-react'
import { hapticTap, hapticMedium } from '../lib/haptics.ts'
import { SkeletonList } from '../components/Skeleton.tsx'
import DataErrorState from '../components/DataErrorState.tsx'
import LoadingValue from '../components/LoadingValue.tsx'
import { useHistoryEntryState } from '../lib/useHistoryEntryState.ts'
import { useFhMotion } from '../lib/motion.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useClientsBundle, useInvalidateClients } from '../lib/queries.ts'
import { rollupByClient } from '../lib/rollups.ts'
import { findDuplicateClusters, loadNotDuplicates } from '../lib/clientMerge.ts'
import { clientActivity } from '../lib/clientActivity.ts'
import { FilterPill, Eyebrow } from '../components/v3'
import { Button } from '../components/fh'
const SnowClients = lazy(() => import('../components/desktop/SnowClientsBuild.tsx'))
import { useIsDesktop } from '../lib/useMediaQuery.ts'
import { keepFocusOnRetry } from '../lib/retryFocus.ts'

function money(n: any) {
  const v = Number(n || 0)
  if (!v) return '$0'
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 1 : 2)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}K`
  return `$${Math.round(v).toLocaleString()}`
}

const validWindow = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 40 && Number(value) <= 100_000

export default function Clients() {
  const { user } = useAuth()
  const navigate = useNavigate()
  // isPending, not isLoading: the read waits for the company scope first,
  // and that wait is loading too, never "$0" over "0 accounts".
  const { data: bundle, isPending: loading, isError } = useClientsBundle(user?.id)
  const rows = useMemo(() => bundle?.clients ?? [], [bundle?.clients])
  const invalidateClients = useInvalidateClients()
  // Filter lives in the URL (?filter=) so it survives refresh and is
  // shareable, like the deal-page tabs already are (UI audit #30).
  const [searchParams, setSearchParams] = useSearchParams()
  const q = searchParams.get('q') || ''
  const setQ = (value: string) => {
    // History updates before the router renders. Read it so clearing a
    // search immediately after selecting a filter preserves that filter.
    const next = new URLSearchParams(window.location.search)
    if (value) next.set('q', value)
    else next.delete('q')
    setSearchParams(next, { replace: true })
  }
  const urlFilter = searchParams.get('filter')
  const filter = urlFilter === 'active' || urlFilter === 'recent' ? urlFilter : 'all'
  const setFilter = (next: string) => {
    const sp = new URLSearchParams(window.location.search)
    if (next === 'all') sp.delete('filter')
    else sp.set('filter', next)
    setSearchParams(sp, { replace: true })
  }
  // New customer is a full screen (SPEC D57); nothing opens over the list.
  const openNew = () => navigate('/clients/new')
  // Reviewing duplicates is the screen /clients/merge (D57).
  const openMerge = () => navigate('/clients/merge')

  // Rollups computed live from jobs + payments instead of trusting the
  // stale fh_clients.total_lifetime_value / active_jobs_count columns.
  // Single source of truth shared with Client detail (rollups.ts).
  // Both come from the same Query bundle as the client roster.
  const jobs = useMemo(() => bundle?.jobs ?? [], [bundle?.jobs])
  const leads = useMemo(() => bundle?.leads ?? [], [bundle?.leads])
  const quotes = useMemo(() => bundle?.quotes ?? [], [bundle?.quotes])
  const payments = useMemo(() => bundle?.payments ?? [], [bundle?.payments])
  const changeOrders = useMemo(() => bundle?.changeOrders ?? [], [bundle?.changeOrders])

  // After a save/merge, invalidate the clients query so the list +
  // rollups refresh. Replaces the old load() refetch.
  const load = invalidateClients

  // Map<client_id, { lifetime, outstanding, activeCount, ... }>, built
  // once per (jobs|payments) change. Per-row lookup is O(1).
  // Leads and quotes are their own records (D53): an open lead or an open
  // quote that has not become a job keeps the client active too.
  const rollupMap = useMemo(() => {
    const map = rollupByClient(jobs, payments, changeOrders)
    const bump = (clientId: string | null | undefined) => {
      if (!clientId) return
      const r = map.get(clientId) || { lifetime: 0, outstanding: 0, activeCount: 0, wonCount: 0, paidTotal: 0 }
      map.set(clientId, { ...r, activeCount: r.activeCount + 1 })
    }
    for (const l of leads) if (l.status === 'open') bump(l.client_id)
    for (const q of quotes) if (['draft', 'sent', 'viewed', 'changes_requested', 'approved'].includes(q.status) && !q.job_id) bump(q.client_id)
    return map
  }, [jobs, leads, quotes, payments, changeOrders])

  // Duplicate detection, runs every time the client roster changes.
  // Match policy lives in lib/clientMerge.ts (phone or email normalized).
  // Pairs the operator marked as different clients on the merge screen
  // stop being flagged (remembered on this device).
  const notDuplicates = useMemo(() => loadNotDuplicates(user?.id), [user?.id])
  const duplicateClusters = useMemo(() => findDuplicateClusters(rows, notDuplicates), [rows, notDuplicates])
  const duplicateCount = useMemo(
    () => duplicateClusters.reduce((s, c) => s + c.members.length, 0),
    [duplicateClusters]
  )

  // Stable identity (keyed on rollupMap) so it can be a dependency of the
  // desktop table's `enriched` useMemo without busting it every render.
  const rollupFor = useCallback((clientId: any) => {
    return rollupMap.get(clientId) || { lifetime: 0, outstanding: 0, activeCount: 0, wonCount: 0, paidTotal: 0 }
  }, [rollupMap])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let base = rows
    if (filter === 'active') base = base.filter((r) => rollupFor(r.id).activeCount > 0)
    if (filter === 'recent') {
      const now = Date.now()
      base = base.filter((r) => clientActivity(r.last_activity_at, now).state === 'recent')
    }
    if (!needle) return base
    return base.filter((r) =>
      (r.name || '').toLowerCase().includes(needle)
      || (r.company_name || '').toLowerCase().includes(needle)
      || (r.email || '').toLowerCase().includes(needle)
      || (r.phone || '').toLowerCase().includes(needle)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, filter, rollupMap])

  const [visibleCount, setVisibleCount] = useHistoryEntryState(`clients:${user?.id || ''}`, 40, validWindow)
  const visibleClients = filtered.slice(0, visibleCount)
  const clientsHasMore = visibleCount < filtered.length

  const totalLifetime = useMemo(() => {
    let total = 0
    for (const r of rows) total += rollupFor(r.id).lifetime
    return total
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, rollupMap])

  // Screen-level outstanding aggregate + counts. Derived from the same
  // rollupMap that powers per-tile stats, single source of truth.
  const screenStats = useMemo(() => {
    let outstanding = 0
    let activeAccounts = 0
    let owesAccounts = 0
    for (const r of rows) {
      const ro = rollupFor(r.id)
      outstanding += ro.outstanding
      if (ro.activeCount > 0) activeAccounts++
      if (ro.outstanding > 0) owesAccounts++
    }
    return { outstanding, activeAccounts, owesAccounts }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, rollupMap])

  // Per-filter counts so FilterPills can render their badge.
  const filterCounts = useMemo(() => {
    const now = Date.now()
    const all = rows.length
    const active = rows.filter((r) => rollupFor(r.id).activeCount > 0).length
    const recent = rows.filter(
      (r) => clientActivity(r.last_activity_at, now).state === 'recent'
    ).length
    return { all, active, recent }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, rollupMap])

  // The single highest-lifetime client in the filtered set, surfaces
  // a small "TOP" gold rib when the list has enough scale to warrant it
  // and the top has a non-zero lifetime. Mirrors the featuredId pattern
  // used on Jobs.
  const topClientId = useMemo(() => {
    if (filtered.length < 2) return null
    let id = null
    let max = 0
    for (const c of filtered) {
      const lt = rollupFor(c.id).lifetime
      if (lt > max) { max = lt; id = c.id }
    }
    return max > 0 ? id : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, rollupMap])

  const { stagger, item } = useFhMotion()
  const isDesktop = useIsDesktop()

  // A failed load must not fall through to the "No accounts yet" empty state :
  // that would tell a contractor with a full book of business it's empty.
  // A failed refresh keeps the list already on screen. The error is the
  // whole screen, so Try again leaves focus on the page's main region.
  if (isError && !bundle) {
    return (
      <div className="v3-screen" style={{ padding: '24px 24px' }}>
        <DataErrorState
          title="Couldn't load clients"
          message="We couldn't reach your client list. Check your connection and try again, nothing was lost."
          actionLabel="Try again"
          onRetry={() => {
            keepFocusOnRetry()
            invalidateClients()
          }}
        />
      </div>
    )
  }

  // Phase 7, desktop-first composition. At >=900px DesktopClientsDirectory
  // renders the real KPI strip + list+detail directory using the same
  // rows / jobs / rollups / handlers the mobile branch consumes. Below
  // 900px the existing motion.div.v3-screen--clients flow renders verbatim.
  if (isDesktop) {
    return (
      <>
        <Suspense fallback={null}>
          <SnowClients
            rows={rows}
            filtered={filtered}
            loading={loading}
            q={q}
            setQ={setQ}
            filter={filter}
            setFilter={setFilter}
            filterCounts={filterCounts}
            rollupFor={rollupFor}
            jobs={jobs}
            screenStats={screenStats}
            topClientId={topClientId}
            totalLifetime={totalLifetime}
            duplicateClusters={duplicateClusters}
            duplicateCount={duplicateCount}
            onOpenClient={(id: any) => navigate(`/clients/${id}`)}
            onNewClient={() => openNew()}
            onReviewDuplicates={openMerge}
          />
        </Suspense>
      </>
    )
  }

  return (
    <motion.div className="v3-screen v3-screen--clients" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: 48, position: 'relative', background: 'var(--v3-bg)' }}>
      <motion.div className="fh-clients__cockpit" variants={item}>
        <header className="fh-customers-heading">
          <h1>Customers</h1>
          <p>{loading ? <LoadingValue label="Loading your accounts" width={72} height={16} /> : `${rows.length} ${rows.length === 1 ? 'account' : 'accounts'} on file`}</p>
          <Button variant="primary" icon={Plus} onClick={() => { hapticMedium(); openNew() }}>
            New customer
          </Button>
        </header>
        <section className="fh-customers-metrics" aria-label="Customer totals">
          <div>
            <span>Won contract value</span>
            <strong>{loading ? <LoadingValue label="Loading won contract value" width={96} height={28} /> : money(totalLifetime)}</strong>
          </div>
          <div>
            <span>Contract balance</span>
            <strong>{loading ? <LoadingValue label="Loading contract balance" width={96} height={28} /> : money(screenStats.outstanding)}</strong>
          </div>
        </section>
      </motion.div>

      {/* Search + filter row, unified gutter, FilterPill primitive */}
      <motion.div className="fh-clients__filters" variants={item} style={{ padding: '0 24px 12px' }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--v3-text-muted)', pointerEvents: 'none' }} />
          <input
            aria-label="Search customers"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search customers"
            style={{ width: '100%', padding: '12px 12px 12px 32px', borderRadius: 10, background: 'var(--v3-surface)', border: '1px solid var(--v3-border-strong)', color: 'var(--v3-text)', fontFamily: 'var(--font-body)', fontSize: 16, boxSizing: 'border-box' }}
          />
        </div>
        <div className="fh-customer-filters" aria-label="Customer filters">
          {[
            { id: 'all', label: 'All', count: filterCounts.all },
            { id: 'active', label: 'Active', count: filterCounts.active },
            { id: 'recent', label: 'Recent', count: filterCounts.recent }
          ].map((f) => (
            <FilterPill
              key={f.id}
              size="sm"
              active={filter === f.id}
              count={loading ? undefined : f.count}
              onClick={() => { hapticTap(); setFilter(f.id) }}
            >
              {f.label}
            </FilterPill>
          ))}
        </div>
      </motion.div>

      {/* DUPLICATES BANNER, only when clusters detected. Tapping opens
          the merge screen. */}
      {!loading && duplicateClusters.length > 0 && (
        <motion.div variants={item} style={{ padding: '0 24px 12px' }}>
          <button
            type="button"
            onClick={() => { hapticMedium(); openMerge() }}
            style={{
              width: '100%',
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 12px',
              borderRadius: 10,
              background: 'color-mix(in srgb, var(--v3-primary) 10%, var(--v3-surface))',
              border: '1px solid color-mix(in srgb, var(--v3-primary) 40%, transparent)',
              color: 'var(--v3-text)',
              textAlign: 'left',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            <span aria-hidden="true" style={{
              width: 32, height: 32, borderRadius: 10,
              background: 'var(--v3-primary-soft)',
              border: '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
              color: 'var(--v3-primary-text)',
              display: 'grid', placeItems: 'center', flexShrink: 0
            }}>
              <AlertTriangle size={14} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700,
                color: 'var(--v3-text)', lineHeight: 1.2
              }}>
                {duplicateCount} possible {duplicateCount === 1 ? 'duplicate' : 'duplicates'} found
              </div>
              <div style={{
                marginTop: 2,
                fontFamily: 'var(--font-body)', fontSize: 14,
                color: 'var(--v3-text-muted)'
              }}>
                {duplicateClusters.length} {duplicateClusters.length === 1 ? 'cluster' : 'clusters'} sharing a phone or email
              </div>
            </div>
            <Eyebrow tone="gold">
              Review →
            </Eyebrow>
          </button>
        </motion.div>
      )}

      {/* Open customer rows share one gutter with search and totals. */}
      <motion.div
        className="fh-clients__list"
        variants={item}
        style={{
          padding: '0 var(--v3-gutter) 24px'
        }}
      >
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="v3-skeleton" style={{ height: 64, borderRadius: 10 }} />
            ))}
          </div>
        )}
        {!loading && rows.length === 0 && (
          <div style={{
            padding: '32px 24px', borderRadius: 10,
            background: 'var(--v3-surface)',
            border: '1px dashed var(--v3-border-strong)',
            textAlign: 'center', color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10,
              background: 'var(--v3-surface-2)',
              border: '1px solid color-mix(in srgb, var(--v3-primary) 22%, transparent)',
              display: 'grid', placeItems: 'center',
              color: 'var(--v3-primary-text)'
            }}>
              <Briefcase size={18} aria-hidden="true" />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--v3-text)' }}>
                No accounts yet
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--v3-text-muted)', lineHeight: 1.5, maxWidth: 320 }}>
                A client is the person you work for. Bills get sent to them, jobs roll up to them.
              </p>
            </div>
            <button type="button" onClick={() => openNew()} style={{
              background: 'var(--v3-primary)',
              color: 'var(--v3-on-primary)',
              border: '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)',
              padding: '12px 16px', borderRadius: 10,
              fontWeight: 700, fontSize: 14,
              letterSpacing: 0,
              cursor: 'pointer',
              boxShadow: 'none'
            }}>
              Add your first client
            </button>
          </div>
        )}
        {!loading && rows.length > 0 && filtered.length === 0 && (
          <div className="v3-empty">
            No customers match these filters.
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <div
            role="list"
            className="fh-customer-list"
          >
            {visibleClients.map((c) => {
              const r = rollupFor(c.id)
              const lastActivity = clientActivity(c.last_activity_at).lastTouch
              const lastActivityRel = lastActivity ? formatRelative(new Date(lastActivity)) : null
              return (
                <ClientRow
                  key={c.id}
                  client={c}
                  rollup={r}
                  lastActivityRel={lastActivityRel}
                  isTop={filter === 'all' && !q.trim() && c.id === topClientId}
                  onOpen={() => navigate(`/clients/${c.id}`)}
                />
              )
            })}
            <div className="fh-customer-list-footer">
              <p aria-live="polite" style={{ fontSize: 14 }}>Showing {visibleClients.length} of {filtered.length} customers.</p>
              {clientsHasMore && <button type="button" className="fh-build-secondary-btn" style={{ minHeight: 44 }}
                onClick={() => setVisibleCount(count => count + 40)}>Load more customers</button>}
            </div>
          </div>
        )}
      </motion.div>

    </motion.div>
  )
}

function formatRelative(date: any) {
  const ms = Date.now() - date.getTime()
  const days = Math.floor(ms / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function ClientRow({ client: c, rollup: r, lastActivityRel, isTop, onOpen }: any) {
  const subline = r.outstanding > 0
    ? `Contract balance ${money(r.outstanding)}`
    : r.activeCount > 0
      ? `${r.activeCount} active work ${r.activeCount === 1 ? 'item' : 'items'}`
      : c.company_name || 'No active work'

  return (
    <div role="listitem">
      <button type="button" className="fh-customer-row" onClick={() => { hapticTap(); onOpen() }}>
        <span className="fh-customer-row__name">{c.name || 'Unnamed client'}</span>
        <span className="fh-customer-row__value">{money(r.lifetime)}</span>
        <ChevronRight size={16} aria-hidden="true" />
        <span className="fh-customer-row__context">{subline}</span>
        {isTop && <span className="fh-customer-row__meta">Highest contract value</span>}
        <span className="fh-customer-row__meta">{r.activeCount > 0 && r.outstanding > 0
          ? `${r.activeCount} active work ${r.activeCount === 1 ? 'item' : 'items'}`
          : lastActivityRel ? `Last activity ${lastActivityRel}` : 'Activity date unavailable'}</span>
      </button>
    </div>
  )
}
