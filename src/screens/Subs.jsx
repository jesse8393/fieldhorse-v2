import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Phone, Search, Hammer, ChevronRight, MessageSquare } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { formatPhone } from '../lib/utils.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { hapticTap } from '../lib/haptics.js'
import { useFhMotion } from '../lib/motion.js'
import { SkeletonList } from '../components/Skeleton.jsx'
import SectionHeader from '../components/v3/SectionHeader.jsx'

// Subs directory — v3 rebuild. Aggregates fh_subs rows by (name + phone)
// so the same sub appearing on 5 jobs shows as ONE entry with 5-job
// history. No migration needed; the existing per-job row is the source
// of truth.
//
// Stats per sub (preserved from prior version):
//   jobsCount   — distinct contact_ids
//   totalRate   — sum of `rate` across rows (proxy for "billed")
//   trades      — unique trade strings
//   lastWorked  — newest created_at across rows
//   jobIds      — list for the expanded "history" view

function fmtRelativeDate(d) {
  if (!d) return ''
  const now = new Date()
  const ms = now - d
  const days = Math.floor(ms / 86400000)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

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

  const { stagger, item } = useFhMotion()

  return (
    <motion.div
      className="v3-screen"
      variants={stagger}
      initial="hidden"
      animate="show"
      style={{ paddingBottom: 120, position: 'relative', background: 'var(--v3-bg)' }}
    >
      {/* HEADER — premium trade-network identity */}
      <motion.div
        variants={item}
        style={{
          padding: '12px var(--v3-gutter) 18px',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <span className="v3-eyebrow" style={{ color: 'var(--v3-primary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Hammer size={11} />
            Sub Directory
          </span>
          <h1 className="v3-h1" style={{ marginTop: 6 }}>
            Your <em>trade bench.</em>
          </h1>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 18 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: 26, lineHeight: 1, letterSpacing: '0.02em',
                color: 'var(--v3-primary)',
                fontVariantNumeric: 'tabular-nums'
              }}>
                {loading ? '—' : grouped.length}
              </span>
              <span className="v3-eyebrow">
                {grouped.length === 1 ? 'Sub' : 'Subs'}
              </span>
            </div>
            {!loading && allTrades.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 22, lineHeight: 1, letterSpacing: '0.02em',
                  color: 'var(--v3-text)',
                  fontVariantNumeric: 'tabular-nums'
                }}>
                  {allTrades.length}
                </span>
                <span className="v3-eyebrow">
                  {allTrades.length === 1 ? 'Trade' : 'Trades'}
                </span>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* SEARCH + TRADE FILTER */}
      <motion.div
        variants={item}
        style={{ padding: '0 var(--v3-gutter) 12px' }}
      >
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{
            position: 'absolute',
            left: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--v3-text-muted)',
            pointerEvents: 'none'
          }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, phone, trade…"
            style={{
              width: '100%',
              padding: '11px 12px 11px 34px',
              borderRadius: 12,
              background: 'var(--v3-surface)',
              border: '1px solid var(--v3-border-strong)',
              color: 'var(--v3-text)',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              outline: 'none',
              boxSizing: 'border-box'
            }}
          />
        </div>
        {allTrades.length > 0 && (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            marginTop: 10
          }}>
            <TradePill active={!tradeFilter} onClick={() => { hapticTap(); setTradeFilter('') }} label="All" />
            {allTrades.map((t) => (
              <TradePill
                key={t}
                active={tradeFilter === t}
                onClick={() => { hapticTap(); setTradeFilter(t) }}
                label={t}
              />
            ))}
          </div>
        )}
      </motion.div>

      {/* LIST SECTION */}
      <motion.div
        variants={item}
        className="v3-section"
        style={{ margin: '0 var(--v3-gutter) 28px' }}
      >
        <SectionHeader label={tradeFilter ? `${tradeFilter} subs` : 'All subs'} />

        {loading && <SkeletonList rows={3} />}

        {!loading && grouped.length === 0 && (
          <div className="v3-empty">
            <Hammer size={20} color="var(--v3-text-muted)" style={{ margin: '0 auto 8px' }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
              No subs yet.
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
              Open any job, go to the Subs tab, and add one. They show up here automatically.
            </div>
          </div>
        )}

        {!loading && grouped.length > 0 && filtered.length === 0 && (
          <div className="v3-empty">
            No subs match that filter.
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <ul style={{
            listStyle: 'none',
            padding: 0,
            margin: '4px 0 0',
            display: 'flex',
            flexDirection: 'column',
            gap: 10
          }}>
            {filtered.map((g) => (
              <SubCard key={g.key} g={g} contacts={contacts} />
            ))}
          </ul>
        )}
      </motion.div>
    </motion.div>
  )
}

/* ============================================================
   TradePill — gold-gradient when active, surface when inactive.
   Same pattern as Jobs filter pills + Invoices FilterPill.
   ============================================================ */
function TradePill({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '7px 13px',
        borderRadius: 999,
        border: active
          ? '1px solid color-mix(in srgb, var(--v3-primary) 75%, transparent)'
          : '1px solid var(--v3-border-strong)',
        background: active
          ? 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)'
          : 'var(--v3-surface)',
        color: active ? 'var(--v3-on-primary)' : 'var(--v3-text)',
        fontFamily: 'var(--font-body)',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.04em',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        WebkitTapHighlightColor: 'transparent',
        boxShadow: active
          ? '0 0 0 3px rgba(229, 193, 88, 0.16), 0 4px 12px rgba(229, 193, 88, 0.30), 0 1px 0 rgba(255, 255, 255, 0.30) inset'
          : '0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 2px 8px rgba(0, 0, 0, 0.20)',
        transition: 'background 160ms ease, border-color 160ms ease, color 160ms ease'
      }}
    >
      {label}
    </button>
  )
}

/* ============================================================
   SubCard — one rolled-up sub. Tap header to expand job history.
   Layout:
     ┌──────────────────────────────────────────────────┐
     │  [HM]  Mike Diaz                   ▸ 5 jobs     │
     │        electrical · plumbing                     │
     │        ↳ (615) 555-0101 · $14,200 billed        │
     │        Last: 2w ago                              │
     │  ─────────────── (when expanded) ────────────── │
     │   • Job name (job title)        $X · scheduled  │
     │   • Job name (job title)        $X · scheduled  │
     └──────────────────────────────────────────────────┘
   Preserves the prior expand/grouping/Link behavior verbatim.
   ============================================================ */
function SubCard({ g, contacts }) {
  const [expanded, setExpanded] = useState(false)
  const tradeSummary = Array.from(g.trades).join(' · ') || 'No trade set'
  const initials = g.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || 'SB'
  const lastWorkedStr = fmtRelativeDate(g.lastWorked)

  return (
    <li>
      <motion.article
        whileHover={{ y: -2 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        style={{
          position: 'relative',
          borderRadius: 14,
          background: 'var(--v3-surface)',
          border: '1px solid var(--v3-border-strong)',
          boxShadow: '0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 4px 14px rgba(0, 0, 0, 0.30)',
          overflow: 'hidden'
        }}
      >
        {/* Header — tap to expand */}
        <button
          type="button"
          onClick={() => { hapticTap(); setExpanded((v) => !v) }}
          aria-expanded={expanded}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 14px 14px 18px',
            background: 'transparent',
            border: 'none',
            textAlign: 'left',
            color: 'var(--v3-text)',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent'
          }}
        >
          {/* Initial tile */}
          <span aria-hidden="true" style={{
            flexShrink: 0,
            width: 44,
            height: 44,
            borderRadius: 12,
            display: 'grid',
            placeItems: 'center',
            background: 'linear-gradient(135deg, rgba(229, 193, 88, 0.22), rgba(229, 193, 88, 0.06))',
            border: '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
            color: 'var(--v3-primary)',
            fontFamily: 'var(--font-display)',
            fontSize: 16,
            letterSpacing: '0.04em',
            boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.10)'
          }}>
            {initials}
          </span>

          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Row 1: name + jobs count chip */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 0
            }}>
              <span style={{
                fontFamily: 'var(--font-body)',
                fontWeight: 700,
                fontSize: 15,
                color: 'var(--v3-text)',
                letterSpacing: '-0.005em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}>
                {g.name}
              </span>
              <span style={{
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px 8px',
                borderRadius: 999,
                background: 'var(--v3-primary-soft)',
                border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
                color: 'var(--v3-primary)',
                fontFamily: 'var(--font-body)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                lineHeight: 1.4
              }}>
                {g.jobsCount} {g.jobsCount === 1 ? 'job' : 'jobs'}
              </span>
            </div>

            {/* Row 2: trade summary */}
            <div style={{
              marginTop: 3,
              fontSize: 12,
              color: 'var(--v3-text-muted)',
              fontFamily: 'var(--font-body)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {tradeSummary}
            </div>

            {/* Row 3: phone · billed · last worked */}
            <div style={{
              marginTop: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
              fontFamily: 'var(--font-body)',
              fontSize: 11,
              color: 'var(--v3-text-muted)'
            }}>
              {g.phone && (
                <a
                  href={`tel:${g.phone}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    color: 'var(--v3-text)',
                    textDecoration: 'none',
                    fontWeight: 600
                  }}
                >
                  <Phone size={11} />
                  {formatPhone(g.phone)}
                </a>
              )}
              {g.totalRate > 0 && (
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  <strong style={{ color: 'var(--v3-text)', fontWeight: 700 }}>
                    ${g.totalRate.toLocaleString()}
                  </strong> billed
                </span>
              )}
              {lastWorkedStr && (
                <span>Last: {lastWorkedStr}</span>
              )}
            </div>
          </div>

          {/* Chevron rotates 90° when expanded */}
          <span
            aria-hidden="true"
            style={{
              flexShrink: 0,
              color: 'var(--v3-text-muted)',
              transform: expanded ? 'rotate(90deg)' : 'none',
              transition: 'transform 200ms ease'
            }}
          >
            <ChevronRight size={16} />
          </span>
        </button>

        {/* Expanded job history — preserved logic + restyled rows */}
        {expanded && g.rows.length > 0 && (
          <ul style={{
            listStyle: 'none',
            padding: '4px 18px 14px 18px',
            margin: 0,
            borderTop: '1px solid var(--v3-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 2
          }}>
            {g.rows.map((r) => {
              const c = contacts[r.contact_id]
              return (
                <li
                  key={r.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    padding: '10px 0',
                    borderBottom: '1px solid var(--v3-border)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 12
                  }}
                >
                  {c ? (
                    <Link
                      to={`/jobs/${c.id}`}
                      style={{
                        color: 'var(--v3-text)',
                        textDecoration: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        minWidth: 0,
                        flex: 1
                      }}
                    >
                      <span style={{
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {c.name}
                      </span>
                      {c.job_title && (
                        <span style={{
                          color: 'var(--v3-text-muted)',
                          fontSize: 11,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}>
                          {c.job_title}
                        </span>
                      )}
                    </Link>
                  ) : (
                    <span style={{ color: 'var(--v3-text-muted)', flex: 1 }}>(Job not found)</span>
                  )}
                  <span style={{
                    flexShrink: 0,
                    fontFamily: 'var(--font-display)',
                    fontSize: 13,
                    color: 'var(--v3-text)',
                    fontVariantNumeric: 'tabular-nums'
                  }}>
                    {Number(r.rate || 0) > 0 ? `$${Number(r.rate).toLocaleString()}` : '—'}
                  </span>
                  <span style={{
                    flexShrink: 0,
                    padding: '2px 7px',
                    borderRadius: 6,
                    background: 'var(--v3-surface-2)',
                    border: '1px solid var(--v3-border)',
                    color: 'var(--v3-text-muted)',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase'
                  }}>
                    {r.status || 'scheduled'}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </motion.article>
    </li>
  )
}
