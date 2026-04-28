import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Search, MessageSquare, Mail, Phone, ExternalLink,
  Phone as PhoneIcon, MessageSquare as MsgIcon
} from 'lucide-react'
import NewLeadSheet from '../components/NewLeadSheet.jsx'
import { SkeletonList } from '../components/Skeleton.jsx'
import SwipeableRow from '../components/SwipeableRow.jsx'
import { JobCard } from '../components/v3'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { ACTIVE_STAGES } from '../lib/stages.js'
import { hapticTap, hapticMedium } from '../lib/haptics.js'
import { toastSuccess } from '../lib/toast.js'
import { useFhMotion } from '../lib/motion.js'
import { fetchCoverPhotosByJob } from '../lib/photos.js'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'

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

export default function Jobs() {
  const { user } = useAuth()
  const [contacts, setContacts] = useState([])
  const [refreshTick, setRefreshTick] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [justAddedId, setJustAddedId] = useState(null)
  const [drawerContact, setDrawerContact] = useState(null)
  // Cover photos by job_id. Populated alongside contacts; ONE batch query
  // + ONE batch signed-URL call (see lib/photos.js). Empty map = fall back
  // to JobCard's stage-tinted initial tile.
  const [photoUrlByJob, setPhotoUrlByJob] = useState({})
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    // Run contacts + cover-photos in parallel. Photos failure is non-fatal
    // (we just keep the existing photo map / fall back to initials).
    const [contactsRes, photoMap] = await Promise.all([
      supabase
        .from('fh_contacts')
        .select('*, fh_clients(name)')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false }),
      fetchCoverPhotosByJob(user.id).catch(() => ({}))
    ])
    if (!contactsRes.error) setContacts(contactsRes.data || [])
    setPhotoUrlByJob(photoMap || {})
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

  const { stagger, item } = useFhMotion()

  return (
    <motion.div
      className="v3-screen"
      variants={stagger}
      initial="hidden"
      animate="show"
      style={{ position: 'relative' }}
    >
      {/* HEADER — pipeline command bar. Numerics promoted: active count
          and total $ now render as Bebas Neue display sizes (28/22) so
          the operator's eye lands on the WORK STATE, not the title. */}
      <motion.div variants={item} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '12px 20px 8px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1
            className="v3-h1"
            style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(24px, 6vw, 32px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400 }}
          >
            Jobs &{' '}
            <em style={{ fontStyle: 'italic', color: 'var(--v3-primary)' }}>Pipeline</em>
          </h1>
          {/* Command bar — large numerics, muted labels. The operator
              scans the numbers, not the words. */}
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 18, fontFamily: 'var(--font-body)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: 26, lineHeight: 1, letterSpacing: '0.02em',
                color: 'var(--v3-primary)',
                fontVariantNumeric: 'tabular-nums'
              }}>
                {summary.activeCount}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--v3-text-muted)' }}>
                Active
              </span>
            </div>
            {summary.pipeline > 0 && (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 22, lineHeight: 1, letterSpacing: '0.02em',
                  color: 'var(--v3-text)',
                  fontVariantNumeric: 'tabular-nums'
                }}>
                  {kFormat(summary.pipeline)}
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--v3-text-muted)' }}>
                  Total
                </span>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* SEARCH */}
      <motion.div variants={item} style={{ padding: '12px 20px 10px' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={16} style={{ position: 'absolute', left: 14, color: 'var(--v3-text-muted)', pointerEvents: 'none' }} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search jobs, contacts, numbers…"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '12px 14px 12px 40px',
              borderRadius: 12,
              background: 'var(--v3-surface)',
              border: '1px solid var(--v3-border)',
              color: 'var(--v3-text)',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              outline: 'none'
            }}
          />
        </div>
      </motion.div>

      {/* STAGE TABS — horizontal scroll on overflow */}
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
                onClick={() => { hapticTap(); setFilter(t.id) }}
                style={{
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  borderRadius: 999,
                  border: isActive
                    ? '1px solid color-mix(in srgb, var(--v3-primary) 45%, transparent)'
                    : '1px solid var(--v3-border)',
                  background: isActive
                    ? 'var(--v3-primary-soft)'
                    : 'transparent',
                  color: isActive ? 'var(--v3-primary)' : 'var(--v3-text-muted)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                  transition: 'background-color 160ms ease, border-color 160ms ease, color 160ms ease'
                }}
              >
                {t.label}
                <span style={{ fontSize: 10, opacity: 0.85, fontVariantNumeric: 'tabular-nums' }}>
                  {tabCounts[t.id] ?? 0}
                </span>
              </button>
            )
          })}
        </div>
      </motion.div>

      {/* LIST — auto-fit grid. Density bumped: minmax 300 → 260, gap 10 → 8.
          Net effect: 1 col on phone (≤520), 2 cols on tablet (520-820),
          3 cols on small desktop (820-1080), 4 cols on wide (≥1080).
          Was capping at 3 cols even on wide screens — left empty space. */}
      <motion.div variants={item} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', alignItems: 'stretch', gap: 8, padding: '0 20px 32px' }}>
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
                color: 'rgba(46, 204, 113, 0.22)',
                fg: '#4ADE80',
                onClick: () => { window.location.href = `tel:${c.phone}` }
              })
              swipeActions.push({
                icon: <MsgIcon size={18} />,
                label: `Text ${c.name || 'contact'}`,
                color: 'rgba(212, 175, 55, 0.18)',
                fg: 'var(--v3-primary)',
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
                  photoUrl={photoUrlByJob[c.id]}
                  onOpen={openDrawer}
                />
              </SwipeableRow>
            )
          })}
        </AnimatePresence>
      </motion.div>

      {/* VAUL DRAWER — quick actions */}
      <Drawer open={!!drawerContact} onOpenChange={onDrawerOpenChange}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{drawerContact?.name || 'Contact'}</DrawerTitle>
            <DrawerDescription>
              {drawerContact?.job_title || drawerContact?.job_type || 'No job title'}
              {' · '}
              {money(drawerContact?.amount || 0)}
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
          <div style={{ padding: '14px 20px 28px', color: 'var(--v3-text-muted)', fontSize: 11, fontFamily: 'var(--font-body)', textAlign: 'center' }}>
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
            created?.name ? `${created.name} is in your Pipeline` : 'In your Pipeline'
          )
        }}
      />

      {/* FAB — bottom-right above BottomNav. Thumb-reach primary action.
          Per ruleset: "Max 1 primary action per screen" — this is it. */}
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

/* ----------- helpers (small enough to live inline) ----------- */

function ActionTile({ icon: I, label, onClick, href, disabled, primary }) {
  const bg = primary
    ? 'var(--v3-primary)'
    : 'var(--v3-surface-2)'
  const color = primary ? '#0B0B0D' : disabled ? 'var(--v3-text-muted)' : 'var(--v3-text)'
  const border = primary ? 'none' : '1px solid var(--v3-border)'
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
    fontFamily: 'var(--font-body)',
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: primary ? '0.04em' : '0',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    boxShadow: primary ? '0 8px 22px rgba(212, 175, 55, 0.32)' : 'none',
    textDecoration: 'none',
    WebkitTapHighlightColor: 'transparent'
  }
  if (href && !disabled) {
    // Plain <a> — framer-motion + Vaul drawer was eating clicks on iOS Safari.
    // Fallback setTimeout ensures the deep link fires even when href default
    // gets suppressed by the drawer.
    return (
      <a
        href={href}
        rel="noopener"
        onClick={(e) => {
          e.stopPropagation()
          if (typeof window !== 'undefined') {
            setTimeout(() => { window.location.href = href }, 0)
          }
        }}
        style={style}
      >
        <I size={18} />
        <span>{label}</span>
      </a>
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
      <div style={{
        gridColumn: '1 / -1',
        padding: '32px 20px',
        borderRadius: 14,
        background: 'var(--v3-surface)',
        border: '1px dashed var(--v3-border-strong)',
        textAlign: 'center',
        color: 'var(--v3-text-muted)',
        fontFamily: 'var(--font-body)'
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
          No jobs match that filter.
        </div>
        <div style={{ fontSize: 12 }}>Clear the search or switch stages to see more.</div>
      </div>
    )
  }
  return (
    <div style={{
      gridColumn: '1 / -1',
      padding: '32px 20px',
      borderRadius: 14,
      background: 'var(--v3-surface)',
      border: '1px dashed var(--v3-border-strong)',
      textAlign: 'center',
      color: 'var(--v3-text-muted)',
      fontFamily: 'var(--font-body)'
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
        No jobs on the board.
      </div>
      <div style={{ fontSize: 12, marginBottom: 10 }}>
        Drop in your first lead. Watch the Pipeline fill.
      </div>
      <button
        type="button"
        onClick={onAdd}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          color: 'var(--v3-primary)',
          fontWeight: 700,
          fontSize: 12,
          cursor: 'pointer'
        }}
      >
        Add first lead →
      </button>
    </div>
  )
}
