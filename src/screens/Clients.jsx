import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Search, Briefcase, ChevronRight } from 'lucide-react'
import { hapticTap, hapticMedium } from '../lib/haptics.js'
import { SkeletonList } from '../components/Skeleton.jsx'
import { supabase } from '../lib/supabase.js'
import { useFhMotion } from '../lib/motion.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { rollupByClient } from '../lib/rollups.js'
import NewClientSheet from '../components/NewClientSheet.jsx'
import { FilterPill, Eyebrow, StampNumber, FloatingActionButton } from '../components/v3'
import DesktopClientsDirectory from '../components/desktop/DesktopClientsDirectory.jsx'
import { useIsDesktop } from '../lib/useMediaQuery.js'

function money(n) {
  const v = Number(n || 0)
  if (!v) return '$0'
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 1 : 2)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}K`
  return `$${Math.round(v).toLocaleString()}`
}

export default function Clients() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all') // 'all' | 'active' | 'recent'
  const [addOpen, setAddOpen] = useState(false)

  // Rollups computed live from jobs + payments instead of trusting the
  // stale fh_clients.total_lifetime_value / active_jobs_count columns.
  // Single source of truth shared with Client detail (rollups.js).
  const [jobs, setJobs] = useState([])
  const [payments, setPayments] = useState([])

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const [{ data: clients }, { data: js }, { data: ps }] = await Promise.all([
      supabase
        .from('fh_clients')
        .select('*')
        .eq('user_id', user.id)
        .order('last_activity_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('fh_contacts')
        .select('id, client_id, amount, stage')
        .eq('user_id', user.id),
      supabase
        .from('fh_payments')
        .select('contact_id, amount')
        .eq('user_id', user.id)
    ])
    setRows(clients || [])
    setJobs(js || [])
    setPayments(ps || [])
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  // Map<client_id, { lifetime, outstanding, activeCount, ... }> — built
  // once per (jobs|payments) change. Per-row lookup is O(1).
  const rollupMap = useMemo(() => rollupByClient(jobs, payments), [jobs, payments])

  function rollupFor(clientId) {
    return rollupMap.get(clientId) || { lifetime: 0, outstanding: 0, activeCount: 0, wonCount: 0, paidTotal: 0 }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let base = rows
    if (filter === 'active') base = base.filter((r) => rollupFor(r.id).activeCount > 0)
    if (filter === 'recent') {
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
      base = base.filter((r) => r.last_activity_at && new Date(r.last_activity_at).getTime() > cutoff)
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

  const totalLifetime = useMemo(() => {
    let total = 0
    for (const r of rows) total += rollupFor(r.id).lifetime
    return total
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, rollupMap])

  // Screen-level outstanding aggregate + counts. Derived from the same
  // rollupMap that powers per-tile stats — single source of truth.
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
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    const all = rows.length
    const active = rows.filter((r) => rollupFor(r.id).activeCount > 0).length
    const recent = rows.filter(
      (r) => r.last_activity_at && new Date(r.last_activity_at).getTime() > cutoff
    ).length
    return { all, active, recent }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, rollupMap])

  // The single highest-lifetime client in the filtered set — surfaces
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

  // Phase 7 — desktop-first composition. At >=900px DesktopClientsDirectory
  // renders the real KPI strip + list+detail directory using the same
  // rows / jobs / rollups / handlers the mobile branch consumes. Below
  // 900px the existing motion.div.v3-screen--clients flow renders verbatim.
  if (isDesktop) {
    return (
      <>
        <DesktopClientsDirectory
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
          onOpenClient={(id) => navigate(`/clients/${id}`)}
          onNewClient={() => setAddOpen(true)}
        />
        <NewClientSheet
          open={addOpen}
          userId={user?.id}
          onClose={() => setAddOpen(false)}
          onSaved={(client) => {
            setAddOpen(false)
            if (client?.id) navigate(`/clients/${client.id}`)
            else load()
          }}
        />
      </>
    )
  }

  return (
    <motion.div className="v3-screen v3-screen--clients" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: 120, position: 'relative', background: 'var(--v3-bg)' }}>
      {/* COCKPIT — black-glass panel: title eyebrow + state chip + KPI strip */}
      <motion.div className="fh-clients__cockpit" variants={item} style={{ padding: '8px 20px 12px' }}>
        <div style={{
          padding: '14px 16px',
          borderRadius: 16,
          background: 'var(--v3-surface)',
          border: '1px solid var(--v3-border)',
          boxShadow: '0 1px 0 rgba(255, 240, 210, 0.04) inset, 0 8px 22px rgba(0, 0, 0, 0.40)'
        }}>
          {/* Header row: section eyebrow + state chip */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
              <Eyebrow tone="gold">Clients</Eyebrow>
              {!loading && <ClientsStateChip stats={screenStats} totalAccounts={rows.length} />}
            </div>
            {/* Desktop-only inline primary action. FAB hides on desktop. */}
            <button
              type="button"
              className="fh-clients__action fh-desktop-only-action"
              onClick={() => { hapticMedium(); setAddOpen(true) }}
              aria-label="New client"
            >
              <Plus size={15} strokeWidth={2.4} />
              <span>New client</span>
            </button>
          </div>

          {/* KPI strip — Lifetime billed | Outstanding (when populated) */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: screenStats.outstanding > 0 ? '1fr 1px 1fr' : '1fr',
            alignItems: 'end',
            gap: 12
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <Eyebrow tone="gold">Lifetime billed</Eyebrow>
              <StampNumber size="2xl" tone="gold" style={{ display: 'block', lineHeight: 0.95 }}>
                {money(totalLifetime)}
              </StampNumber>
              <Eyebrow as="div" style={{ marginTop: 2 }}>
                {rows.length} {rows.length === 1 ? 'account' : 'accounts'}
              </Eyebrow>
            </div>
            {screenStats.outstanding > 0 && (
              <>
                <span aria-hidden="true" style={{ background: 'var(--v3-border)', alignSelf: 'stretch' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <Eyebrow>Outstanding</Eyebrow>
                  <StampNumber size="xl" tone="danger" style={{ display: 'block', lineHeight: 0.95 }}>
                    {money(screenStats.outstanding)}
                  </StampNumber>
                  <Eyebrow as="div" style={{ marginTop: 2 }}>
                    {screenStats.owesAccounts} {screenStats.owesAccounts === 1 ? 'client owes' : 'clients owe'}
                  </Eyebrow>
                </div>
              </>
            )}
          </div>
        </div>
      </motion.div>

      {/* Search + filter row — unified gutter, FilterPill primitive */}
      <motion.div className="fh-clients__filters" variants={item} style={{ padding: '0 20px 12px' }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--v3-text-muted)', pointerEvents: 'none' }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, company, phone, email…"
            style={{ width: '100%', padding: '11px 12px 11px 34px', borderRadius: 12, background: 'var(--v3-surface)', border: '1px solid var(--v3-border-strong)', color: 'var(--v3-text)', fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }}>
          {[
            { id: 'all', label: 'All', count: filterCounts.all },
            { id: 'active', label: 'Active', count: filterCounts.active },
            { id: 'recent', label: 'Recent', count: filterCounts.recent }
          ].map((f) => (
            <FilterPill
              key={f.id}
              size="sm"
              active={filter === f.id}
              count={f.count}
              onClick={() => { hapticTap(); setFilter(f.id) }}
            >
              {f.label}
            </FilterPill>
          ))}
        </div>
      </motion.div>

      {/* GRID LAYOUT — 1/2/3 col responsive (320px min). Each client is a
          tall vertical tile, not a wide row. */}
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
              <div key={i} className="v3-skeleton" style={{ height: 64, borderRadius: 12 }} />
            ))}
          </div>
        )}
        {!loading && rows.length === 0 && (
          <div style={{
            padding: '32px 24px', borderRadius: 16,
            background: 'var(--v3-surface)',
            border: '1px dashed var(--v3-border-strong)',
            textAlign: 'center', color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'var(--v3-surface-2)',
              border: '1px solid color-mix(in srgb, var(--v3-primary) 22%, transparent)',
              display: 'grid', placeItems: 'center',
              color: 'var(--v3-primary)'
            }}>
              <Briefcase size={18} aria-hidden="true" />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--v3-text)' }}>
                No accounts yet
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--v3-text-muted)', lineHeight: 1.5, maxWidth: 320 }}>
                A client is the person you work for. Bills get sent to them, jobs roll up to them.
              </p>
            </div>
            <button type="button" onClick={() => setAddOpen(true)} style={{
              background: 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
              color: 'var(--v3-on-primary)',
              border: '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)',
              padding: '10px 16px', borderRadius: 10,
              fontWeight: 700, fontSize: 12,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              cursor: 'pointer',
              boxShadow: '0 0 0 2px rgba(228, 190, 111, 0.14), 0 4px 12px rgba(201, 150, 58, 0.28)'
            }}>
              Add your first client
            </button>
          </div>
        )}
        {!loading && rows.length > 0 && filtered.length === 0 && (
          <div className="v3-empty">
            No clients match that search.
          </div>
        )}
        {/* FEATURED TOP CLIENT — gold-rib hero card from design handoff
            (styles-workflows.css .cl-card--top). Only rendered when the
            top earner is meaningfully ahead of the pack and we're on the
            "all" filter so it never competes with an active search/filter. */}
        {!loading && filter === 'all' && !q.trim() && topClientId && (() => {
          const top = filtered.find((c) => c.id === topClientId)
          if (!top) return null
          const r = rollupFor(top.id)
          const lastActivity = top.last_activity_at ? new Date(top.last_activity_at) : null
          const lastRel = lastActivity ? formatRelative(lastActivity) : '—'
          const initials = (top.name || '·').trim().split(/\s+/).slice(0, 2).map(s => s.charAt(0).toUpperCase()).join('')
          return (
            <div className="cl-card cl-card--top">
              <div className="cl-card__rib">TOP CLIENT</div>
              <button type="button" className="cl-card__tap" onClick={() => { hapticTap(); navigate(`/clients/${top.id}`) }}>
                <div className="cl-card__hdr">
                  <div className="cl-card__avatar" aria-hidden="true">{initials || '·'}</div>
                  <div className="cl-card__main">
                    <div className="cl-card__name">{top.name || 'Unnamed client'}</div>
                    <div className="cl-card__kind">{top.company_name || 'Lifetime billing leader'}</div>
                  </div>
                  <div className="cl-card__amt">
                    <div className="cl-card__amt-val">{money(r.lifetime)}</div>
                    <div className="cl-card__amt-lbl">Lifetime</div>
                  </div>
                </div>
                <div className="cl-card__strip">
                  <div className="cl-strip-cell">
                    <div className="cl-strip-cell__lbl">Active</div>
                    <div className={`cl-strip-cell__val${r.activeCount > 0 ? ' cl-strip-cell__val--gold' : ''}`}>
                      {r.activeCount > 0 ? `${r.activeCount} ${r.activeCount === 1 ? 'job' : 'jobs'}` : '—'}
                    </div>
                  </div>
                  <div className="cl-strip-cell">
                    <div className="cl-strip-cell__lbl">Owes</div>
                    <div className={`cl-strip-cell__val${r.outstanding > 0 ? ' cl-strip-cell__val--alert' : ''}`}>
                      {r.outstanding > 0 ? money(r.outstanding) : '—'}
                    </div>
                  </div>
                  <div className="cl-strip-cell">
                    <div className="cl-strip-cell__lbl">Last</div>
                    <div className="cl-strip-cell__val">{lastRel}</div>
                  </div>
                </div>
              </button>
            </div>
          )
        })()}
        {/* Single black-glass list container with hairline dividers — premium
            iOS list pattern. Each row is a tap target into /clients/:id;
            the heavier per-card chrome (lifetime stamp, contact row,
            stat chips) lives on the detail screen now. */}
        {!loading && filtered.length > 0 && (
          <div
            role="list"
            style={{
              borderRadius: 16,
              background: 'var(--v3-surface-glass)',
              backdropFilter: 'blur(14px) saturate(1.1)',
              WebkitBackdropFilter: 'blur(14px) saturate(1.1)',
              border: '1px solid var(--v3-border)',
              boxShadow: '0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 8px 22px rgba(0, 0, 0, 0.40)',
              overflow: 'hidden'
            }}
          >
            {filtered.map((c, i) => {
              const r = rollupFor(c.id)
              const lastActivity = c.last_activity_at ? new Date(c.last_activity_at) : null
              const lastActivityRel = lastActivity ? formatRelative(lastActivity) : null
              return (
                <ClientRow
                  key={c.id}
                  client={c}
                  rollup={r}
                  lastActivityRel={lastActivityRel}
                  index={i}
                  isTop={c.id === topClientId}
                  isLast={i === filtered.length - 1}
                  onOpen={() => navigate(`/clients/${c.id}`)}
                />
              )
            })}
          </div>
        )}
      </motion.div>

      {/* end of grid */}

      <NewClientSheet
        open={addOpen}
        userId={user?.id}
        onClose={() => setAddOpen(false)}
        onSaved={(client) => {
          setAddOpen(false)
          if (client?.id) navigate(`/clients/${client.id}`)
          else load()
        }}
      />
      <FloatingActionButton
        onClick={() => setAddOpen(true)}
        ariaLabel="New client"
        iconStrokeWidth={2.75}
        hideOnDesktop
      />
    </motion.div>
  )
}

/* ============================================================
   ClientRow — compact list row inside the rounded black-glass
   container. ~64px tall. Premium iOS list pattern.

     ┌────────────────────────────────────────────────────┐
     │ (40 av) Client Name              $LIFETIME       › │
     │         status subline           N active           │
     ├────────────────────────────────────────────────────┤  ← hairline
     │ ...next row...                                        │
     └─────────────────────────────────────────────────────┘

   Subline is a single synthesized status string — order of preference:
     1. "Owes $X · N+ days"            (overdue, danger tone)
     2. "N active jobs · $X outstanding" (active money in motion, gold)
     3. "N active jobs"                  (work in flight, neutral)
     4. company_name                     (relationship-only fallback)
     5. "—"                              (truly empty record)

   Contact actions (call / text / email / map) live on the client
   detail screen; surfacing them on every list row was clutter the
   user wouldn't read before tapping anyway.
   ============================================================ */

function formatRelative(date) {
  const ms = Date.now() - date.getTime()
  const days = Math.floor(ms / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function ClientRow({ client: c, rollup: r, lastActivityRel, index, isTop, isLast, onOpen }) {
  const subline = useMemo(() => {
    if (r.outstanding > 0) {
      return { text: `Owes ${money(r.outstanding)}`, tone: 'danger' }
    }
    if (r.activeCount > 0 && r.outstanding > 0) {
      return { text: `${r.activeCount} active · ${money(r.outstanding)} outstanding`, tone: 'gold' }
    }
    if (r.activeCount > 0) {
      return { text: `${r.activeCount} active ${r.activeCount === 1 ? 'job' : 'jobs'}`, tone: 'muted' }
    }
    if (c.company_name) return { text: c.company_name, tone: 'muted' }
    return { text: '—', tone: 'muted' }
  }, [c.company_name, r.activeCount, r.outstanding])

  const sublineColor =
    subline.tone === 'danger' ? 'var(--v3-danger-bright)' :
    subline.tone === 'gold'   ? 'var(--v3-primary)' :
                                'var(--v3-text-muted)'

  // Performance: drop per-row entrance animations and whileHover. The
  // staggered entrance compounds across N rows, the hover doesn't fire
  // on touch, and AnimatePresence layout cost was a measurable hit on
  // mid-range iPhones. Plain button + cheap whileTap is enough.
  return (
    <button
      type="button"
      role="listitem"
      onClick={() => { hapticTap(); onOpen() }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        padding: '12px 14px',
        background: isTop
          ? 'color-mix(in srgb, var(--v3-primary) 6%, transparent)'
          : 'transparent',
        border: 'none',
        borderBottom: isLast ? 'none' : '1px solid var(--v3-border)',
        color: 'var(--v3-text)',
        textAlign: 'left',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        minHeight: 64,
        boxSizing: 'border-box',
        transition: 'background 160ms ease'
      }}
    >
      {/* Avatar — 40px tile. Highlight tile when client is the top
          earner so the visual hierarchy reads at a glance. */}
      <div aria-hidden="true" style={{
        flexShrink: 0,
        width: 40, height: 40,
        borderRadius: 10,
        background: isTop
          ? 'linear-gradient(135deg, color-mix(in srgb, var(--v3-primary) 18%, var(--v3-surface-2)), var(--v3-surface-2))'
          : 'var(--v3-surface-2)',
        border: isTop
          ? '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)'
          : '1px solid var(--v3-border)',
        display: 'grid', placeItems: 'center',
        fontFamily: 'var(--font-display)',
        fontSize: 14,
        letterSpacing: '0.04em',
        color: isTop ? 'var(--v3-primary)' : 'var(--v3-text-muted)'
      }}>
        {(c.name || '·').trim().charAt(0).toUpperCase()}
      </div>

      {/* Name + synthesized subline */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{
            fontFamily: 'var(--font-body)',
            fontSize: 14, fontWeight: 600,
            color: 'var(--v3-text)',
            letterSpacing: '-0.005em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            minWidth: 0
          }}>
            {c.name || 'Unnamed client'}
          </span>
          {isTop && (
            <span style={{
              flexShrink: 0,
              fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700,
              letterSpacing: '0.16em', textTransform: 'uppercase',
              color: 'var(--v3-primary)'
            }}>
              · TOP
            </span>
          )}
        </div>
        <span style={{
          fontFamily: 'var(--font-body)',
          fontSize: 11,
          fontWeight: subline.tone === 'muted' ? 500 : 700,
          color: sublineColor,
          fontVariantNumeric: 'tabular-nums',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
        }}>
          {subline.text}
        </span>
      </div>

      {/* Right column: lifetime $ + small "N active" or last-activity
          caption (whichever is more useful). Lifetime stays the
          primary number; the second line falls back through:
            1. "N active" if there are active jobs
            2. last-activity relative time if known (recently-added
               value from migration 007's last_activity_at column)
            3. "lifetime" as a quiet label */}
      <div style={{ flexShrink: 0, textAlign: 'right', opacity: r.lifetime > 0 ? 1 : 0.45 }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 16, lineHeight: 1,
          color: 'var(--v3-text)',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '0.01em'
        }}>
          {money(r.lifetime)}
        </div>
        <div style={{
          marginTop: 4,
          fontFamily: 'var(--font-body)',
          fontSize: 10,
          color: 'var(--v3-text-muted)',
          fontVariantNumeric: 'tabular-nums'
        }}>
          {r.activeCount > 0
            ? `${r.activeCount} active`
            : lastActivityRel
              ? `Last · ${lastActivityRel}`
              : 'lifetime'}
        </div>
      </div>

      <ChevronRight size={14} color="var(--v3-text-muted)" aria-hidden="true" style={{ flexShrink: 0 }} />
    </button>
  )
}

/* ============================================================
   ClientsStateChip — small premium status pill in the cockpit
   top-right. Mirrors Money Owed's BalanceStateChip pattern.
     overdue → danger-tinted "N owe balance" (any client overdue)
     active  → gold-tinted   "N active" (active jobs, no overdue)
     idle    → muted         "N accounts" (nothing in motion)
   ============================================================ */
function ClientsStateChip({ stats, totalAccounts }) {
  const { owesAccounts, activeAccounts } = stats
  let bg, border, color, label
  if (owesAccounts > 0) {
    bg = 'var(--v3-danger-soft)'
    border = 'color-mix(in srgb, var(--v3-danger) 38%, transparent)'
    color = 'var(--v3-danger-bright)'
    label = `${owesAccounts} ${owesAccounts === 1 ? 'owes' : 'owe'} balance`
  } else if (activeAccounts > 0) {
    bg = 'var(--v3-primary-soft)'
    border = 'color-mix(in srgb, var(--v3-primary) 35%, transparent)'
    color = 'var(--v3-primary)'
    label = `${activeAccounts} active`
  } else {
    bg = 'var(--v3-surface-2)'
    border = 'var(--v3-border-strong)'
    color = 'var(--v3-text-muted)'
    label = `${totalAccounts} ${totalAccounts === 1 ? 'account' : 'accounts'}`
  }
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '3px 9px',
      borderRadius: 999,
      background: bg,
      border: `1px solid ${border}`,
      color,
      fontFamily: 'var(--font-body)',
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      lineHeight: 1,
      fontVariantNumeric: 'tabular-nums'
    }}>
      {label}
    </span>
  )
}
