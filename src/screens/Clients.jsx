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

  const { stagger, item } = useFhMotion()

  return (
    <motion.div className="v3-screen" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: 120, position: 'relative', background: 'var(--v3-bg)' }}>
      {/* HEADER — relationship value bar. Lifetime $ promoted to Bebas
          Neue display so the operator sees the BUSINESS WEIGHT of their
          book of work, not just a label. */}
      <motion.div variants={item} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '12px 20px 10px', position: 'sticky', top: 0, zIndex: 10, background: 'linear-gradient(180deg, var(--v3-bg) 70%, transparent 100%)', backdropFilter: 'blur(10px)' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 'clamp(24px, 7vw, 34px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--v3-text)' }}>
            Clients
          </h1>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 18, fontFamily: 'var(--font-body)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: 26, lineHeight: 1, letterSpacing: '0.02em',
                color: 'var(--v3-primary)',
                fontVariantNumeric: 'tabular-nums'
              }}>
                {money(totalLifetime)}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--v3-text-muted)' }}>
                Lifetime
              </span>
            </div>
            {rows.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 22, lineHeight: 1, letterSpacing: '0.02em',
                  color: 'var(--v3-text)',
                  fontVariantNumeric: 'tabular-nums'
                }}>
                  {rows.length}
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--v3-text-muted)' }}>
                  {rows.length === 1 ? 'Account' : 'Accounts'}
                </span>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      <motion.div variants={item} style={{ padding: '0 20px 12px' }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--v3-text-muted)', pointerEvents: 'none' }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, company, phone, email…"
            style={{ width: '100%', padding: '11px 12px 11px 34px', borderRadius: 12, background: 'var(--v3-surface)', border: '1px solid var(--v3-border-strong)', color: 'var(--v3-text)', fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          {[{ id: 'all', label: 'All' }, { id: 'active', label: 'Active' }, { id: 'recent', label: 'Recent' }].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => { hapticTap(); setFilter(f.id) }}
              style={{
                padding: '7px 14px',
                borderRadius: 999,
                border: filter === f.id
                  ? '1px solid color-mix(in srgb, var(--v3-primary) 45%, transparent)'
                  : '1px solid var(--v3-border-strong)',
                background: filter === f.id ? 'var(--v3-primary-soft)' : 'transparent',
                color: filter === f.id ? 'var(--v3-primary)' : 'var(--v3-text-muted)',
                fontFamily: 'var(--font-body)',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                transition: 'background-color 160ms ease, border-color 160ms ease, color 160ms ease'
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </motion.div>

      {/* GRID LAYOUT — 1/2/3 col responsive (320px min). Each client is a
          tall vertical tile, not a wide row. */}
      <motion.div
        variants={item}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 14,
          padding: '0 20px 24px',
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
            padding: '40px 28px', borderRadius: 18,
            background: `radial-gradient(120% 80% at 50% 0%, rgba(212, 175, 55, 0.08), transparent 60%), var(--v3-surface)`,
            border: '1px dashed var(--v3-border-strong)',
            boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 1px 2px rgba(0, 0, 0, 0.25)',
            textAlign: 'center', color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14,
              background: 'var(--v3-primary-soft)',
              border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
              display: 'grid', placeItems: 'center',
              color: 'var(--v3-primary)'
            }}>
              <Briefcase size={22} aria-hidden="true" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--v3-text)' }}>
                No accounts yet.
              </h3>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--v3-text-muted)', lineHeight: 1.5, maxWidth: 320 }}>
                A client is the person you work for. Bills get sent to them, jobs roll up to them.
              </p>
            </div>
            <button type="button" onClick={() => setAddOpen(true)} style={{
              background: 'var(--v3-primary)', color: 'var(--v3-on-primary)', border: 'none',
              padding: '11px 18px', borderRadius: 12, fontWeight: 700, fontSize: 13,
              letterSpacing: '0.04em', cursor: 'pointer', boxShadow: 'var(--v3-gold-glow)'
            }}>
              Add your first client
            </button>
          </div>
        )}
        {!loading && rows.length > 0 && filtered.length === 0 && (
          <div style={{
            gridColumn: '1 / -1',
            padding: '24px 20px', borderRadius: 14,
            background: 'var(--v3-surface)', border: '1px dashed var(--v3-border-strong)',
            textAlign: 'center', color: 'var(--v3-text-muted)', fontSize: 12
          }}>
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
      <button
        type="button"
        onClick={() => { hapticMedium(); setAddOpen(true) }}
        aria-label="New client"
        className="fh-fab"
      >
        <Plus size={26} strokeWidth={2.75} />
      </button>
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

function ClientTile({ client: c, rollup: r, lastActivityRel, index, onOpen }) {
  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.03, 0.2), ease: [0.2, 0.8, 0.2, 1] }}
      whileHover={{
        y: -4,
        backgroundColor: '#1C1C22',
        boxShadow: '0 22px 56px rgba(0, 0, 0, 0.65), 0 4px 12px rgba(0, 0, 0, 0.35)'
      }}
      whileTap={{ scale: 0.985 }}
      onClick={() => { hapticTap(); onOpen() }}
      style={{
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: '20px 20px 16px 24px',
        borderRadius: 18,
        background: '#141418',
        border: '1px solid var(--v3-border-strong)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
        textAlign: 'left',
        color: 'var(--v3-text)',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        minHeight: 220,
        width: '100%',
        boxSizing: 'border-box'
      }}
    >
      {/* Gold spine — relationship value cue (account, not row) */}
      <span aria-hidden="true" style={{
        position: 'absolute',
        left: 0, top: 16, bottom: 14,
        width: 3,
        borderRadius: '0 3px 3px 0',
        background: 'linear-gradient(180deg, var(--v3-primary), color-mix(in srgb, var(--v3-primary) 50%, transparent))',
        boxShadow: '0 0 14px rgba(212, 175, 55, 0.5)'
      }} />

      {/* Top section: Avatar (left) + Lifetime $ (right) */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
        {/* 56x56 gold-tinted avatar with first initial */}
        <div aria-hidden="true" style={{
          flexShrink: 0,
          width: 56, height: 56,
          borderRadius: 16,
          background: 'linear-gradient(135deg, var(--v3-primary-soft), rgba(212, 175, 55, 0.04))',
          border: '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
          display: 'grid', placeItems: 'center',
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          letterSpacing: '0.04em',
          color: 'var(--v3-primary)',
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.07)'
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
  width: 34, height: 34, borderRadius: 9,
  background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border-strong)',
  color: 'var(--v3-text)', textDecoration: 'none',
  WebkitTapHighlightColor: 'transparent'
}
