import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Phone, Search, Hammer, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { SkeletonList } from '../components/Skeleton.jsx'

// Subs directory — aggregates fh_subs rows by (name + phone) so the same
// sub appearing on 5 jobs shows as ONE entry with 5-job history. No
// migration needed; the existing per-job row is the source of truth.
//
// Stats per sub:
//   jobsCount   — distinct contact_ids
//   totalRate   — sum of `rate` across rows (used as proxy for "billed")
//   trades      — unique trade strings
//   lastWorked  — newest created_at across rows
//   jobIds      — list for the expanded "history" view

export default function Subs() {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [contacts, setContacts] = useState({})
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [tradeFilter, setTradeFilter] = useState('')

  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const [{ data: subs }, { data: cs }] = await Promise.all([
        supabase.from('fh_subs').select('*').order('created_at', { ascending: false }),
        supabase.from('fh_contacts').select('id, name, job_title, stage')
      ])
      if (cancelled) return
      setRows(subs || [])
      const map = {}
      for (const c of cs || []) map[c.id] = c
      setContacts(map)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [user])

  // Roll up by sub identity. Phone wins (unique) when present; falls
  // back to lowercased name. Subs with neither name nor phone get
  // grouped as "Untitled" so they're still listed but obvious.
  const grouped = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      const key = (r.phone || r.name || '').toLowerCase().trim() || '__untitled__'
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: r.name?.trim() || '(Unnamed sub)',
          phone: r.phone || '',
          trades: new Set(),
          jobsCount: 0,
          jobIds: new Set(),
          totalRate: 0,
          lastWorked: null,
          rows: []
        })
      }
      const g = map.get(key)
      if (r.trade) g.trades.add(r.trade)
      g.totalRate += Number(r.rate || 0)
      if (r.contact_id && !g.jobIds.has(r.contact_id)) {
        g.jobIds.add(r.contact_id)
        g.jobsCount++
      }
      const created = r.created_at ? new Date(r.created_at) : null
      if (created && (!g.lastWorked || created > g.lastWorked)) g.lastWorked = created
      g.rows.push(r)
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.lastWorked && b.lastWorked) return b.lastWorked - a.lastWorked
      return a.name.localeCompare(b.name)
    })
  }, [rows])

  const allTrades = useMemo(() => {
    const s = new Set()
    for (const g of grouped) for (const t of g.trades) s.add(t)
    return Array.from(s).sort()
  }, [grouped])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return grouped.filter((g) => {
      if (tradeFilter && !g.trades.has(tradeFilter)) return false
      if (!needle) return true
      return (
        g.name.toLowerCase().includes(needle) ||
        g.phone.toLowerCase().includes(needle) ||
        Array.from(g.trades).some((t) => t.toLowerCase().includes(needle))
      )
    })
  }, [grouped, q, tradeFilter])

  return (
    <div style={{ padding: '20px 16px 80px', maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
            <Hammer size={12} />
            Sub directory
          </div>
          <h1 className="fh-font-serif" style={{ margin: '6px 0 0', fontSize: 'clamp(28px, 7vw, 36px)', lineHeight: 1.05, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}>
            Your <em className="fh-font-serif-italic fh-text-gradient-gold">trade bench.</em>
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)' }}>
            Every sub you've put on a job, rolled up. Add new subs from any job's Subs tab.
          </p>
        </div>
      </div>

      {/* Search + trade filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-faint)' }} aria-hidden="true">
            <Search size={14} />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, phone, trade…"
            style={{ width: '100%', padding: '10px 12px 10px 34px', borderRadius: 10, border: '1px solid var(--rule)', background: 'rgba(255,255,255,0.03)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 13, boxSizing: 'border-box' }}
          />
        </div>
      </div>
      {allTrades.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          <TradePill active={!tradeFilter} onClick={() => setTradeFilter('')} label="All" />
          {allTrades.map((t) => (
            <TradePill key={t} active={tradeFilter === t} onClick={() => setTradeFilter(t)} label={t} />
          ))}
        </div>
      )}

      {loading && <SkeletonList rows={4} />}
      {!loading && grouped.length === 0 && (
        <EmptyState
          title="No subs yet."
          body="Open any job, go to the Subs tab, and add one. They show up here automatically."
        />
      )}
      {!loading && grouped.length > 0 && filtered.length === 0 && (
        <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', fontSize: 13 }}>
          No subs match that filter.
        </div>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map((g) => (
          <SubRow key={g.key} g={g} contacts={contacts} />
        ))}
      </ul>
    </div>
  )
}

function TradePill({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 10px',
        borderRadius: 999,
        border: active ? '1px solid var(--field-gold-bright)' : '1px solid var(--rule)',
        background: active ? 'rgba(201,150,58,0.15)' : 'rgba(255,255,255,0.03)',
        color: active ? 'var(--field-gold-bright)' : 'var(--ink-strong)',
        fontFamily: 'var(--font-body)',
        fontSize: 11,
        fontWeight: active ? 700 : 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap'
      }}
    >
      {label}
    </button>
  )
}

function SubRow({ g, contacts }) {
  const [expanded, setExpanded] = useState(false)
  const tradeSummary = Array.from(g.trades).join(' · ') || 'No trade set'
  return (
    <li style={{ borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--rule)', overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: '100%',
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          padding: '12px 14px',
          cursor: 'pointer',
          color: 'var(--ink-strong)',
          display: 'flex',
          alignItems: 'center',
          gap: 12
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: 'var(--ink-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</span>
            <span style={{ flexShrink: 0, fontFamily: 'var(--font-display)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
              {g.jobsCount} {g.jobsCount === 1 ? 'job' : 'jobs'}
            </span>
          </div>
          <div style={{ marginTop: 2, fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)' }}>
            {tradeSummary}
            {g.phone && <> · <a href={`tel:${g.phone}`} onClick={(e) => e.stopPropagation()} style={{ color: 'var(--ink-muted)', textDecoration: 'none' }}><Phone size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 2 }} />{g.phone}</a></>}
            {g.totalRate > 0 && <> · <span style={{ color: 'var(--ink-strong)' }}>${g.totalRate.toLocaleString()}</span> billed</>}
          </div>
        </div>
        <span aria-hidden="true" style={{ color: 'var(--ink-faint)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 160ms ease' }}>
          <ChevronRight size={16} />
        </span>
      </button>
      {expanded && g.rows.length > 0 && (
        <ul style={{ listStyle: 'none', padding: '4px 14px 12px', margin: 0, borderTop: '1px solid var(--rule)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {g.rows.map((r) => {
            const c = contacts[r.contact_id]
            return (
              <li key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 0', fontFamily: 'var(--font-body)', fontSize: 12 }}>
                {c ? (
                  <Link to={`/jobs/${c.id}`} style={{ color: 'var(--ink-strong)', textDecoration: 'none', display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                    <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                    {c.job_title && <span style={{ color: 'var(--ink-faint)', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.job_title}</span>}
                  </Link>
                ) : (
                  <span style={{ color: 'var(--ink-faint)', flex: 1 }}>(Job not found)</span>
                )}
                <span style={{ flexShrink: 0, color: 'var(--ink-muted)' }}>
                  {Number(r.rate || 0) > 0 ? `$${Number(r.rate).toLocaleString()}` : '—'}
                </span>
                <span style={{ flexShrink: 0, padding: '2px 6px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', color: 'var(--ink-muted)', fontSize: 10, textTransform: 'capitalize' }}>
                  {r.status || 'scheduled'}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}
