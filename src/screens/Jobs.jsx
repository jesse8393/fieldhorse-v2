import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { Plus, Search, MessageSquare, Mail, Phone, ExternalLink, Users as UsersIcon } from 'lucide-react'
import NewLeadSheet from '../components/NewLeadSheet.jsx'
import { SkeletonList } from '../components/Skeleton.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { STAGE_MAP, ACTIVE_STAGES, margin, marginTier } from '../lib/stages.js'
import { hapticTap, hapticMedium } from '../lib/haptics.js'
import KanbanBoard from '../components/KanbanBoard.jsx'
import SwipeableRow from '../components/SwipeableRow.jsx'
import { Phone as PhoneIcon, MessageSquare as MsgIcon } from 'lucide-react'
import { toastSuccess } from '../lib/toast.js'
import { useFhMotion } from '../lib/motion.js'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'

// Stage progression for the pipeline progress bar (pure visual; lost collapses to zero).
const STAGE_STEP = { lead: 1, quote: 2, job: 3, invoice: 4, closed: 5, lost: 0 }
const TOTAL_STAGES = 5

// Tabs collapse 6 raw stages to 5 honest groupings.
const TABS = [
  { id: 'all',    label: 'All',    match: () => true },
  { id: 'lead',   label: 'Lead',   match: (c) => c.stage === 'lead' },
  { id: 'quote',  label: 'Quote',  match: (c) => c.stage === 'quote' },
  // Jobs page "Active" is a pipeline-depth filter (job-stage only).
  // The Home "Crews on site" KPI intentionally differs — it counts
  // job-stage contacts with a scheduled fh_schedule entry in the next
  // 7 days. Different purposes, different numbers by design.
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
  const [refreshTick, setRefreshTick] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [view, setView] = useState('list') // 'list' | 'kanban'
  const [isWide, setIsWide] = useState(typeof window !== 'undefined' && window.innerWidth >= 768)
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
      .select('*, fh_clients(name)')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
    if (!error) setContacts(data || [])
    setLoading(false)
  }, [user, refreshTick])

  // Supabase Realtime — re-fetch Jobs on any fh_contacts change for this user.
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`fh_contacts:jobs:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fh_contacts', filter: `user_id=eq.${user.id}` },
        () => setRefreshTick((t) => t + 1)
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setAddOpen(true)
      searchParams.delete('new')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // Resize listener — Kanban is desktop/tablet only (≥768px). Falls back to list on mobile.
  useEffect(() => {
    if (typeof window === 'undefined') return
    function onResize() {
      const wide = window.innerWidth >= 768
      setIsWide(wide)
      if (!wide) setView('list')
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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

  async function handleStageChange(contactId, nextStage) {
    // Optimistic update — flip the stage locally first so the kanban card
    // moves immediately, then write through to Supabase. Realtime listener
    // will reconcile if anything else changes server-side.
    setContacts((prev) => prev.map((c) => c.id === contactId ? { ...c, stage: nextStage } : c))
    const { error } = await supabase.from('fh_contacts').update({ stage: nextStage }).eq('id', contactId)
    if (error) {
      // Rollback on failure
      setContacts((prev) => prev.map((c) => c.id === contactId ? { ...c, stage: c.stage } : c))
      console.warn('Stage change failed:', error.message)
    }
  }

  function openDrawer(contact) {
    setDrawerContact(contact)
  }

  function closeDrawer() {
    setDrawerContact(null)
  }

  function onDrawerOpenChange(next) {
    if (!next) closeDrawer()
  }

  const { stagger, item } = useFhMotion()

  return (
    <motion.div className="fh-screen" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: 120, position: 'relative' }}>
      {/* HEADER */}
      <motion.div variants={item} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '10px 20px 6px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1
            className="fh-font-serif"
            style={{ margin: 0, fontSize: 'clamp(22px, 6vw, 30px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}
          >
            Jobs &{' '}
            pipeline
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
        {/* Top-right + button removed — moved to a Floating Action Button
            in thumb reach (bottom-right above BottomNav). See FAB below. */}
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
              boxSizing: 'border-box',
              padding: '11px 14px 11px 40px',
              borderRadius: 12,
              background: 'var(--surface-2)',
              border: '1px solid var(--rule)',
              color: 'var(--ink-strong)',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              outline: 'none'
            }}
          />
          {/* ⌘K hint removed — mobile-first, the keyboard chord is noise on
              every viewport. Command palette still triggerable via a real
              keyboard chord on desktop; just no UI affordance for it. */}
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
                  background: isActive ? 'rgba(201,150,58,0.14)' : 'var(--surface-2)',
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

      {/* VIEW TOGGLE — only on tablet+ where kanban is usable */}
      {isWide && (
        <motion.div variants={item} style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 20px 8px', gap: 6 }}>
          {[{ id: 'list', label: 'List' }, { id: 'kanban', label: 'Kanban' }].map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => { hapticTap(); setView(v.id) }}
              className="fh-press-instant"
              style={{
                padding: '6px 12px',
                borderRadius: 999,
                border: view === v.id ? '1px solid var(--field-gold)' : '1px solid var(--rule)',
                background: view === v.id ? 'rgba(201,150,58,0.14)' : 'transparent',
                color: view === v.id ? 'var(--field-gold-bright)' : 'var(--ink-muted)',
                fontFamily: 'var(--font-body)',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: 'pointer'
              }}
            >
              {v.label}
            </button>
          ))}
        </motion.div>
      )}

      {/* LIST */}
      {view === 'list' && (
        <motion.div variants={item} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 20px 20px' }}>
          {loading && <SkeletonList rows={5} />}
          {!loading && filtered.length === 0 && (
            <EmptyView
              hasFilter={filter !== 'all' || !!search}
              onAdd={() => setAddOpen(true)}
            />
          )}
          <AnimatePresence>
            {filtered.map((c, i) => {
              const swipeActions = []
              if (c.phone) {
                swipeActions.push({
                  icon: <PhoneIcon size={18} />,
                  label: `Call ${c.name || 'contact'}`,
                  color: 'rgba(45, 122, 79, 0.22)',
                  fg: 'var(--signal-green)',
                  onClick: () => { window.location.href = `tel:${c.phone}` }
                })
                swipeActions.push({
                  icon: <MsgIcon size={18} />,
                  label: `Text ${c.name || 'contact'}`,
                  color: 'rgba(199, 164, 90, 0.18)',
                  fg: 'var(--field-gold-bright)',
                  onClick: () => { window.location.href = `sms:${c.phone}` }
                })
              }
              return (
                <SwipeableRow key={c.id} actions={swipeActions} disabled={!c.phone}>
                  <JobCard
                    contact={c}
                    index={i}
                    isNew={c.id === justAddedId}
                    viewerUserId={user?.id}
                    onOpen={openDrawer}
                  />
                </SwipeableRow>
              )
            })}
          </AnimatePresence>
        </motion.div>
      )}

      {/* KANBAN — desktop / tablet drag-and-drop */}
      {view === 'kanban' && isWide && (
        <KanbanBoard contacts={filtered} onStageChange={handleStageChange} />
      )}

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
              href={drawerContact?.phone ? `sms:${drawerContact.phone}` : undefined}
            />
            <ActionTile
              icon={Mail}
              label="Email"
              disabled={!drawerContact?.email}
              href={drawerContact?.email ? `mailto:${drawerContact.email}` : undefined}
            />
            <ActionTile
              icon={Phone}
              label="Call"
              disabled={!drawerContact?.phone}
              href={drawerContact?.phone ? `tel:${drawerContact.phone}` : undefined}
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

      {/* FAB — replaces the top-right + button. Bottom-right above the
          BottomNav puts the action in the natural thumb arc. */}
      <motion.button
        type="button"
        whileTap={{ scale: 0.94 }}
        onClick={() => { hapticMedium(); setAddOpen(true) }}
        aria-label="New lead"
        className="fh-fab"
      >
        <Plus size={26} strokeWidth={2.6} />
      </motion.button>
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
      onClick={() => { hapticTap(); onOpen(contact) }}
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
      className="fh-card-raised fh-tap-flash"
      style={{
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '14px 14px 12px',
        borderRadius: 16,
        minHeight: 88,
        background: 'linear-gradient(135deg, var(--surface-2), var(--surface-2))',
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
          {contact.fh_clients?.name && !isSharedIn && (
            <div style={{ marginTop: 3, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--field-gold-bright)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
              <UsersIcon size={10} />
              {contact.fh_clients.name}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', opacity: Number(contact.amount || 0) > 0 ? 1 : 0.4 }}>
          <div className="fh-money" style={{ fontFamily: 'var(--font-display)', fontSize: 20, lineHeight: 1 }}>
            {money(contact.amount)}
          </div>
        </div>
      </div>

      {/* Bottom row: stage badge + margin pill + stages count */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {stageMeta && (
          <span className={`fh-stage-pill fh-stage-pill--${contact.stage || 'lead'}`}>
            {stageMeta.label.toUpperCase()}
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
        {/* Pipeline position — was "3/5 stages" which read as "3 of 5
            milestones complete". This is the stage in the Lead -> Quote
            -> Job -> Invoice -> Closed flow, not a milestone count. */}
        <span style={{ fontSize: 10, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', fontWeight: 700, letterSpacing: '0.04em' }}>
          Stage {step}/{TOTAL_STAGES}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ position: 'relative', height: 3, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden' }}>
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
      <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 999, background: 'var(--surface-2)', border: '1px solid rgba(255,255,255,0.18)', color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.02em' }}>
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

function ActionTile({ icon: I, label, onClick, href, disabled, primary }) {
  const bg = primary
    ? 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))'
    : 'var(--surface-2)'
  const color = primary ? 'var(--onyx)' : disabled ? 'var(--ink-faint)' : 'var(--ink-strong)'
  const border = primary ? 'none' : '1px solid var(--rule)'
  const style = {
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
    boxShadow: primary ? '0 8px 20px rgba(201,150,58,0.35)' : 'none',
    textDecoration: 'none'
  }
  if (href && !disabled) {
    return (
      <motion.a
        href={href}
        whileTap={{ scale: 0.97 }}
        style={style}
      >
        <I size={18} />
        <span>{label}</span>
      </motion.a>
    )
  }
  return (
    <motion.button
      type="button"
      whileTap={disabled ? undefined : { scale: 0.97 }}
      onClick={onClick}
      disabled={disabled}
      style={style}
    >
      <I size={18} />
      <span>{label}</span>
    </motion.button>
  )
}

function EmptyView({ hasFilter, onAdd }) {
  if (hasFilter) {
    return (
      <div style={{ padding: '32px 20px', borderRadius: 14, background: 'var(--surface-2)', border: '1px dashed var(--rule)', textAlign: 'center', color: 'var(--ink-muted)', fontFamily: 'var(--font-body)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-strong)', marginBottom: 4 }}>No jobs match that filter.</div>
        <div style={{ fontSize: 12 }}>Clear the search or switch stages to see more.</div>
      </div>
    )
  }
  return (
    <div style={{ padding: '32px 20px', borderRadius: 14, background: 'var(--surface-2)', border: '1px dashed var(--rule)', textAlign: 'center', color: 'var(--ink-muted)', fontFamily: 'var(--font-body)' }}>
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
