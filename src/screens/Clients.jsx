import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Search, Briefcase, Phone, Mail, MessageSquare, Map } from 'lucide-react'
import { hapticTap, hapticMedium } from '../lib/haptics.js'
import { SkeletonList } from '../components/Skeleton.jsx'
import { supabase } from '../lib/supabase.js'
import { useFhMotion } from '../lib/motion.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { rollupByClient } from '../lib/rollups.js'
import NewClientSheet from '../components/NewClientSheet.jsx'
import { FilterPill, Eyebrow, StampNumber, FloatingActionButton } from '../components/v3'

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
        className="fh-clients__grid"
        variants={item}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 14,
          padding: '0 var(--v3-gutter) 24px',
          alignItems: 'stretch'
        }}
      >
        {loading && (
          <>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="v3-skeleton" style={{ height: 220, borderRadius: 18 }} />
            ))}
          </>
        )}
        {!loading && rows.length === 0 && (
          <div style={{
            gridColumn: '1 / -1',
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
          <div className="v3-empty" style={{ gridColumn: '1 / -1' }}>
            No clients match that search.
          </div>
        )}
        <AnimatePresence>
          {filtered.map((c, i) => {
            const r = rollupFor(c.id)
            const lastActivity = c.last_activity_at ? new Date(c.last_activity_at) : null
            const lastActivityRel = lastActivity ? formatRelative(lastActivity) : null
            return (
              <ClientTile
                key={c.id}
                client={c}
                rollup={r}
                lastActivityRel={lastActivityRel}
                index={i}
                isTop={c.id === topClientId}
                onOpen={() => navigate(`/clients/${c.id}`)}
              />
            )
          })}
        </AnimatePresence>
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
   ClientTile — premium account tile (vertical card layout).

   Replaces the old full-width row stack with a tall card built for grid
   layout (1/2/3 col responsive). Reads as a "valuable account" the
   operator can scan, not a database row.

     ┌─────────────────────────────────────┐  ← gold spine on left
     │ [AV 56]                $LIFETIME    │
     │                          LIFETIME   │
     │                                     │
     │ Client Name (16/700)                │
     │ Company (12/muted)                  │
     │                                     │
     │ ─────── divider ─────────────────── │
     │                                     │
     │ ●3 ACTIVE   ●$12K OUTSTANDING       │
     │                                     │
     │ ─────── divider ─────────────────── │
     │                                     │
     │ [📞] [💬] [✉] [🗺]   Last: 2d ago  │
     └─────────────────────────────────────┘
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

function ClientTile({ client: c, rollup: r, lastActivityRel, index, isTop, onOpen }) {
  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.03, 0.2), ease: [0.2, 0.8, 0.2, 1] }}
      whileHover={{
        y: -3,
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55), 0 4px 12px rgba(0, 0, 0, 0.35)'
      }}
      whileTap={{ scale: 0.985 }}
      onClick={() => { hapticTap(); onOpen() }}
      style={{
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '18px 18px 14px 22px',
        borderRadius: 16,
        background: 'var(--v3-surface)',
        border: isTop
          ? '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)'
          : '1px solid var(--v3-border)',
        boxShadow: '0 1px 0 rgba(255, 240, 210, 0.04) inset, 0 4px 14px rgba(0, 0, 0, 0.32)',
        textAlign: 'left',
        color: 'var(--v3-text)',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        minHeight: 210,
        width: '100%',
        boxSizing: 'border-box'
      }}
    >
      {/* Gold spine — relationship value cue. Halo dropped (was a gold
          wash); gradient spine kept as a quieter brand cue. */}
      <span aria-hidden="true" style={{
        position: 'absolute',
        left: 0, top: 16, bottom: 14,
        width: 3,
        borderRadius: '0 3px 3px 0',
        background: 'linear-gradient(180deg, var(--v3-primary), color-mix(in srgb, var(--v3-primary) 40%, transparent))'
      }} />

      {/* Optional TOP rib — appears only on the highest-lifetime tile in
          the filtered set (real derived value, threshold-gated). */}
      {isTop && (
        <span aria-hidden="true" style={{
          position: 'absolute',
          top: 12, right: 12,
          padding: '2px 8px',
          borderRadius: 999,
          background: 'var(--v3-primary-soft)',
          border: '1px solid color-mix(in srgb, var(--v3-primary) 32%, transparent)',
          color: 'var(--v3-primary)',
          fontFamily: 'var(--font-body)',
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          lineHeight: 1
        }}>
          Top
        </span>
      )}

      {/* Top section: Avatar (left) + Lifetime $ (right) */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, paddingRight: isTop ? 40 : 0 }}>
        {/* 56x56 restrained avatar — surface-2 + subtle gold border + gold initial.
            Gold gradient/halo dropped per the no-gold-wash direction. */}
        <div aria-hidden="true" style={{
          flexShrink: 0,
          width: 56, height: 56,
          borderRadius: 16,
          background: 'var(--v3-surface-2)',
          border: '1px solid color-mix(in srgb, var(--v3-primary) 22%, transparent)',
          display: 'grid', placeItems: 'center',
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          letterSpacing: '0.04em',
          color: 'var(--v3-primary)',
          boxShadow: 'inset 0 1px 0 rgba(255, 240, 210, 0.05)'
        }}>
          {(c.name || '·').trim().charAt(0).toUpperCase()}
        </div>

        <div style={{ flexShrink: 0, textAlign: 'right', opacity: r.lifetime > 0 ? 1 : 0.4 }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 28, lineHeight: 1,
            letterSpacing: '0.01em',
            color: 'var(--v3-primary)',
            fontVariantNumeric: 'tabular-nums'
          }}>
            {money(r.lifetime)}
          </div>
          <div style={{
            marginTop: 5,
            fontFamily: 'var(--font-body)',
            fontSize: 9,
            fontWeight: 700,
            color: 'var(--v3-text-muted)',
            letterSpacing: '0.18em',
            textTransform: 'uppercase'
          }}>
            Lifetime
          </div>
        </div>
      </div>

      {/* Name + Company */}
      <div style={{ minWidth: 0 }}>
        <h3 style={{
          margin: 0,
          fontFamily: 'var(--font-body)',
          fontSize: 17, fontWeight: 700,
          letterSpacing: '-0.01em',
          color: 'var(--v3-text)',
          lineHeight: 1.25,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
        }}>
          {c.name || 'Unnamed client'}
        </h3>
        {c.company_name && (
          <div style={{
            marginTop: 4,
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            color: 'var(--v3-text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            {c.company_name}
          </div>
        )}
      </div>

      {/* Stat strip — colored chips with leading dot */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        fontSize: 11,
        fontFamily: 'var(--font-body)',
        fontWeight: 700
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 10px',
          borderRadius: 999,
          background: r.activeCount > 0 ? 'var(--v3-primary-soft)' : 'rgba(255, 255, 255, 0.03)',
          border: r.activeCount > 0
            ? '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)'
            : '1px solid var(--v3-border)',
          color: r.activeCount > 0 ? 'var(--v3-primary)' : 'var(--v3-text-muted)',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '0.04em'
        }}>
          <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: r.activeCount > 0 ? 'var(--v3-primary)' : 'var(--v3-text-muted)' }} />
          {r.activeCount} active {r.activeCount === 1 ? 'job' : 'jobs'}
        </span>
        {r.outstanding > 0 && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px',
            borderRadius: 999,
            background: 'rgba(192, 57, 43, 0.10)',
            border: '1px solid color-mix(in srgb, var(--v3-danger) 35%, transparent)',
            color: 'var(--v3-danger-bright)',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '0.04em'
          }}>
            <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--v3-danger-bright)' }} />
            {money(r.outstanding)} outstanding
          </span>
        )}
      </div>

      {/* Push footer to bottom of card so all tiles match height */}
      <div style={{ flex: 1 }} />

      {/* Footer: contact actions + last-activity caption */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, paddingTop: 12, borderTop: '1px solid var(--v3-border)',
          marginTop: 'auto'
        }}
      >
        <div style={{ display: 'flex', gap: 6 }}>
          {c.phone && (
            <>
              <a href={`tel:${c.phone}`} onClick={(e) => { e.stopPropagation(); hapticTap() }} aria-label={`Call ${c.name}`} style={contactBtnStyle}>
                <Phone size={14} />
              </a>
              <a href={`sms:${c.phone}`} onClick={(e) => { e.stopPropagation(); hapticTap() }} aria-label={`Text ${c.name}`} style={contactBtnStyle}>
                <MessageSquare size={14} />
              </a>
            </>
          )}
          {c.email && (
            <a href={`mailto:${c.email}`} onClick={(e) => { e.stopPropagation(); hapticTap() }} aria-label={`Email ${c.name}`} style={contactBtnStyle}>
              <Mail size={14} />
            </a>
          )}
          {c.address && (
            <a href={`https://maps.apple.com/?address=${encodeURIComponent(c.address)}`} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.stopPropagation(); hapticTap() }} aria-label={`Map to ${c.name}`} style={contactBtnStyle}>
              <Map size={14} />
            </a>
          )}
        </div>
        {lastActivityRel && (
          <span style={{
            fontFamily: 'var(--font-body)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--v3-text-muted)',
            fontVariantNumeric: 'tabular-nums'
          }}>
            Last · {lastActivityRel}
          </span>
        )}
      </div>
    </motion.button>
  )
}

const contactBtnStyle = {
  display: 'grid', placeItems: 'center',
  width: 42, height: 42, borderRadius: 11,
  background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border)',
  color: 'var(--v3-text)', textDecoration: 'none',
  WebkitTapHighlightColor: 'transparent'
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
