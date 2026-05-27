import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Search, MessageSquare, Mail, Phone, ExternalLink,
  Phone as PhoneIcon, MessageSquare as MsgIcon
} from 'lucide-react'
import NewLeadSheet from '../components/NewLeadSheet.tsx'
import { SkeletonList } from '../components/Skeleton.tsx'
import SwipeableRow from '../components/SwipeableRow.tsx'
import { JobCard, FilterPill, FloatingActionButton, ScreenCloser } from '../components/v3'
import SnowJobs from '../components/desktop/SnowJobsBuild.tsx'
import { useAuth } from '../contexts/AuthContext.tsx'
import { ACTIVE_STAGES } from '../lib/stages.ts'
import { hapticTap, hapticMedium } from '../lib/haptics.ts'
import { toastSuccess } from '../lib/toast.ts'
import { useFhMotion } from '../lib/motion.ts'
import { useIsDesktop } from '../lib/useMediaQuery.ts'
import { useJobs, useJobPhotos, useJobsRealtime, queryKeys } from '../lib/queries.ts'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'

// Tabs collapse 6 raw stages to 5 honest groupings.
//
// 5/13 audit flagged a labeling collision: the header summary showed
// "14 ACTIVE" (count of every contact in ACTIVE_STAGES = lead+quote+
// job+invoice) while a tab below it was also labeled "Active" but
// only matched stage='job' (7 rows). Same word, two definitions, and
// the operator couldn't reconcile the numbers. We renamed the tab to
// "Doing" so the words are honest: header "Active" means everything
// in the pipeline, tab "Doing" means stage='job' specifically (the
// pipeline-depth filter). The tab id ('active') is unchanged so the
// Phase 11 ?stage=active deep-link from Home still routes here.
const TABS = [
  { id: 'all',    label: 'All',    match: () => true },
  { id: 'lead',   label: 'Lead',   match: (c: any) => c.stage === 'lead' },
  { id: 'quote',  label: 'Quote',  match: (c: any) => c.stage === 'quote' },
  { id: 'active', label: 'Doing',  match: (c: any) => c.stage === 'job' },
  { id: 'won',    label: 'Complete', match: (c: any) => c.stage === 'invoice' || c.stage === 'closed' }
]

// "All" view groups the pipeline into labeled stage blocks so leads,
// quotes, jobs and invoices never interleave into one mixed pile. Order
// follows the pipeline; empty groups are dropped at render. Lost is shown
// last and only when present so it never clutters a healthy pipeline.
const STAGE_GROUPS = [
  { id: 'lead',    label: 'Leads',       match: (c: any) => c.stage === 'lead' },
  { id: 'quote',   label: 'Quotes',      match: (c: any) => c.stage === 'quote' },
  { id: 'job',     label: 'Active jobs', match: (c: any) => c.stage === 'job' },
  { id: 'invoice', label: 'Invoicing',   match: (c: any) => c.stage === 'invoice' },
  { id: 'closed',  label: 'Complete',    match: (c: any) => c.stage === 'closed' },
  { id: 'lost',    label: 'Lost',        match: (c: any) => c.stage === 'lost' }
]

function money(n: any) {
  const v = Number(n || 0)
  if (!v) return '$0'
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function kFormat(n: any) {
  const v = Number(n || 0)
  if (v >= 1000) return `$${(v / 1000).toFixed(0)}K`
  return money(v)
}

export default function Jobs() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  // TanStack Query replaces the old useState + load() + refreshTick
  // pattern. useJobs caches the contacts list; useJobPhotos signs cover
  // photos separately; useJobsRealtime invalidates on any fh_contacts
  // change so the list stays live without a manual counter.
  const { data: contacts = [], isLoading: loading } = useJobs()
  const { data: photoUrlByJob = {} } = useJobPhotos(user?.id)
  useJobsRealtime(user?.id, queryClient)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  // Initial stage for the New-Lead sheet. Defaults to 'lead'; flips to
  // 'job' when the entry point was the Home "New Job" quick action
  // (which passes ?asStage=job). Keeps the title + default chip honest.
  const [addInitialStage, setAddInitialStage] = useState('lead')
  const [justAddedId, setJustAddedId] = useState<any>(null)
  const [drawerContact, setDrawerContact] = useState<any>(null)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      // ?asStage=job|quote|lead seeds the sheet's default stage so the
      // Home "New Job" tile opens the sheet pre-configured for a job
      // instead of a lead. Whitelisted to known stage values; anything
      // else falls back to 'lead' (the original default).
      const requested = searchParams.get('asStage')
      const seed = requested === 'job' || requested === 'quote' || requested === 'lead'
        ? requested
        : 'lead'
      setAddInitialStage(seed)
      setAddOpen(true)
      searchParams.delete('new')
      searchParams.delete('asStage')
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
      .filter((c) => ACTIVE_STAGES.includes(c.stage as string))
      .reduce((s, c) => s + Number(c.amount || 0), 0)
    const activeCount = contacts.filter((c) => ACTIVE_STAGES.includes(c.stage as string)).length
    const totalCount = contacts.length
    // "Need eyes" — active-stage jobs with no update in 7+ days. Matches
    // the design's stats line ("X total · $Y in motion · Z need eyes") and
    // the audit's intuitive read of stale work that needs operator
    // attention. Excludes closed/lost since they're terminal.
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const needEyesCount = contacts.filter((c) => {
      if (!ACTIVE_STAGES.includes(c.stage as string)) return false
      const last = new Date(c.updated_at || c.created_at || 0).getTime()
      return Number.isFinite(last) && last < sevenDaysAgo
    }).length
    return { pipeline, activeCount, totalCount, needEyesCount }
  }, [contacts])

  const tabCounts = useMemo(() => {
    // V3-JOBS-1 loading-state fix: while data is hydrating, return an
    // empty map so each FilterPill receives `count={undefined}` and
    // skips its count chip entirely — avoids the misleading
    // "0 lead 0 quote 0 active 0 won" first-paint state.
    if (loading) return {} as Record<string, any>
    const out: Record<string, any> = {}
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

  // Grouped sections for the "All" view — split the (search-filtered)
  // pipeline into stage blocks. null for single-stage tabs, which keep
  // the flat grid since they're already one stage.
  const groups = useMemo(() => {
    if (filter !== 'all') return null
    return STAGE_GROUPS
      .map((g) => ({ id: g.id, label: g.label, items: filtered.filter(g.match) }))
      .filter((g) => g.items.length > 0)
  }, [filter, filtered])

  function openDrawer(contact: any) {
    setDrawerContact(contact)
  }

  function closeDrawer() {
    setDrawerContact(null)
  }

  function onDrawerOpenChange(next: any) {
    if (!next) closeDrawer()
  }

  // Single card renderer — shared by the grouped "All" view and the
  // flat single-stage view so swipe actions + JobCard props stay in sync.
  function renderCard(c: any, i: number) {
    const rowPhone = c.phone || c.fh_clients?.phone || ''
    const swipeActions: any[] = []
    if (rowPhone) {
      swipeActions.push({
        icon: <PhoneIcon size={18} />,
        label: `Call ${c.name || 'contact'}`,
        color: 'rgba(46, 204, 113, 0.22)',
        fg: 'var(--v3-success-bright)',
        onClick: () => { window.location.href = `tel:${rowPhone}` }
      })
      swipeActions.push({
        icon: <MsgIcon size={18} />,
        label: `Text ${c.name || 'contact'}`,
        color: 'rgba(212, 175, 55, 0.18)',
        fg: 'var(--v3-primary)',
        onClick: () => { window.location.href = `sms:${rowPhone}` }
      })
    }
    return (
      <SwipeableRow key={c.id} actions={swipeActions} disabled={!rowPhone}>
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
  }

  // Effective contact info for the tile-peek action sheet. The job row
  // (fh_contacts) often has no phone/email of its own — those live on
  // the linked fh_clients row. Falling back to client info means the
  // operator can Call / Text / Email even when the job is bare.
  const peekPhone = drawerContact?.phone || drawerContact?.fh_clients?.phone || ''
  const peekEmail = drawerContact?.email || drawerContact?.fh_clients?.email || ''

  const { stagger, item } = useFhMotion()
  const isDesktop = useIsDesktop()

  // Phase 7 — desktop-first composition. At >=900px we render
  // DesktopJobsBoard (a real command-center board), passing the same
  // contacts / filters / handlers the mobile branch uses. Below 900px
  // the existing motion.div.v3-screen--jobs flow renders verbatim.
  if (isDesktop) {
    return (
      <>
        <SnowJobs
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
          // Desktop row click + chevron route directly to the job
          // file. The contact bottom-sheet (with Text/Email/Call/Open)
          // is still mounted below and used by the mobile flow; on
          // desktop we skip it so the chevron lives up to its
          // implied affordance.
          onOpenJob={(id: any) => { if (id) navigate(`/jobs/${id}`) }}
          onNewLead={() => setAddOpen(true)}
        />
        <Drawer open={!!drawerContact} onOpenChange={onDrawerOpenChange}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{drawerContact?.name || 'Contact'}</DrawerTitle>
              <DrawerDescription>
                {(drawerContact?.job_title || drawerContact?.job_type) && (
                  <>{drawerContact.job_title || drawerContact.job_type}{' · '}</>
                )}
                {money(drawerContact?.amount || 0)}
              </DrawerDescription>
            </DrawerHeader>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '8px 20px 8px' }}>
              <ActionTile
                icon={MessageSquare}
                label="Text"
                disabled={!peekPhone}
                href={peekPhone ? `sms:${peekPhone}` : undefined}
              />
              <ActionTile
                icon={Mail}
                label="Email"
                disabled={!peekEmail}
                href={peekEmail ? `mailto:${peekEmail}` : undefined}
              />
              <ActionTile
                icon={Phone}
                label="Call"
                disabled={!peekPhone}
                href={peekPhone ? `tel:${peekPhone}` : undefined}
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
          initialStage={addInitialStage}
          onClose={() => setAddOpen(false)}
          onCreated={async (created: any) => {
            setAddOpen(false)
            if (created?.id) setJustAddedId(created.id)
            await queryClient.invalidateQueries({ queryKey: queryKeys.jobs })
            setTimeout(() => setJustAddedId(null), 1200)
            const noun = created?.stage === 'job' ? 'job' : created?.stage === 'quote' ? 'quote' : 'lead'
            toastSuccess(
              `New ${noun} added`,
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
      {/* HEADER — design handoff (5/17) pattern:
            <h1.jobs-title>Jobs <span gold>& Pipeline</span></h1>
            <div.jobs-stats>
              <b.stamp>N</b> total · <b.stamp>$X</b> in motion ·
              <span.alert><b.stamp>N</b> need eyes</span>
            </div>
          The gold accent on "& Pipeline" matches the design's
          color="var(--gold-bright)" span. Stats use .stamp (Bebas Neue
          + tabular-nums) for every number. "Need eyes" only renders
          when there's actually stale work — keeps the row clean when
          the operator is on top of things. */}
      <motion.div className="fh-jobs__head" variants={item} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '12px 20px 8px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 className="jobs-title">
            Jobs{' '}
            <span style={{ color: 'var(--v3-primary-bright)' }}>& Pipeline</span>
          </h1>
          <div className="jobs-stats">
            {loading ? (
              // V3-JOBS-1: avoid the misleading "0 active" first-paint
              // state — show a quiet loading hint until data hydrates.
              <span style={{ color: 'var(--v3-text-muted)' }}>Loading…</span>
            ) : (
              <>
                <span><b>{summary.totalCount}</b> total</span>
                {summary.pipeline > 0 && (
                  <>
                    <span className="dot-sep">·</span>
                    <span><b>{kFormat(summary.pipeline)}</b> in motion</span>
                  </>
                )}
                {summary.needEyesCount > 0 && (
                  <>
                    <span className="dot-sep">·</span>
                    <span className="jobs-stats__alert"><b>{summary.needEyesCount}</b> need eyes</span>
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
      {loading && (
        <motion.div className="fh-jobs__grid" variants={item} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', alignItems: 'stretch', gap: 8, padding: '0 var(--v3-gutter) 32px' }}>
          <SkeletonList rows={5} />
        </motion.div>
      )}

      {!loading && filtered.length === 0 && (
        <motion.div className="fh-jobs__grid" variants={item} style={{ padding: '0 var(--v3-gutter) 32px' }}>
          <EmptyView
            hasFilter={filter !== 'all' || !!search}
            onAdd={() => setAddOpen(true)}
          />
        </motion.div>
      )}

      {/* GROUPED — "All" view splits into labeled stage blocks so leads,
          quotes, jobs and invoices never interleave. */}
      {!loading && filtered.length > 0 && groups && (
        <motion.div variants={item} style={{ display: 'flex', flexDirection: 'column', gap: 22, padding: '0 var(--v3-gutter) 32px' }}>
          {groups.map((g) => (
            <section key={g.id}>
              <SectionHeader label={g.label} count={g.items.length} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', alignItems: 'stretch', gap: 8, marginTop: 8 }}>
                <AnimatePresence>
                  {g.items.map((c, i) => renderCard(c, i))}
                </AnimatePresence>
              </div>
            </section>
          ))}
        </motion.div>
      )}

      {/* FLAT — single-stage tab is already one stage, so no headers. */}
      {!loading && filtered.length > 0 && !groups && (
        <motion.div className="fh-jobs__grid" variants={item} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', alignItems: 'stretch', gap: 8, padding: '0 var(--v3-gutter) 32px' }}>
          <AnimatePresence>
            {filtered.map((c, i) => renderCard(c, i))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* VAUL DRAWER — quick actions */}
      <Drawer open={!!drawerContact} onOpenChange={onDrawerOpenChange}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{drawerContact?.name || 'Contact'}</DrawerTitle>
            <DrawerDescription>
              {(drawerContact?.job_title || drawerContact?.job_type) && (
                <>{drawerContact.job_title || drawerContact.job_type}{' · '}</>
              )}
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
        initialStage={addInitialStage}
        onClose={() => setAddOpen(false)}
        onCreated={async (created: any) => {
          setAddOpen(false)
          if (created?.id) setJustAddedId(created.id)
          await queryClient.invalidateQueries({ queryKey: queryKeys.jobs })
          setTimeout(() => setJustAddedId(null), 1200)
          const noun = created?.stage === 'job' ? 'job' : created?.stage === 'quote' ? 'quote' : 'lead'
          toastSuccess(
            `New ${noun} added`,
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

      <ScreenCloser
        caption={`${filtered.length} ${filtered.length === 1 ? 'job' : 'jobs'} in this view.`}
      />
    </motion.div>
  )
}

/* ----------- helpers (small enough to live inline) ----------- */

function ActionTile({ icon: I, label, onClick, href, disabled, primary }: any) {
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

function SectionHeader({ label, count }: any) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{
        fontFamily: 'var(--font-body)',
        fontSize: 11, fontWeight: 700,
        letterSpacing: '0.16em', textTransform: 'uppercase',
        color: 'var(--v3-text-muted)'
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: 'var(--font-body)',
        fontSize: 11, fontWeight: 700,
        color: 'var(--v3-text-faint, var(--v3-text-muted))',
        fontVariantNumeric: 'tabular-nums'
      }}>
        {count}
      </span>
    </div>
  )
}

function EmptyView({ hasFilter, onAdd }: any) {
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
