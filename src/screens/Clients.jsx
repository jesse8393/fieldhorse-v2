import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Search, Briefcase, Phone, Mail } from 'lucide-react'
import { SkeletonList } from '../components/Skeleton.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
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
  const [addOpen, setAddOpen] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data } = await supabase
      .from('fh_clients')
      .select('*')
      .eq('user_id', user.id)
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
    setRows(data || [])
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((r) =>
      (r.name || '').toLowerCase().includes(needle)
      || (r.company_name || '').toLowerCase().includes(needle)
      || (r.email || '').toLowerCase().includes(needle)
      || (r.phone || '').toLowerCase().includes(needle)
    )
  }, [rows, q])

  const totalLifetime = useMemo(
    () => rows.reduce((s, r) => s + Number(r.total_lifetime_value || 0), 0),
    [rows]
  )

  const stagger = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.05 } } }
  const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 220, damping: 26 } } }

  return (
    <motion.div className="fh-screen" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: 120, position: 'relative' }}>
      <motion.div variants={item} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '10px 20px 6px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
            Directory · {rows.length}
          </span>
          <h1 className="fh-font-serif" style={{ margin: '4px 0 0', fontSize: 'clamp(22px, 6vw, 30px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}>
            Your{' '}
            <em className="fh-font-serif-italic fh-text-gradient-gold">clients.</em>
          </h1>
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)' }}>
            <span style={{ color: 'var(--field-gold-bright)', fontWeight: 700 }}>{money(totalLifetime)}</span>{' '}lifetime
          </div>
        </div>
        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          onClick={() => setAddOpen(true)}
          aria-label="New client"
          style={{
            flexShrink: 0,
            width: 44,
            height: 44,
            borderRadius: 14,
            border: 'none',
            background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
            color: 'var(--onyx)',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            boxShadow: '0 8px 20px rgba(201,150,58,0.35)'
          }}
        >
          <Plus size={20} strokeWidth={2.5} />
        </motion.button>
      </motion.div>

      <motion.div variants={item} style={{ padding: '0 20px 10px' }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)', pointerEvents: 'none' }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, company, phone, email…"
            style={{ width: '100%', padding: '10px 12px 10px 34px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
      </motion.div>

      <motion.div variants={item} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 20px 20px' }}>
        {loading && <SkeletonList rows={4} card={false} />}
        {!loading && rows.length === 0 && (
          <div style={{ padding: '32px 20px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px dashed var(--rule)', textAlign: 'center', color: 'var(--ink-muted)', fontFamily: 'var(--font-body)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-strong)', marginBottom: 4 }}>No clients yet.</div>
            <div style={{ fontSize: 12, marginBottom: 10 }}>A client is a person you work for across one or more jobs.</div>
            <button type="button" onClick={() => setAddOpen(true)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--field-gold-bright)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              Add your first client →
            </button>
          </div>
        )}
        {!loading && rows.length > 0 && filtered.length === 0 && (
          <div style={{ padding: '24px 20px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px dashed var(--rule)', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 12 }}>
            No clients match that search.
          </div>
        )}
        <AnimatePresence>
          {filtered.map((c, i) => (
            <motion.button
              key={c.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, delay: Math.min(i * 0.03, 0.2), ease: [0.2, 0.8, 0.2, 1] }}
              whileHover={{ boxShadow: '0 0 24px rgba(201,150,58,0.18), 0 0 0 1px rgba(201,150,58,0.25)' }}
              whileTap={{ scale: 0.995 }}
              type="button"
              onClick={() => navigate(`/clients/${c.id}`)}
              style={{
                position: 'relative',
                overflow: 'hidden',
                padding: '14px 16px 14px 20px',
                borderRadius: 14,
                background: 'linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.02) 100%)',
                border: '1px solid var(--rule)',
                textAlign: 'left',
                color: 'var(--ink-strong)',
                cursor: 'pointer'
              }}
            >
              <span
                aria-hidden="true"
                style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderRadius: '0 3px 3px 0', background: 'linear-gradient(180deg, var(--field-gold-bright), var(--field-gold-deep))', boxShadow: '0 0 10px rgba(201,150,58,0.35)' }}
              />
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h3 style={{ margin: 0, fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 600, color: 'var(--ink-strong)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.name || 'Unnamed client'}
                  </h3>
                  {c.company_name && (
                    <div style={{ marginTop: 2, fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.company_name}
                    </div>
                  )}
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: '0.02em', lineHeight: 1, color: 'var(--field-gold-bright)' }}>
                    {money(c.total_lifetime_value)}
                  </div>
                  <div style={{ marginTop: 2, fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--ink-faint)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    LIFETIME
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 11, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Briefcase size={11} />
                  {c.active_jobs_count} {c.active_jobs_count === 1 ? 'active' : 'active'}
                </span>
                {c.phone && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Phone size={11} />
                    {c.phone}
                  </span>
                )}
                {c.email && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, overflow: 'hidden' }}>
                    <Mail size={11} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</span>
                  </span>
                )}
              </div>
            </motion.button>
          ))}
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
    </motion.div>
  )
}
