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

      <motion.div variants={item} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 20px 20px' }}>
        {loading && <SkeletonList rows={4} card={false} />}
        {!loading && rows.length === 0 && (
          <div style={{
            padding: '32px 20px', borderRadius: 14,
            background: 'var(--v3-surface)', border: '1px dashed var(--v3-border-strong)',
            textAlign: 'center', color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)'
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--v3-text)', marginBottom: 6 }}>No clients yet.</div>
            <div style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>A client is a person you work for across one or more jobs.</div>
            <button type="button" onClick={() => setAddOpen(true)} style={{ background: 'var(--v3-primary)', color: 'var(--v3-on-primary)', border: 'none', padding: '9px 16px', borderRadius: 10, fontWeight: 700, fontSize: 12, letterSpacing: '0.04em', cursor: 'pointer', boxShadow: 'var(--v3-gold-glow-sm)' }}>
              Add your first client
            </button>
          </div>
        )}
        {!loading && rows.length > 0 && filtered.length === 0 && (
          <div style={{
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
            return (
              <motion.button
                key={c.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22, delay: Math.min(i * 0.03, 0.2), ease: [0.2, 0.8, 0.2, 1] }}
                whileHover={{
                  y: -3,
                  backgroundColor: '#1C1C22',
                  boxShadow: '0 18px 48px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.3)'
                }}
                whileTap={{ scale: 0.985 }}
                type="button"
                onClick={() => { hapticTap(); navigate(`/clients/${c.id}`) }}
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  padding: '18px 18px 16px 22px',
                  borderRadius: 'var(--v3-radius-card)',
                  background: '#141418',
                  border: '1px solid var(--v3-border)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)',
                  textAlign: 'left',
                  color: 'var(--v3-text)',
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent'
                }}
              >
                {/* Gold spine — relationship value cue (account, not row) */}
                <span aria-hidden="true" style={{
                  position: 'absolute',
                  left: 0, top: 14, bottom: 14,
                  width: 3,
                  borderRadius: '0 3px 3px 0',
                  background: 'linear-gradient(180deg, var(--v3-primary), color-mix(in srgb, var(--v3-primary) 50%, transparent))',
                  boxShadow: '0 0 12px rgba(212, 175, 55, 0.45)'
                }} />

                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
                  {/* Avatar tile — 48x48 gold-tinted with first initial.
                      Gives each client visual identity (an account, not a row). */}
                  <div aria-hidden="true" style={{
                    flexShrink: 0,
                    width: 48, height: 48,
                    borderRadius: 14,
                    background: 'linear-gradient(135deg, var(--v3-primary-soft), rgba(212, 175, 55, 0.05))',
                    border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
                    display: 'grid',
                    placeItems: 'center',
                    fontFamily: 'var(--font-display)',
                    fontSize: 19,
                    letterSpacing: '0.04em',
                    color: 'var(--v3-primary)',
                    boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.06)'
                  }}>
                    {(c.name || '·').trim().charAt(0).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <h3 style={{
                      margin: 0,
                      fontFamily: 'var(--font-body)',
                      fontSize: 16, fontWeight: 700,
                      letterSpacing: '-0.01em',
                      color: 'var(--v3-text)',
                      lineHeight: 1.25,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}>
                      {c.name || 'Unnamed client'}
                    </h3>
                    {c.company_name && (
                      <div style={{
                        marginTop: 3,
                        fontFamily: 'var(--font-body)',
                        fontSize: 12,
                        color: 'var(--v3-text-muted)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                      }}>
                        {c.company_name}
                      </div>
                    )}
                  </div>
                  <div style={{ flexShrink: 0, textAlign: 'right', opacity: r.lifetime > 0 ? 1 : 0.4 }}>
                    <div style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 26, lineHeight: 1,
                      letterSpacing: '0.005em',
                      color: 'var(--v3-primary)',
                      fontVariantNumeric: 'tabular-nums'
                    }}>
                      {money(r.lifetime)}
                    </div>
                    <div style={{
                      marginTop: 4,
                      fontFamily: 'var(--font-body)',
                      fontSize: 10,
                      fontWeight: 700,
                      color: 'var(--v3-text-muted)',
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase'
                    }}>
                      Lifetime
                    </div>
                  </div>
                </div>

                {/* Stats row — active jobs + outstanding. Outstanding gets
                    danger color when > 0 to flag receivables-needing-attention. */}
                <div style={{
                  marginTop: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                  fontSize: 11,
                  fontFamily: 'var(--font-body)',
                  fontWeight: 600
                }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 9px',
                    borderRadius: 999,
                    background: r.activeCount > 0 ? 'var(--v3-primary-soft)' : 'var(--v3-surface-2)',
                    border: r.activeCount > 0
                      ? '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)'
                      : '1px solid var(--v3-border)',
                    color: r.activeCount > 0 ? 'var(--v3-primary)' : 'var(--v3-text-muted)',
                    fontVariantNumeric: 'tabular-nums',
                    letterSpacing: '0.04em'
                  }}>
                    <Briefcase size={11} />
                    {r.activeCount} active {r.activeCount === 1 ? 'job' : 'jobs'}
                  </span>
                  {r.outstanding > 0 && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '4px 9px',
                      borderRadius: 999,
                      background: 'rgba(192, 57, 43, 0.10)',
                      border: '1px solid color-mix(in srgb, var(--v3-danger) 35%, transparent)',
                      color: 'var(--v3-danger-bright)',
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 700,
                      letterSpacing: '0.04em'
                    }}>
                      {money(r.outstanding)} outstanding
                    </span>
                  )}
                </div>

                {(c.phone || c.email || c.address) && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}
                  >
                    {c.phone && (
                      <>
                        <a href={`tel:${c.phone}`} onClick={(e) => { e.stopPropagation(); hapticTap() }} aria-label={`Call ${c.name}`} style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 10, background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border-strong)', color: 'var(--v3-text)', textDecoration: 'none' }}>
                          <Phone size={15} />
                        </a>
                        <a href={`sms:${c.phone}`} onClick={(e) => { e.stopPropagation(); hapticTap() }} aria-label={`Text ${c.name}`} style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 10, background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border-strong)', color: 'var(--v3-text)', textDecoration: 'none' }}>
                          <MessageSquare size={15} />
                        </a>
                      </>
                    )}
                    {c.email && (
                      <a href={`mailto:${c.email}`} onClick={(e) => { e.stopPropagation(); hapticTap() }} aria-label={`Email ${c.name}`} style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 10, background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border-strong)', color: 'var(--v3-text)', textDecoration: 'none' }}>
                        <Mail size={15} />
                      </a>
                    )}
                    {c.address && (
                      <a href={`https://maps.apple.com/?address=${encodeURIComponent(c.address)}`} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.stopPropagation(); hapticTap() }} aria-label={`Map to ${c.name}`} style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 10, background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border-strong)', color: 'var(--v3-text)', textDecoration: 'none' }}>
                        <Map size={15} />
                      </a>
                    )}
                  </div>
                )}
              </motion.button>
            )
          })}
        </AnimatePresence>
      </motion.div>

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
