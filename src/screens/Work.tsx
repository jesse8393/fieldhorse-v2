// src/screens/Work.tsx, THE list. (IA collapse, round 2)
//
// User verdict on the four-desk model: "Jobs leads quotes invoices…
// it all sucks and is too complicated. Still is too much."
// They were right. A deal is ONE thing that moves lead → quote →
// active → paid → done; splitting it across Leads / Quotes / Jobs /
// Pipeline boards (each with its own layout, card design, and cockpit
// panels) forced the operator to learn four screens for one object.
//
// This screen replaces all four:
//   - one search bar
//   - one row of stage chips (All · Leads · Quotes · Active · Done,
//     Lost only when it exists)
//   - ONE card design for every deal, spine + name + title + $ +
//     stage pill + follow-up chip when due + one ⋯ menu
//   - tap a card → the stage-aware detail, where the single big CTA
//     already lives (Convert to quote / Approve / Send invoice)
//
// /leads, /quotes, /jobs, /pipeline all redirect here (App.tsx keeps
// the mapping so old links and habits still land correctly).

import { lazy, Suspense, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Phone as PhoneIcon, MessageSquare as MsgIcon, Sparkles,
  CalendarClock, CalendarDays, Trophy, XCircle, MoreHorizontal, RotateCcw
} from 'lucide-react'
import SwipeableRow from '../components/SwipeableRow.tsx'
import { SkeletonList } from '../components/Skeleton.tsx'
import DataErrorState from '../components/DataErrorState.tsx'
import { FilterPill, FloatingActionButton, ScreenCloser, StatusPill } from '../components/v3'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
// Lazy, react-day-picker (~tens of KB) only loads when someone opens the
// follow-up date picker. Work is the hot list route (its chunk is warmed
// on sidebar hover for 5 paths), so keep the calendar off the critical path.
const Calendar = lazy(() => import('@/components/ui/calendar').then((m) => ({ default: m.Calendar })))
import { useAuth } from '../contexts/AuthContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { supabase } from '../lib/supabase.ts'
import { markWon, markLost, reopen } from '../lib/pipeline.ts'
import { detailRoute, LIST_STAGE_META as STAGE_META } from '../lib/stages.ts'
import { moneyK as money } from '../lib/format.ts'
import { prefetchJobDetail } from './ContactDetail/hooks/useJobData.ts'
import { useInfiniteRender } from '../lib/useInfiniteRender.ts'
import { hapticTap, hapticMedium } from '../lib/haptics.ts'
import { toastSuccess, toastError } from '../lib/toast.ts'
import { useFhMotion } from '../lib/motion.ts'
import { canHover } from '../lib/hover.ts'
import { useJobs, useJobsRealtime, useJobSearch, jobsKey, type JobRow } from '../lib/queries.ts'

const NewLeadSheet = lazy(() => import('../components/NewLeadSheet.tsx'))

type ChipId = 'all' | 'leads' | 'quotes' | 'active' | 'done' | 'lost'

const CHIPS: { id: ChipId; label: string; match: (c: JobRow) => boolean }[] = [
  // 'All' really means all: it used to exclude lost, so its count (26)
  // never matched the sum of the stage chips (28), flagged by the UI
  // audit (#11) as "data does not agree with itself".
  { id: 'all',    label: 'All',    match: () => true },
  { id: 'leads',  label: 'Leads',  match: (c) => c.stage === 'lead' },
  { id: 'quotes', label: 'Quotes', match: (c) => c.stage === 'quote' },
  { id: 'active', label: 'Active', match: (c) => c.stage === 'job' || c.stage === 'invoice' },
  { id: 'done',   label: 'Done',   match: (c) => c.stage === 'closed' },
  { id: 'lost',   label: 'Lost',   match: (c) => c.stage === 'lost' }
]


function followUpMeta(c: Pick<JobRow, 'follow_up_on'>): { label: string; tone: 'danger' | 'warn' | 'muted' } | null {
  if (!c.follow_up_on) return null
  const due = new Date(c.follow_up_on + 'T00:00:00')
  if (Number.isNaN(due.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000)
  if (diffDays < 0) return { label: `Follow up ${-diffDays}d overdue`, tone: 'danger' }
  if (diffDays === 0) return { label: 'Follow up today', tone: 'warn' }
  if (diffDays === 1) return { label: 'Follow up tomorrow', tone: 'muted' }
  return { label: `Follow up ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`, tone: 'muted' }
}

// Detail route per stage, canonical mapping imported from stages.ts.

export default function Work() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: contacts = [], isLoading: loading, isError, error, refetch, isFetching } = useJobs()
  useJobsRealtime(user?.id, queryClient)
  // Role gate: the revenue stages (leads, quotes) and the sell actions
  // (Mark won/lost) belong to the money roles. Crew/foreman previously
  // couldn't reach /leads or /quotes at all; now that everything funnels
  // through /work, gate those surfaces in-view instead, they see only
  // the active/done work they're actually on, with no deal $ or pipeline
  // moves. Fail CLOSED while membership resolves: the list hydrates
  // instantly from IDB cache, so defaulting to money-visible would flash
  // '$ in play', Leads/Quotes rows, and dollar amounts to a crew member
  // on every cold open until membership resolved. Owners simply see the
  // money view a beat later, the correct trade.
  const { canCreateFinancialDocs, loading: membershipLoading } = useMembership()
  const isMoneyRole = !membershipLoading && canCreateFinancialDocs
  const [searchParams, setSearchParams] = useSearchParams()
  const [chip, setChip] = useState<ChipId>('all')
  const [search, setSearch] = useState('')
  // Server-side search: the cached list holds the 2000 most-recent deals;
  // typing also queries the whole book (debounced) and the hits merge in
  // below, so an operator can find a deal from years back by name.
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])
  const { data: serverHits = [], isError: searchDegraded } = useJobSearch(debouncedSearch)
  const [addOpen, setAddOpen] = useState(false)
  const [addStage, setAddStage] = useState<'lead' | 'quote' | 'job'>('lead')
  const [justAddedId, setJustAddedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const loadError = isError
    ? error instanceof Error ? error.message : 'The work list failed to load.'
    : ''

  // Deep links: ?stage=<chip> selects a chip; ?new=1 opens the create
  // sheet (optionally ?asStage=job from Home's "New Job" tile).
  // ?stage stays IN the URL so the active filter survives refresh and
  // is shareable/bookmarkable (UI audit #30), only the one-shot
  // new/asStage params are consumed.
  useEffect(() => {
    const requested = searchParams.get('stage')
    const wantsNew = searchParams.get('new') === '1'
    const asStage = searchParams.get('asStage')
    if (requested && CHIPS.some((c) => c.id === requested)) setChip(requested as ChipId)
    if (!requested) setChip('all')
    if (wantsNew) {
      setAddStage(asStage === 'job' ? 'job' : asStage === 'quote' ? 'quote' : 'lead')
      setAddOpen(true)
      const sp = new URLSearchParams(searchParams)
      sp.delete('new'); sp.delete('asStage')
      setSearchParams(sp, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // Chip clicks write the URL; the effect above syncs state from it.
  const selectChip = (id: ChipId) => {
    const sp = new URLSearchParams(searchParams)
    if (id === 'all') sp.delete('stage')
    else sp.set('stage', id)
    setSearchParams(sp, { replace: true })
    setChip(id)
  }

  // Money roles see the full lifecycle; field roles see only the work
  // they're on (Active/Done). 'all' stays for both but, for field roles,
  // its match excludes leads/quotes below.
  const visibleChips = useMemo(
    () => isMoneyRole ? CHIPS : CHIPS.filter((c) => c.id === 'all' || c.id === 'active' || c.id === 'done'),
    [isMoneyRole]
  )
  // For a field role, if the URL/deep-link left them on a now-hidden chip,
  // fall back to 'all'.
  const effectiveChip: ChipId = visibleChips.some((c) => c.id === chip) ? chip : 'all'
  const baseChip = CHIPS.find((c) => c.id === effectiveChip) || CHIPS[0]
  // Field roles never see lead/quote rows, even under the All chip.
  const activeChip = isMoneyRole
    ? baseChip
    : { ...baseChip, match: (c: JobRow) => baseChip.match(c) && c.stage !== 'lead' && c.stage !== 'quote' }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    // Local (cached) rows: filter the recent window by a naive substring.
    let localRows = contacts.filter(activeChip.match)
    if (q) {
      localRows = localRows.filter((c) =>
        [c.name, c.phone, c.email, c.address, c.referred_by, c.job_type, c.job_title]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q))
      )
    }
    // Server hits already matched the WHOLE book via a wildcard ilike that
    // normalizes punctuation ('615-555-1234' ~ '(615) 555-1234'). Do NOT
    // re-run a raw .includes() over them, that discarded exactly the
    // punctuation-normalized hits the server search found. Union them in
    // applying only the chip filter + dedupe. Dedupe against the rows
    // we're KEEPING, so a cached row the naive filter dropped but the
    // server matched is recovered via its server-hit twin.
    let rows = localRows
    if (q && serverHits.length) {
      const seen = new Set(localRows.map((c) => c.id))
      const extra = serverHits.filter((h) => !seen.has(h.id) && activeChip.match(h))
      rows = localRows.concat(extra)
    }
    // Follow ups due float to the top; inside each band, newest first.
    // Decorate-sort-undecorate: parse each row's dates ONCE (O(n)) instead
    // of up to 4× per comparison (O(n log n) parses), matters on long lists.
    const decorated = rows.map((c) => ({
      c,
      fu: c.follow_up_on ? new Date(c.follow_up_on).getTime() : Infinity,
      up: new Date(c.updated_at || c.created_at || 0).getTime()
    }))
    decorated.sort((a, b) => (a.fu !== b.fu ? a.fu - b.fu : b.up - a.up))
    return decorated.map((d) => d.c)
  }, [contacts, serverHits, activeChip, search])

  const { visible, sentinelRef, hasMore } = useInfiniteRender(filtered, `${effectiveChip}|${search}`)

  const chipCounts = useMemo<Partial<Record<ChipId, number>>>(() => {
    if (loading) return {}
    const out: Partial<Record<ChipId, number>> = {}
    for (const c of visibleChips) {
      // Field roles never count lead/quote rows, even under 'all'.
      out[c.id] = contacts.filter((row) =>
        c.match(row) && (isMoneyRole || (row.stage !== 'lead' && row.stage !== 'quote'))
      ).length
    }
    return out
  }, [contacts, loading, visibleChips, isMoneyRole])

  const summary = useMemo(() => {
    // Field roles: count only the active work they can see, and never
    // surface deal dollar amounts.
    const openStages = isMoneyRole ? ['lead', 'quote', 'job', 'invoice'] : ['job', 'invoice']
    const open = contacts.filter((c) => openStages.includes(c.stage || ''))
    const inPlay = isMoneyRole ? open.reduce((s, c) => s + Number(c.amount || 0), 0) : 0
    const due = open.filter((c) => {
      const m = followUpMeta(c)
      return m && (m.tone === 'danger' || m.tone === 'warn')
    }).length
    return { open: open.length, inPlay, due }
  }, [contacts, isMoneyRole])

  // Guards concurrent stage moves without making `run` depend on the
  // busyId state (which would re-create every per-row handler on each
  // busy toggle and defeat DealCard's memoization). busyId state stays
  // for the `busy` render prop only.
  const busyRef = useRef(false)

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: jobsKey(user?.id) })
  }, [queryClient, user?.id])

  // Optimistic single-column moves, the card responds the instant the
  // thumb lifts; refresh() reconciles (and rolls back on error).
  const patchJobsCache = useCallback((id: string, patch: Partial<JobRow>) => {
    queryClient.setQueryData(jobsKey(user?.id), (prev: unknown) =>
      Array.isArray(prev) ? prev.map((r: any) => (r.id === id ? { ...r, ...patch } : r)) : prev
    )
  }, [queryClient, user?.id])

  const run = useCallback(async (c: JobRow, fn: (c: JobRow) => Promise<any>, optimistic: Partial<JobRow> | null, failMsg: string, after?: () => void) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusyId(c.id)
    if (optimistic) patchJobsCache(c.id, optimistic)
    try {
      const res: any = await fn(c)
      if (res?.error) throw res.error
      await refresh()
      after?.()
    } catch (e: any) {
      toastError(failMsg, e?.message || 'Try again')
      await refresh()
    } finally {
      busyRef.current = false
      setBusyId(null)
    }
  }, [patchJobsCache, refresh])

  // Accepts a preset offset in days, an exact Date from the calendar
  // picker, or null to clear.
  const setFollowUp = useCallback(async (c: JobRow, when: number | Date | null) => {
    // Format a Date to a LOCAL year month day. toISOString would render the
    // UTC day, shifting the stored date for anyone not on UTC, which
    // made "Follow up tomorrow" land two days out for evening US users.
    const localYmd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    let value: string | null
    if (when === null) {
      value = null
    } else if (when instanceof Date) {
      value = localYmd(when)
    } else {
      // Preset offset: add the days to LOCAL midnight, then format local :
      // so the result is always exactly `when` calendar days from today.
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() + when)
      value = localYmd(d)
    }
    patchJobsCache(c.id, { follow_up_on: value } as Partial<JobRow>)
    toastSuccess(value ? 'Follow up set' : 'Follow up cleared', value ? `${c.name || 'Deal'} · ${followUpMeta({ follow_up_on: value })?.label || value}` : '')
    const { error } = await supabase
      .from('fh_contacts')
      .update({ follow_up_on: value })
      .eq('id', c.id)
      .eq('user_id', c.user_id)
    if (error) {
      toastError("Couldn't set follow up", error.message)
    }
    await refresh()
  }, [patchJobsCache, refresh])

  // Stable per-row handlers (take the contact as an arg instead of
  // closing over it inline) so DealCard's props keep referential identity
  // across search keystrokes and React.memo can skip re-rendering the ~40
  // mounted cards.
  const handleOpen = useCallback((c: JobRow) => navigate(detailRoute(c)), [navigate])
  const handleHover = useCallback((c: JobRow) => { if (canHover) prefetchJobDetail(queryClient, c.id, user?.id) }, [queryClient, user?.id])
  const handleWon = useCallback((c: JobRow) => {
    if (c.proposal_status === 'changes_requested') {
      toastError('Review changes first', 'Send the revised quote before marking it won.')
      navigate(`/quotes/${c.id}?tab=quote`)
      return
    }
    run(c, markWon, null, "Couldn't mark won", () => navigate(`/jobs/${c.id}`))
  }, [run, navigate])
  const handleLost = useCallback((c: JobRow) => run(c, markLost, { stage: 'lost' } as Partial<JobRow>, "Couldn't mark lost"), [run])
  const handleReopen = useCallback((c: JobRow) => run(c, reopen, { stage: c.stage === 'closed' ? 'job' : 'lead' } as Partial<JobRow>, "Couldn't reopen"), [run])
  const handleFollowUp = useCallback((c: JobRow, when: number | Date | null) => setFollowUp(c, when), [setFollowUp])

  const { stagger, item } = useFhMotion()
  const lostCount = Number(chipCounts.lost || 0)

  return (
    <motion.div
      className="v3-screen v3-screen--work"
      variants={stagger}
      initial="hidden"
      animate="show"
      style={{ position: 'relative', paddingBottom: 'calc(76px + env(safe-area-inset-bottom, 0px))' }}
    >
      {/* HEADER, one title, one honest stat line. No cockpit panels:
          Home already owns "what should I do next"; this screen's job
          is the list. */}
      <motion.div className="fh-work__head" variants={item} style={{ padding: '12px 24px 8px' }}>
        <h1 className="jobs-title">
          Work <span style={{ color: 'var(--v3-primary-bright)' }}>&amp; Deals</span>
        </h1>
        <div className="jobs-stats">
          {loading ? (
            <span style={{ color: 'var(--v3-text-muted)' }}>Loading…</span>
          ) : (
            <>
              <span><b>{summary.open}</b> open</span>
              {summary.inPlay > 0 && (
                <>
                  <span className="dot-sep">·</span>
                  <span><b>{money(summary.inPlay)}</b> in play</span>
                </>
              )}
              {summary.due > 0 && (
                <>
                  <span className="dot-sep">·</span>
                  <span className="jobs-stats__alert"><b>{summary.due}</b> need a follow up</span>
                </>
              )}
            </>
          )}
        </div>
      </motion.div>

      {/* SEARCH */}
      <motion.div className="fh-work__search" variants={item} style={{ padding: '12px 24px 12px' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={16} style={{ position: 'absolute', left: 14, color: 'var(--v3-text-muted)', pointerEvents: 'none' }} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search work"
            autoComplete="off"
            placeholder="Search names, numbers, addresses..."
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '12px 12px 12px 32px', borderRadius: 10,
              background: 'var(--v3-surface)', border: '1px solid var(--v3-border)',
              color: 'var(--v3-text)', fontFamily: 'var(--font-body)', fontSize: 14,
              outline: 'none'
            }}
          />
        </div>
        {/* Whole-book search failed (offline / server error): results
            below are the cached recent window only, say so instead of
            letting old deals silently look deleted. */}
        {searchDegraded && search.trim().length >= 2 && (
          <div role="status" style={{
            marginTop: 6, fontSize: 12, fontFamily: 'var(--font-body)',
            color: 'var(--v3-primary)', display: 'flex', alignItems: 'center', gap: 8
          }}>
            <Sparkles size={11} aria-hidden="true" />
            Showing recent deals only, full history search is unreachable right now.
          </div>
        )}
      </motion.div>

      {/* STAGE CHIPS, the whole pipeline in one row. */}
      <motion.div className="fh-work__chips" variants={item} style={{ padding: '0 var(--v3-gutter) 12px' }}>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }} role="tablist" aria-label="Stage filters">
          {visibleChips.filter((c) => c.id !== 'lost' || lostCount > 0).map((c) => (
            <FilterPill
              key={c.id}
              active={effectiveChip === c.id}
              count={chipCounts[c.id]}
              ariaLabel={`Show ${c.label.toLowerCase()}`}
              onClick={() => { hapticTap(); selectChip(c.id) }}
            >
              {c.label}
            </FilterPill>
          ))}
        </div>
      </motion.div>

      {/* LIST */}
      {loadError && filtered.length > 0 && (
        <motion.div variants={item} style={{ padding: '0 var(--v3-gutter) 12px' }}>
          <DataErrorState
            compact
            title="Could not refresh"
            message="Showing the last loaded results."
            onRetry={() => { void refetch() }}
            actionLabel={isFetching ? 'Retrying' : 'Retry'}
          />
        </motion.div>
      )}

      {loading && (
        <motion.div className="fh-work__list fh-work__list--loading" variants={item} style={{ padding: '0 var(--v3-gutter) 32px' }}>
          <SkeletonList rows={6} />
        </motion.div>
      )}

      {!loading && loadError && filtered.length === 0 && (
        <motion.div className="fh-work__list fh-work__list--empty" variants={item} style={{ padding: '0 var(--v3-gutter) 32px' }}>
          <DataErrorState
            title="Could not load your work"
            message={loadError}
            onRetry={() => { void refetch() }}
            actionLabel={isFetching ? 'Retrying' : 'Retry'}
          />
        </motion.div>
      )}

      {!loading && !loadError && filtered.length === 0 && (
        <motion.div className="fh-work__list fh-work__list--empty" variants={item} style={{ padding: '0 var(--v3-gutter) 32px' }}>
          <div className="v3-empty">
            <Sparkles size={20} color="var(--v3-text-muted)" style={{ margin: '0 auto 8px' }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
              {chip !== 'all' || search ? 'Nothing matches that view.' : 'No work yet.'}
            </div>
            <div style={{ fontSize: 12, marginBottom: 10 }}>
              {chip !== 'all' || search
                ? 'Clear the search or switch stage to see more.'
                : 'Add the next phone call and let it move through the stages.'}
            </div>
            {chip === 'all' && !search && (
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                style={{
                  background: 'none', border: 'none', padding: 0,
                  color: 'var(--v3-primary)', fontWeight: 700, fontSize: 12, cursor: 'pointer'
                }}
              >
                Add your first deal →
              </button>
            )}
          </div>
        </motion.div>
      )}

      {!loading && filtered.length > 0 && (
        <motion.div className="fh-work__list" variants={item} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 var(--v3-gutter) 32px' }}>
          <AnimatePresence>
            {visible.map((c) => (
              <DealCard
                key={c.id}
                contact={c}
                isNew={c.id === justAddedId}
                busy={busyId === c.id}
                canSell={isMoneyRole}
                onOpen={handleOpen}
                onHover={handleHover}
                onWon={handleWon}
                onLost={handleLost}
                onReopen={handleReopen}
                onFollowUp={handleFollowUp}
              />
            ))}
          </AnimatePresence>
          {hasMore && <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />}
        </motion.div>
      )}

      {/* ONE way in. Everything starts as a deal; Home's "New Job" tile
          deep-links with ?asStage=job for work that skips selling. */}
      <Suspense fallback={null}>
        <NewLeadSheet
          open={addOpen}
          userId={user?.id}
          initialStage={addStage}
          lockStage={addStage === 'lead'}
          onClose={() => setAddOpen(false)}
          onCreated={async (created: any) => {
            setAddOpen(false)
            if (created?.id && created.stage === 'quote') {
              navigate(`/quotes/${created.id}?tab=quote`)
              return
            }
            if (created?.id) setJustAddedId(created.id)
            await refresh()
            setTimeout(() => setJustAddedId(null), 1200)
            toastSuccess('Added', created?.name ? `${created.name} is on the board` : 'On the board')
          }}
        />
      </Suspense>

      <FloatingActionButton
        onClick={() => { setAddStage('lead'); setAddOpen(true) }}
        ariaLabel="New deal"
        hideOnDesktop={false}
      />

      <ScreenCloser caption={`${filtered.length} ${filtered.length === 1 ? 'deal' : 'deals'} in this view.`} />
    </motion.div>
  )
}

/* ============================================================
   DealCard, THE card. Every stage, one shape:
     [spine] Name                        $24.4K
             Job title · via source      [Stage pill]
             [follow-up chip when due]              [⋯]
   Tap anywhere → detail (where the single big stage CTA lives).
   Swipe → call / text. ⋯ → follow-ups, Won, Lost, Reopen.
   ============================================================ */
type DealCardProps = {
  contact: JobRow
  isNew: boolean
  busy: boolean
  // Whether this role may move the deal through the pipeline (Mark
  // won/lost). Field roles get follow-up actions but no stage moves.
  canSell: boolean
  // Handlers take the contact as an arg (rather than closing over it in
  // the parent) so their identity is stable across renders, that's what
  // lets React.memo below skip the untouched cards on every keystroke.
  onOpen: (c: JobRow) => void
  onHover: (c: JobRow) => void
  onWon: (c: JobRow) => void
  onLost: (c: JobRow) => void
  onReopen: (c: JobRow) => void
  onFollowUp: (c: JobRow, when: number | Date | null) => void
}

// React.memo, DealCard used to re-render all ~40 mounted cards on every
// search keystroke because the parent passed fresh inline-arrow callbacks
// each render. With stable handlers (above) + memo, only cards whose own
// props (contact ref / isNew / busy / canSell) actually change re-render.
const DealCard = memo(function DealCard({ contact: c, isNew, busy, canSell: mayMoveStage, onOpen, onHover, onWon, onLost, onReopen, onFollowUp }: DealCardProps) {
  // Calendar popover for "Pick a date…", anchored to the ⋯ button so
  // it opens exactly where the menu just closed.
  const [dateOpen, setDateOpen] = useState(false)
  const meta = STAGE_META[c.stage || 'lead'] || STAGE_META.lead
  const follow = followUpMeta(c)
  const phone = c.phone || c.fh_clients?.phone || ''
  const est = money(c.amount)
  const isTerminal = c.stage === 'lost' || c.stage === 'closed'
  // Sell actions require both a sellable stage AND a money role.
  const canSell = mayMoveStage && (c.stage === 'lead' || c.stage === 'quote')
  const canMarkWon = canSell && c.proposal_status !== 'changes_requested'
  // Reopen also moves a stage, money roles only.
  const canReopen = mayMoveStage && isTerminal
  // Follow up actions show on any non-terminal deal (all roles). If a
  // terminal deal offers no reopen (field role), the ⋯ menu is empty :
  // hide the trigger entirely rather than open an empty sheet.
  const hasActions = !isTerminal || canReopen
  const pillLabel = c.stage === 'quote' && c.proposal_status === 'changes_requested'
    ? 'Changes requested'
    : c.stage === 'quote' && (c.proposal_status === 'sent' || c.proposal_status === 'viewed')
      ? 'Quote sent'
      : meta.label

  const swipeActions: Array<{ icon: ReactNode; label: string; color: string; fg: string; onClick: () => void }> = []
  if (phone) {
    swipeActions.push({
      icon: <PhoneIcon size={18} />,
      label: `Call ${c.name || 'deal'}`,
      color: 'rgba(45, 122, 79, 0.22)',
      fg: 'var(--v3-success-bright)',
      onClick: () => { window.location.href = `tel:${phone}` }
    })
    swipeActions.push({
      icon: <MsgIcon size={18} />,
      label: `Text ${c.name || 'deal'}`,
      color: 'rgba(201, 150, 58, 0.18)',
      fg: 'var(--v3-primary)',
      onClick: () => { window.location.href = `sms:${phone}` }
    })
  }

  return (
    <SwipeableRow actions={swipeActions} disabled={!phone}>
      <motion.article
        className={`fh-deal-card${c.stage === 'lost' ? ' is-lost' : ''}`}
        initial={isNew ? { opacity: 0, scale: 0.97 } : false}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, height: 0, marginBottom: -8 }}
        onMouseEnter={() => onHover(c)}
        style={{
          position: 'relative',
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 12px 12px 24px',
          borderRadius: 10,
          background: 'var(--v3-surface)',
          border: isNew
            ? '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)'
            : '1px solid var(--v3-border)',
          opacity: c.stage === 'lost' ? 0.7 : 1,
          overflow: 'hidden'
        }}
      >
        {/* Stage spine */}
        <span aria-hidden="true" style={{
          position: 'absolute', left: 0, top: 10, bottom: 10, width: 3,
          background: meta.color, borderRadius: '0 3px 3px 0', pointerEvents: 'none'
        }} />

        {/* Body, the whole area is the tap target */}
        <button
          type="button"
          onClick={() => { hapticTap(); onOpen(c) }}
          style={{
            flex: 1, minWidth: 0,
            display: 'flex', flexDirection: 'column', gap: 4,
            background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
            textAlign: 'left', WebkitTapHighlightColor: 'transparent'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <span style={{
              fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14,
              color: 'var(--v3-text)', letterSpacing: 0,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            }}>
              {c.name || 'Unnamed'}
            </span>
            {est && (
              <span style={{
                flexShrink: 0, fontFamily: 'var(--font-display)', fontSize: 16,
                lineHeight: 1, color: 'var(--v3-text)', fontVariantNumeric: 'tabular-nums'
              }}>
                {est}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minWidth: 0 }}>
            <span style={{
              fontSize: 12, color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            }}>
              {c.job_title || c.job_type || c.address || '\u2003'}
              {c.referred_by ? ` · via ${c.referred_by}` : ''}
            </span>
            <StatusPill color={meta.color} label={pillLabel} style={{ flexShrink: 0 }} />
          </div>
          {follow && !isTerminal && (
            <div>
              <StatusPill
                color={follow.tone === 'danger'
                  ? 'var(--v3-danger-bright)'
                  : follow.tone === 'warn' ? 'var(--v3-primary)' : 'var(--v3-text-muted)'}
                icon={CalendarClock}
                label={follow.label}
              />
            </div>
          )}
        </button>

        {/* ⋯, the only control on the card. The calendar Popover and
            the dropdown share this button: PopoverAnchor→Trigger→button
            composes via asChild (the ui/ wrappers forward refs), so the
            calendar opens exactly where the menu just closed. */}
        <Popover open={dateOpen} onOpenChange={setDateOpen}>
        <DropdownMenu>
          <PopoverAnchor asChild>
            <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Deal actions"
              hidden={!hasActions}
              disabled={busy || !hasActions}
              style={{
                flexShrink: 0, width: 36, height: 36, borderRadius: 10,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent', border: '1px solid var(--v3-border)',
                color: 'var(--v3-text-muted)', cursor: busy ? 'wait' : 'pointer',
                WebkitTapHighlightColor: 'transparent'
              }}
            >
              <MoreHorizontal size={15} aria-hidden="true" />
            </button>
            </DropdownMenuTrigger>
          </PopoverAnchor>
          <DropdownMenuContent side="bottom" align="end" sideOffset={6} collisionPadding={20}>
            {!isTerminal && (
              <>
                <DropdownMenuItem onSelect={() => onFollowUp(c, 1)}>
                  <CalendarClock size={13} /> Follow up tomorrow
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onFollowUp(c, 3)}>
                  <CalendarClock size={13} /> Follow up in 3 days
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onFollowUp(c, 7)}>
                  <CalendarClock size={13} /> Follow up next week
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => {
                  // Let the menu finish closing before the popover
                  // grabs focus, or the menu's focus-restore wins.
                  setTimeout(() => setDateOpen(true), 0)
                }}>
                  <CalendarDays size={13} /> Pick a date…
                </DropdownMenuItem>
                {c.follow_up_on && (
                  <DropdownMenuItem onSelect={() => onFollowUp(c, null)}>
                    Clear follow up
                  </DropdownMenuItem>
                )}
              </>
            )}
            {canSell && (
              <>
                <DropdownMenuSeparator />
                {canMarkWon && (
                  <DropdownMenuItem onSelect={() => { hapticMedium(); onWon(c) }}>
                    <Trophy size={13} /> Mark won
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem variant="destructive" onSelect={() => onLost(c)}>
                  <XCircle size={13} /> Mark lost
                </DropdownMenuItem>
              </>
            )}
            {canReopen && (
              <DropdownMenuItem onSelect={() => onReopen(c)}>
                <RotateCcw size={13} /> Reopen
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <PopoverContent side="bottom" align="end" sideOffset={6} collisionPadding={12} className="ui:w-auto ui:p-0">
          <Suspense fallback={<div style={{ width: 250, height: 293 }} />}>
          <Calendar
            mode="single"
            selected={c.follow_up_on ? new Date(c.follow_up_on + 'T00:00:00') : undefined}
            disabled={{ before: new Date() }}
            onSelect={(d: Date | undefined) => {
              if (d) onFollowUp(c, d)
              setDateOpen(false)
            }}
          />
          </Suspense>
        </PopoverContent>
        </Popover>
      </motion.article>
    </SwipeableRow>
  )
})
