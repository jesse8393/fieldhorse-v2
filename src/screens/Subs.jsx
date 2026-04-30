import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Phone, Plus, Search, Hammer, ChevronRight, MessageSquare } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { formatPhone } from '../lib/utils.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { hapticTap, hapticSuccess } from '../lib/haptics.js'
import { useFhMotion } from '../lib/motion.js'
import { SkeletonList } from '../components/Skeleton.jsx'
import SectionHeader from '../components/v3/SectionHeader.jsx'
import { FilterPill, Eyebrow, StampNumber } from '../components/v3'
import { toastSuccess, toastError } from '../lib/toast.js'
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription
} from '@/components/ui/drawer'

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

function money(n) {
  const v = Number(n || 0)
  if (!v) return '$0'
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 1 : 2)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}K`
  return `$${Math.round(v).toLocaleString()}`
}

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
  const [addOpen, setAddOpen] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const [{ data: subs }, { data: cs }] = await Promise.all([
      supabase.from('fh_subs').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('fh_contacts').select('id, name, job_title, stage').eq('user_id', user.id)
    ])
    setRows(subs || [])
    const map = {}
    for (const c of cs || []) map[c.id] = c
    setContacts(map)
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

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

  // Screen-level rollups — derived from the same grouped[] that powers
  // per-card stats. Single source of truth.
  const screenStats = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    let totalBilled = 0
    let activeRecent = 0
    for (const g of grouped) {
      totalBilled += g.totalRate
      if (g.lastWorked && g.lastWorked.getTime() > cutoff) activeRecent++
    }
    return { totalBilled, activeRecent }
  }, [grouped])

  // Highest-billed sub in the filtered set — surfaces a small "TOP"
  // gold rib on its card. Threshold-gated to avoid noise on small
  // lists or zero-billed subs. Mirrors the Jobs / Clients pattern.
  const topSubKey = useMemo(() => {
    if (filtered.length < 2) return null
    let key = null
    let max = 0
    for (const g of filtered) {
      if (g.totalRate > max) { max = g.totalRate; key = g.key }
    }
    return max > 0 ? key : null
  }, [filtered])

  const { stagger, item } = useFhMotion()

  return (
    <motion.div
      className="v3-screen"
      variants={stagger}
      initial="hidden"
      animate="show"
      style={{ paddingBottom: 120, position: 'relative', background: 'var(--v3-bg)' }}
    >
      {/* COCKPIT — black-glass panel: title eyebrow + state chip + KPI strip */}
      <motion.div variants={item} style={{ padding: '8px 20px 12px' }}>
        <div style={{
          padding: '14px 16px',
          borderRadius: 16,
          background: 'var(--v3-surface)',
          border: '1px solid var(--v3-border)',
          boxShadow: '0 1px 0 rgba(255, 240, 210, 0.04) inset, 0 8px 22px rgba(0, 0, 0, 0.40)'
        }}>
          {/* Header row: section eyebrow + state chip + Add sub action */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <Eyebrow tone="gold">
              <Hammer size={11} aria-hidden="true" />
              Sub Directory
            </Eyebrow>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {!loading && (
                <SubsStateChip
                  activeRecent={screenStats.activeRecent}
                  tradesCount={allTrades.length}
                  totalSubs={grouped.length}
                />
              )}
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={() => { hapticTap(); setAddOpen(true) }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  minHeight: 44,
                  padding: '0 14px 0 12px',
                  borderRadius: 999,
                  border: '1px solid color-mix(in srgb, var(--v3-primary) 50%, transparent)',
                  background: 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
                  color: 'var(--v3-on-primary)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                  boxShadow: '0 0 0 2px rgba(228, 190, 111, 0.14), 0 4px 10px rgba(201, 150, 58, 0.28)'
                }}
              >
                <Plus size={13} strokeWidth={2.6} />
                Add sub
              </motion.button>
            </div>
          </div>

          {/* KPI strip — Total billed | Subs · Trades */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1px 1fr',
            alignItems: 'end',
            gap: 12
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <Eyebrow tone="gold">Total billed</Eyebrow>
              <StampNumber size="2xl" tone="gold" style={{ display: 'block', lineHeight: 0.95 }}>
                {money(screenStats.totalBilled)}
              </StampNumber>
              <Eyebrow as="div" style={{ marginTop: 2 }}>
                across {grouped.length} {grouped.length === 1 ? 'sub' : 'subs'}
              </Eyebrow>
            </div>
            <span aria-hidden="true" style={{ background: 'var(--v3-border)', alignSelf: 'stretch' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <Eyebrow>Trades covered</Eyebrow>
              <StampNumber size="xl" style={{ display: 'block', lineHeight: 0.95 }}>
                {allTrades.length}
              </StampNumber>
              <Eyebrow as="div" style={{ marginTop: 2 }}>
                {screenStats.activeRecent > 0
                  ? `${screenStats.activeRecent} worked in 30d`
                  : 'no recent activity'}
              </Eyebrow>
            </div>
          </div>
        </div>
      </motion.div>

      {/* SEARCH + TRADE FILTER */}
      <motion.div
        variants={item}
        style={{ padding: '0 20px 12px' }}
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
            <FilterPill size="sm" active={!tradeFilter} onClick={() => { hapticTap(); setTradeFilter('') }}>All</FilterPill>
            {allTrades.map((t) => (
              <FilterPill
                key={t}
                size="sm"
                active={tradeFilter === t}
                onClick={() => { hapticTap(); setTradeFilter(t) }}
              >
                {t}
              </FilterPill>
            ))}
          </div>
        )}
      </motion.div>

      {/* LIST SECTION */}
      <motion.div
        variants={item}
        className="v3-section"
        style={{ margin: '0 20px 28px' }}
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
              <SubCard key={g.key} g={g} contacts={contacts} isTop={g.key === topSubKey} />
            ))}
          </ul>
        )}
      </motion.div>

      {/* Add Sub drawer — schema-honest fields only */}
      <AddSubDrawer
        open={addOpen}
        userId={user?.id}
        onClose={() => setAddOpen(false)}
        onCreated={async () => {
          setAddOpen(false)
          await load()
        }}
      />
    </motion.div>
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
function SubCard({ g, contacts, isTop }) {
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
          border: isTop
            ? '1px solid color-mix(in srgb, var(--v3-primary) 28%, transparent)'
            : '1px solid var(--v3-border)',
          boxShadow: '0 1px 0 rgba(255, 240, 210, 0.04) inset, 0 4px 14px rgba(0, 0, 0, 0.30)',
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
          {/* Initial tile — restrained: surface-2 + subtle gold border + gold initial.
              Gold gradient + gold inset highlight dropped per the no-gold-wash direction. */}
          <span aria-hidden="true" style={{
            flexShrink: 0,
            width: 44,
            height: 44,
            borderRadius: 12,
            display: 'grid',
            placeItems: 'center',
            background: 'var(--v3-surface-2)',
            border: '1px solid color-mix(in srgb, var(--v3-primary) 22%, transparent)',
            color: 'var(--v3-primary)',
            fontFamily: 'var(--font-display)',
            fontSize: 16,
            letterSpacing: '0.04em',
            boxShadow: 'inset 0 1px 0 rgba(255, 240, 210, 0.05)'
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
              {isTop && (
                <span aria-hidden="true" style={{
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '2px 7px',
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

/* ============================================================
   AddSubDrawer — directory-level vendor creation. Inserts into
   fh_subs with contact_id=null so the new sub appears in the
   directory roll-up immediately and can be linked to a job
   later via the per-job SubsSection.

   Schema-honest fields only (fh_subs columns: name, trade,
   phone). Rate stays at the schema default 0; status stays at
   the schema default 'scheduled'. Both are meaningless without
   a job, so they're not surfaced here.
   ============================================================ */
function AddSubDrawer({ open, userId, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', trade: '', phone: '' })
  const [saving, setSaving] = useState(false)

  // Reset whenever the drawer closes so a re-open starts fresh.
  useEffect(() => {
    if (!open) setForm({ name: '', trade: '', phone: '' })
  }, [open])

  async function save(e) {
    e?.preventDefault?.()
    if (saving) return
    const name = form.name.trim()
    if (!name) return
    setSaving(true)
    const { error } = await supabase.from('fh_subs').insert({
      user_id: userId,
      contact_id: null,
      name,
      trade: form.trade.trim() || null,
      phone: form.phone.trim() || null
    })
    if (error) {
      toastError("Couldn't add sub", error.message)
      setSaving(false)
      return
    }
    hapticSuccess()
    toastSuccess('Sub added', name)
    setSaving(false)
    onCreated?.()
  }

  const fieldStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '12px 14px', borderRadius: 12,
    background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border-strong)',
    color: 'var(--v3-text)', fontFamily: 'var(--font-body)',
    fontSize: 14, outline: 'none'
  }
  const labelStyle = {
    fontFamily: 'var(--font-body)',
    fontSize: 10, fontWeight: 700,
    letterSpacing: '0.16em', textTransform: 'uppercase',
    color: 'var(--v3-text-muted)'
  }

  return (
    <Drawer open={open} onOpenChange={(v) => { if (!v) onClose?.() }}>
      <DrawerContent>
        <DrawerHeader>
          <Eyebrow tone="gold">
            <Hammer size={11} aria-hidden="true" />
            New sub
          </Eyebrow>
          <DrawerTitle asChild>
            <h2 style={{
              margin: '6px 0 0',
              fontFamily: 'var(--font-body)',
              fontSize: 'clamp(20px, 5.5vw, 24px)',
              lineHeight: 1.1,
              letterSpacing: '-0.01em',
              fontWeight: 700,
              color: 'var(--v3-text)'
            }}>
              Add to the trade directory
            </h2>
          </DrawerTitle>
          <DrawerDescription style={{
            margin: '6px 0 0',
            fontFamily: 'var(--font-body)',
            fontSize: 12, color: 'var(--v3-text-muted)', lineHeight: 1.5
          }}>
            Name is enough to start. Trade and phone help when you assign them to a job later.
          </DrawerDescription>
        </DrawerHeader>

        <form onSubmit={save} style={{ padding: '4px 20px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>Name</span>
            <input
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Crew lead or company"
              style={fieldStyle}
              required
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>Trade</span>
            <input
              value={form.trade}
              onChange={(e) => setForm({ ...form, trade: e.target.value })}
              placeholder="Framer, electrician, roofer…"
              style={fieldStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>Phone</span>
            <input
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="(615) 555-0000"
              style={fieldStyle}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={{
                padding: '12px 14px', borderRadius: 12,
                background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border-strong)',
                color: 'var(--v3-text)', fontFamily: 'var(--font-body)',
                fontSize: 13, fontWeight: 700, cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <motion.button
              type="submit"
              whileTap={{ scale: 0.98 }}
              disabled={saving || !form.name.trim()}
              style={{
                padding: '12px 14px', borderRadius: 12,
                border: '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)',
                background: !form.name.trim() || saving
                  ? 'var(--v3-surface-2)'
                  : 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
                color: !form.name.trim() || saving ? 'var(--v3-text-muted)' : 'var(--v3-on-primary)',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                cursor: !form.name.trim() || saving ? 'default' : 'pointer',
                boxShadow: !form.name.trim() || saving
                  ? 'none'
                  : '0 0 0 2px rgba(228, 190, 111, 0.14), 0 4px 12px rgba(201, 150, 58, 0.28)'
              }}
            >
              {saving ? 'Saving…' : 'Add sub'}
            </motion.button>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  )
}

/* ============================================================
   SubsStateChip — small premium status pill in the cockpit
   top-right. Mirrors the Money Owed / Clients pattern.
     active recent (>0)  → gold  "N active in 30d"
     trades only         → muted "N trades covered"
     empty               → muted "No subs yet"
   ============================================================ */
function SubsStateChip({ activeRecent, tradesCount, totalSubs }) {
  let bg, border, color, label
  if (activeRecent > 0) {
    bg = 'var(--v3-primary-soft)'
    border = 'color-mix(in srgb, var(--v3-primary) 35%, transparent)'
    color = 'var(--v3-primary)'
    label = `${activeRecent} active in 30d`
  } else if (totalSubs > 0) {
    bg = 'var(--v3-surface-2)'
    border = 'var(--v3-border-strong)'
    color = 'var(--v3-text-muted)'
    label = `${tradesCount} ${tradesCount === 1 ? 'trade' : 'trades'} covered`
  } else {
    bg = 'var(--v3-surface-2)'
    border = 'var(--v3-border-strong)'
    color = 'var(--v3-text-muted)'
    label = 'No subs yet'
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
