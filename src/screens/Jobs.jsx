import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { Plus, Search, MessageSquare, Mail, Phone, ExternalLink, Users as UsersIcon } from 'lucide-react'
import NewLeadSheet from '../components/NewLeadSheet.jsx'
import { SkeletonList } from '../components/Skeleton.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { STAGE_MAP, ACTIVE_STAGES, margin, marginTier } from '../lib/stages.js'
import { toastSuccess } from '../lib/toast.js'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'

// Stage progression for the pipeline progress bar (pure visual; lost collapses to zero).
const STAGE_STEP = { lead: 1, quote: 2, job: 3, invoice: 4, closed: 5, lost: 0 }
const TOTAL_STAGES = 5

// Tabs collapse 6 raw stages to 5 honest groupings.
const TABS = [
  { id: 'all',    label: 'All',    match: () => true },
  { id: 'lead',   label: 'Lead',   match: (c) => c.stage === 'lead' },
  { id: 'quote',  label: 'Quote',  match: (c) => c.stage === 'quote' },
  { id: 'active', label: 'Active', match: (c) => c.stage === 'job' },
  { id: 'won',    label: 'Won',    match: (c) => c.stage === 'invoice' || c.stage === 'closed' }
]

function money(n) {
  const v = Number(n || 0)
  if (!v) return '$0'
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function kFormat(n) {
  const v = Number(n || 0)
  if (v >= 1000) return `$${(v / 1000).toFixed(0)}K`
  return money(v)
}

function initials(name) {
  if (!name) return ''
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
}

function triggerCommandPalette() {
  // CommandPalette listens for Cmd/Ctrl+K at the window level.
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true }))
}

export default function Jobs() {
  const { user } = useAuth()
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [justAddedId, setJustAddedId] = useState(null)
  const [drawerContact, setDrawerContact] = useState(null)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data, error } = await supabase
      .from('fh_contacts')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
    if (!error) setContacts(data || [])
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setAddOpen(true)
      searchParams.delete('new')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const activeTab = TABS.find((t) => t.id === filter) || TABS[0]

  const filtered = useMemo(() => {
    let rows = contacts.filter(activeTab.match)
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter((c) =>
        [c.name, c.job_title, c.job_type, c.phone, c.email, c.address, c.referred_by]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q))
      )
    }
    return rows
  }, [contacts, activeTab, search])

  const summary = useMemo(() => {
    const pipeline = contacts
      .filter((c) => ACTIVE_STAGES.includes(c.stage))
      .reduce((s, c) => s + Number(c.amount || 0), 0)
    const activeCount = contacts.filter((c) => ACTIVE_STAGES.includes(c.stage)).length
    return { pipeline, activeCount }
  }, [contacts])

  const tabCounts = useMemo(() => {
    const out = {}
    for (const t of TABS) out[t.id] = contacts.filter(t.match).length
    return out
  }, [contacts])

  function openDrawer(contact) {
    setDrawerContact(contact)
  }

  function closeDrawer() {
    setDrawerContact(null)
  }

  function onDrawerOpenChange(next) {
    if (!next) closeDrawer()
  }

  const stagger = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.08 } } }
  const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 220, damping: 26 } } }

  return (
    <motion.div className="fh-screen" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: 120, position: 'relative' }}>
      {/* HEADER */}
      <motion.div variants={item} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '20px 20px 6px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1
            className="fh-font-serif"
            style={{ margin: 0, fontSize: 'clamp(22px, 6vw, 30px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}
          >
            Jobs &{' '}
            <em className="fh-font-serif-italic fh-text-gradient-gold">pipeline</em>
          </h1>
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)' }}>
            <span style={{ color: 'var(--field-gold-bright)', fontWeight: 700 }}>{summary.activeCount}</span>
            {' '}active
            {summary.pipeline > 0 && (
              <>
                {' · '}
                <span style={{ color: 'var(--field-gold-bright)', fontWeight: 700 }}>{kFormat(summary.pipeline)}</span>
                {' total'}
              </>
            )}
          </div>
        </div>
        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          onClick={() => setAddOpen(true)}
          aria-label="New lead"
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

      {/* SEARCH + CMDK HINT */}
      <motion.div variants={item} style={{ padding: '12px 20px 10px' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={16} style={{ position: 'absolute', left: 14, color: 'var(--ink-muted)', pointerEvents: 'none' }} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search jobs, contacts, numbers…"
            style={{
              width: '100%',
              padding: '11px 72px 11px 40px',
              borderRadius: 12,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid var(--rule)',
              color: 'var(--ink-strong)',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              outline: 'none'
            }}
          />
          <button
            type="button"
            aria-label="Open command palette"
            onClick={triggerCommandPalette}
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              padding: '3px 7px',
              borderRadius: 6,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid var(--rule)',
              color: 'var(--ink-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <kbd style={{ fontFamily: 'inherit' }}>⌘</kbd>
            <kbd style={{ fontFamily: 'inherit' }}>K</kbd>
          </button>
        </div>
      </motion.div>

      {/* STAGE TABS */}
      <motion.div variants={item} style={{ padding: '0 20px 14px' }}>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }} role="tablist">
          {TABS.map((t) => {
            const isActive = filter === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setFilter(t.id)}
                style={{
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 12px',
                  borderRadius: 999,
                  border: isActive ? '1px solid rgba(201,150,58,0.4)' : '1px solid var(--rule)',
                  background: isActive ? 'rgba(201,150,58,0.14)' : 'rgba(255,255,255,0.03)',
                  color: isActive ? 'var(--field-gold-bright)' : 'var(--ink-muted)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  cursor: 'pointer',
                  transition: 'all 160ms ease'
                }}
              >
                {t.label}
                <span style={{ fontSize: 10, opacity: 0.8 }}>{tabCounts[t.id] ?? 0}</span>
              </button>
            )
          })}
        </div>
      </motion.div>

      {/* LIST */}
      <motion.div variants={item} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 20px 20px' }}>
        {loading && <SkeletonList rows={5} />}
        {!loading && filtered.length === 0 && (
          <EmptyView
            hasFilter={filter !== 'all' || !!search}
            onAdd={() => setAddOpen(true)}
          />
        )}
        <AnimatePresence>
          {filtered.map((c, i) => (
            <JobCard
              key={c.id}
              contact={c}
              index={i}
              isNew={c.id === justAddedId}
              viewerUserId={user?.id}
              onOpen={openDrawer}
            />
          ))}
        </AnimatePresence>
      </motion.div>

      {/* VAUL DRAWER — quick actions */}
      <Drawer open={!!drawerContact} onOpenChange={onDrawerOpenChange}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{drawerContact?.name || 'Contact'}</DrawerTitle>
            <DrawerDescription>
              {drawerContact?.job_title || drawerContact?.job_type || 'No job title'}
              {drawerContact?.amount ? ` · ${money(drawerContact.amount)}` : ''}
            </DrawerDescription>
          </DrawerHeader>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '8px 20px 8px' }}>
            <ActionTile
              icon={MessageSquare}
              label="Text"
              disabled={!drawerContact?.phone}
              onClick={() => { if (drawerContact?.phone) window.open(`sms:${drawerContact.phone}`) }}
            />
            <ActionTile
              icon={Mail}
              label="Email"
              disabled={!drawerContact?.email}
              onClick={() => { if (drawerContact?.email) window.open(`mailto:${drawerContact.email}`) }}
            />
            <ActionTile
              icon={Phone}
              label="Call"
              disabled={!drawerContact?.phone}
              onClick={() => { if (drawerContact?.phone) window.open(`tel:${drawerContact.phone}`) }}
            />
            <ActionTile
              icon={ExternalLink}
              label="Open"
              primary
              onClick={() => {
                const id = drawerContact?.id
                if (id) navigate(`/jobs/${id}`)
                closeDrawer()
              }}
            />
          </div>
          <div style={{ padding: '14px 20px 28px', color: 'var(--ink-faint)', fontSize: 11, fontFamily: 'var(--font-body)', textAlign: 'center' }}>
            Swipe down to dismiss
          </div>
        </DrawerContent>
      </Drawer>

      {/* PRESERVED — NewLeadSheet */}
      <NewLeadSheet
        open={addOpen}
        userId={user?.id}
        onClose={() => setAddOpen(false)}
        onCreated={async (created) => {
          setAddOpen(false)
          if (created?.id) setJustAddedId(created.id)
          await load()
          setTimeout(() => setJustAddedId(null), 1200)
          toastSuccess(
            'New lead added',
            created?.name ? `${created.name} is in your pipeline` : 'In your pipeline'
          )
        }}
      />
    </motion.div>
  )
}

// Cache the hover-capability check across cards — matchMedia is cheap but
// running it 30 times per render (once per card) is wasteful.
const SUPPORTS_HOVER = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(hover: hover)').matches

function JobCard({ contact, index, isNew, viewerUserId, onOpen }) {
  const stageMeta = STAGE_MAP[contact.stage]
  const stageColor = stageMeta?.color || 'var(--steel)'
  const step = STAGE_STEP[contact.stage] ?? 0
  const progressPct = (step / TOTAL_STAGES) * 100
  const m = margin(contact)
  const hasCost = Number(contact.cost || 0) > 0
  // Shared-in job: row's user_id doesn't match the viewer — via fh_job_partners
  // RLS (latent until migration 004 runs; always false today).
  const isSharedIn = !!viewerUserId && !!contact.user_id && contact.user_id !== viewerUserId

  // 3D tilt — desktop/mouse only. Motion values are created regardless so
  // hook order stays stable; they just never receive non-zero input on touch.
  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const springX = useSpring(mx, { stiffness: 260, damping: 26 })
  const springY = useSpring(my, { stiffness: 260, damping: 26 })
  const rotateY = useTransform(springX, [-80, 80], [-6, 6])
  const rotateX = useTransform(springY, [-80, 80], [5, -5])

  function handleMouseMove(e) {
    if (!SUPPORTS_HOVER) return
    const rect = e.currentTarget.getBoundingClientRect()
    mx.set(e.clientX - (rect.left + rect.width / 2))
    my.set(e.clientY - (rect.top + rect.height / 2))
  }
  function handleMouseLeave() {
    mx.set(0)
    my.set(0)
  }

  return (
    <motion.button
      type="button"
      layout
      onClick={() => onOpen(contact)}
      onMouseMove={SUPPORTS_HOVER ? handleMouseMove : undefined}
      onMouseLeave={SUPPORTS_HOVER ? handleMouseLeave : undefined}
      initial={isNew ? { opacity: 0, scale: 0.9 } : { opacity: 0, y: 10 }}
      animate={isNew ? { opacity: 1, scale: [0.9, 1.02, 1] } : { opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={isNew
        ? { duration: 0.6, ease: [0.16, 1, 0.3, 1] }
        : { duration: 0.22, delay: Math.min(index * 0.04, 0.25), ease: [0.2, 0.8, 0.2, 1] }
      }
      whileTap={{ scale: 0.99 }}
      style={{
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '14px 14px 12px',
        borderRadius: 16,
        background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))',
        border: '1px solid var(--rule)',
        backdropFilter: 'blur(20px)',
        cursor: 'pointer',
        textAlign: 'left',
        color: 'var(--ink-strong)',
        transformPerspective: SUPPORTS_HOVER ? 1000 : undefined,
        rotateX: SUPPORTS_HOVER ? rotateX : 0,
        rotateY: SUPPORTS_HOVER ? rotateY : 0
      }}
    >
      {/* Accent spine */}
      <span style={{ position: 'absolute', left: 0, top: 14, bottom: 12, width: 3, borderRadius: '0 3px 3px 0', background: stageColor, boxShadow: `0 0 10px ${stageColor}66` }} />

      {/* Top row: avatar + name + amount */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          aria-hidden="true"
          style={{
            width: 36,
            height: 36,
            borderRadius: 11,
            display: 'grid',
            placeItems: 'center',
            fontFamily: 'var(--font-display)',
            fontSize: 15,
            letterSpacing: '0.04em',
            background: `linear-gradient(135deg, ${stageColor}33, ${stageColor}11)`,
            color: stageColor,
            border: `1px solid ${stageColor}33`
          }}
        >
          {initials(contact.name) || '—'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {contact.name || 'Untitled'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {contact.job_title || contact.job_type || 'No job title'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: '0.02em', lineHeight: 1, color: 'var(--field-gold-bright)' }}>
            {money(contact.amount)}
          </div>
        </div>
      </div>

      {/* Bottom row: stage badge + margin pill + stages count */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {stageMeta && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, background: `${stageColor}22`, border: `1px solid ${stageColor}44`, color: stageColor, fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: stageColor }} />
            {stageMeta.label}
          </span>
        )}
        {isSharedIn && (
          <span
            title="Shared with you"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 999, background: 'rgba(201,150,58,0.1)', border: '1px solid rgba(201,150,58,0.3)', color: 'var(--field-gold-bright)', fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}
          >
            <UsersIcon size={10} />
            Shared
          </span>
        )}
        <MarginPill pct={m} hasCost={hasCost} />
        <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'var(--font-body)' }}>
          {step}/{TOTAL_STAGES} stages
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ position: 'relative', height: 3, borderRadius: 999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <span
          style={{
            position: 'absolute',
            inset: 0,
            width: `${progressPct}%`,
            background: `linear-gradient(90deg, ${stageColor}, ${stageColor}cc)`,
            boxShadow: `0 0 8px ${stageColor}99`,
            borderRadius: 999,
            transition: 'width 240ms ease'
          }}
        />
      </div>
    </motion.button>
  )
}

function MarginPill({ pct, hasCost }) {
  if (!hasCost) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 999, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--rule)', color: 'var(--ink-faint)', fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 600 }}>
        No cost yet
      </span>
    )
  }
  const tier = marginTier(pct)
  const color = tier === 'good' ? 'var(--signal-green)' : tier === 'warn' ? 'var(--field-gold-bright)' : 'var(--alert-red)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 999, background: `${color}1A`, border: `1px solid ${color}44`, color, fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700 }}>
      {pct.toFixed(0)}% margin
    </span>
  )
}

function ActionTile({ icon: I, label, onClick, disabled, primary }) {
  const bg = primary
    ? 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))'
    : 'rgba(255,255,255,0.04)'
  const color = primary ? 'var(--onyx)' : disabled ? 'var(--ink-faint)' : 'var(--ink-strong)'
  const border = primary ? 'none' : '1px solid var(--rule)'
  return (
    <motion.button
      type="button"
      whileTap={disabled ? undefined : { scale: 0.97 }}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '14px 12px',
        borderRadius: 14,
        background: bg,
        border,
        color,
        fontFamily: primary ? 'var(--font-display)' : 'var(--font-body)',
        fontSize: primary ? 15 : 13,
        letterSpacing: primary ? '0.12em' : '0',
        fontWeight: primary ? 400 : 600,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        boxShadow: primary ? '0 8px 20px rgba(201,150,58,0.35)' : 'none'
      }}
    >
      <I size={18} />
      <span>{label}</span>
    </motion.button>
  )
}

function EmptyView({ hasFilter, onAdd }) {
  if (hasFilter) {
    return (
      <div style={{ padding: '32px 20px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px dashed var(--rule)', textAlign: 'center', color: 'var(--ink-muted)', fontFamily: 'var(--font-body)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-strong)', marginBottom: 4 }}>No jobs match that filter.</div>
        <div style={{ fontSize: 12 }}>Clear the search or switch stages to see more.</div>
      </div>
    )
  }
  return (
    <div style={{ padding: '32px 20px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px dashed var(--rule)', textAlign: 'center', color: 'var(--ink-muted)', fontFamily: 'var(--font-body)' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-strong)', marginBottom: 4 }}>No jobs on the board.</div>
      <div style={{ fontSize: 12, marginBottom: 10 }}>Drop in your first lead. Watch the pipeline fill.</div>
      <button
        type="button"
        onClick={onAdd}
        style={{ background: 'none', border: 'none', padding: 0, color: 'var(--field-gold-bright)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
      >
        Add first lead →
      </button>
    </div>
  )
}
