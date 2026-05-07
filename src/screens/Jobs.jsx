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
import { JobCard, FilterPill, FloatingActionButton } from '../components/v3'
import DesktopJobsBoard from '../components/desktop/DesktopJobsBoard.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { ACTIVE_STAGES } from '../lib/stages.js'
import { hapticTap, hapticMedium } from '../lib/haptics.js'
import { toastSuccess } from '../lib/toast.js'
import { useFhMotion } from '../lib/motion.js'
import { useIsDesktop } from '../lib/useMediaQuery.js'
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
    // V3-PARTNERS: dropped the .eq('user_id', user.id) JS-layer filter so
    // partner-shared jobs surface in this list. RLS (fh_contacts owner +
    // fh_contacts_partner_read) is the enforcement layer; the JS filter
    // was excluding shared rows entirely. Owner sees the same set they
    // always did; partner now sees jobs owned by other contractors that
    // were shared with them via accepted fh_job_partners invites.
    const [contactsRes, photoMap] = await Promise.all([
      supabase
        .from('fh_contacts')
        .select('*, fh_clients(name)')
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

  // Phase 11 stabilization — Home priority cards deep-link via
  // ?stage=lead|quote|active|won. Apply the matching tab on mount and
  // strip the param so the URL stays clean. Unrecognized stages are
  // ignored. Empty stage param falls through to the default tab.
  useEffect(() => {
    const stage = searchParams.get('stage')
    if (!stage) return
    const validIds = TABS.map((t) => t.id)
    if (validIds.includes(stage)) setFilter(stage)
    searchParams.delete('stage')
    setSearchParams(searchParams, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // V3-JOBS-1 loading-state fix: while data is hydrating, return an
    // empty map so each FilterPill receives `count={undefined}` and
    // skips its count chip entirely — avoids the misleading
    // "0 lead 0 quote 0 active 0 won" first-paint state.
    if (loading) return {}
    const out = {}
    for (const t of TABS) out[t.id] = contacts.filter(t.match).length
    return out
  }, [contacts, loading])

  // Featured deal id — highest-value job in the currently filtered list.
  // Only applied when the filtered set has 2+ jobs (no point featuring
  // the only card on screen) and the top deal has a non-zero amount.
  const featuredId = useMemo(() => {
    if (filtered.length < 2) return null
    let topId = null
    let topAmount = 0
    for (const c of filtered) {
      const amt = Number(c.amount || 0)
      if (amt > topAmount) {
        topAmount = amt
        topId = c.id
      }
    }
    return topAmount > 0 ? topId : null
  }, [filtered])

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
  const isDesktop = useIsDesktop()

  // Phase 7 — desktop-first composition. At >=900px we render
  // DesktopJobsBoard (a real command-center board), passing the same
  // contacts / filters / handlers the mobile branch uses. Below 900px
  // the existing motion.div.v3-screen--jobs flow renders verbatim.
  if (isDesktop) {
    return (
      <>
        <DesktopJobsBoard
          contacts={contacts}
          filtered={filtered}
          loading={loading}
          filter={filter}
          setFilter={setFilter}
          search={search}
          setSearch={setSearch}
          photoUrlByJob={photoUrlByJob}
          featuredId={featuredId}
          tabCounts={tabCounts}
          onOpenJob={openDrawer}
          onNewLead={() => setAddOpen(true)}
        />
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
              Click outside to dismiss
            </div>
          </DrawerContent>
        </Drawer>
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
      </>
    )
  }

  return (
    <motion.div
      className="v3-screen v3-screen--jobs"
      variants={stagger}
      initial="hidden"
      animate="show"
      style={{ position: 'relative' }}
    >
      {/* HEADER — title + caption subline. Mockup uses a quiet
          "{count} active · ${total} total" caption rather than a
          display-font command bar; the count + total still surface,
          just in a calmer hierarchy that lets the cards lead. */}
      <motion.div className="fh-jobs__head" variants={item} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '12px 20px 8px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1
            style={{ margin: 0, fontSize: 'clamp(22px, 6vw, 30px)', lineHeight: 1.1, letterSpacing: '-0.015em', fontWeight: 600, color: 'var(--v3-text)' }}
          >
            Jobs & Pipeline
          </h1>
          <div className="v3-caption" style={{ marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
            {loading ? (
              // V3-JOBS-1: avoid the misleading "0 active" first-paint
              // state — show a quiet loading hint until data hydrates.
              <span>Loading…</span>
            ) : (
              <>
                <span style={{ color: 'var(--v3-text)', fontWeight: 600 }}>{summary.activeCount}</span>
                <span> active</span>
                {summary.pipeline > 0 && (
                  <>
                    <span style={{ margin: '0 6px', color: 'var(--v3-text-faint)' }}>·</span>
                    <span style={{ color: 'var(--v3-text)', fontWeight: 600 }}>{kFormat(summary.pipeline)}</span>
                    <span> total</span>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        {/* Desktop-only inline primary action. The FAB is hidden on
            desktop (it's a phone thumb-reach pattern), so the new-lead
            entry point lives here at >=900px. CSS keeps this hidden on
            mobile via display:none. */}
        <button
          type="button"
          className="fh-jobs__action fh-desktop-only-action"
          onClick={() => { hapticMedium(); setAddOpen(true) }}
          aria-label="New lead"
        >
          <Plus size={15} strokeWidth={2.4} />
          <span>New lead</span>
        </button>
      </motion.div>

      {/* SEARCH */}
      <motion.div className="fh-jobs__search" variants={item} style={{ padding: '12px 20px 10px' }}>
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
      <motion.div className="fh-jobs__tabs" variants={item} style={{ padding: '0 var(--v3-gutter) 14px' }}>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }} role="tablist">
          {TABS.map((t) => (
            <FilterPill
              key={t.id}
              active={filter === t.id}
              // V3-JOBS-1: pass undefined while loading so the count
              // chip is suppressed entirely (FilterPill renders the
              // chip only when `count != null`).
              count={tabCounts[t.id]}
              onClick={() => { hapticTap(); setFilter(t.id) }}
            >
              {t.label}
            </FilterPill>
          ))}
        </div>
      </motion.div>

      {/* LIST — auto-fit grid. Density bumped: minmax 300 → 260, gap 10 → 8.
          Net effect: 1 col on phone (≤520), 2 cols on tablet (520-820),
          3 cols on small desktop (820-1080), 4 cols on wide (≥1080).
          Was capping at 3 cols even on wide screens — left empty space. */}
      <motion.div className="fh-jobs__grid" variants={item} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', alignItems: 'stretch', gap: 8, padding: '0 var(--v3-gutter) 32px' }}>
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
                fg: 'var(--v3-success-bright)',
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
                  featured={c.id === featuredId}
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

      {/* FAB — bottom-right above BottomNav. Thumb-reach primary action
          on phone. Per ruleset: "Max 1 primary action per screen" — on
          desktop the inline .fh-jobs__action button takes that role and
          the FAB collapses via hideOnDesktop. Renders via the canonical
          portal-based primitive so it can't be trapped by a transformed
          ancestor. */}
      <FloatingActionButton
        onClick={() => setAddOpen(true)}
        ariaLabel="New lead"
        hideOnDesktop
      />
    </motion.div>
  )
}

/* ----------- helpers (small enough to live inline) ----------- */

function ActionTile({ icon: I, label, onClick, href, disabled, primary }) {
  const bg = primary
    ? 'var(--v3-primary)'
    : 'var(--v3-surface-2)'
  const color = primary ? 'var(--v3-on-primary)' : disabled ? 'var(--v3-text-muted)' : 'var(--v3-text)'
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
      <div className="v3-empty" style={{ gridColumn: '1 / -1' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
          No jobs match that filter.
        </div>
        <div style={{ fontSize: 12 }}>Clear the search or switch stages to see more.</div>
      </div>
    )
  }
  return (
    <div className="v3-empty" style={{ gridColumn: '1 / -1' }}>
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
