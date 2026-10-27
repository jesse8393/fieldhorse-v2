// One inventory for every viewport. Desktop may add job quick actions,
// but membership, filters, counts and source records stay shared.
import { lazy, Suspense, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Phone as PhoneIcon, MessageSquare as MsgIcon, CalendarClock, CalendarDays, Trophy, XCircle, MoreHorizontal, RotateCcw } from 'lucide-react'
import SwipeableRow from '../components/SwipeableRow.tsx'
import { StatusPill } from '../components/v3'
import JobsPhone from './jobs/JobsPhone.tsx'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
const Calendar = lazy(() => import('@/components/ui/calendar').then((m) => ({ default: m.Calendar })))
import { useAuth } from '../contexts/AuthContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { supabase } from '../lib/supabase.ts'
import { markLost, reopen, reopenQuestion } from '../lib/pipeline.ts'
import { useSecondTap } from '../lib/secondTap.ts'
import { detailRoute, LIST_STAGE_META as STAGE_META } from '../lib/stages.ts'
import { moneyCents as money } from '../lib/format.ts'
import { prefetchJobDetail } from './ContactDetail/hooks/useJobData.ts'
import { hapticTap, hapticMedium } from '../lib/haptics.ts'
import { toastSuccess, toastError } from '../lib/toast.ts'
import { canHover } from '../lib/hover.ts'
import { useIsDesktop } from '../lib/useMediaQuery.ts'
import { useJobs, useJobsRealtime, useJobSearch, jobsKey, type JobRow } from '../lib/queries.ts'
import { searchWorkJobs } from '../lib/workList.ts'

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

export default function Work() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: contacts = [], isLoading: loading, isError, error, refetch, isFetching } = useJobs()
  useJobsRealtime(user?.id, queryClient)
  const { canCreateFinancialDocs, canSeeFinancials, loading: membershipLoading } = useMembership()
  const isMoneyRole = !membershipLoading && canCreateFinancialDocs
  const showMoney = !membershipLoading && canSeeFinancials
  const isDesktop = useIsDesktop()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])
  const { data: serverHits = [], isError: searchDegraded, isPlaceholderData: searchPlaceholder } = useJobSearch(debouncedSearch)
  const searchCurrent = !searchPlaceholder && search.trim().toLowerCase() === debouncedSearch.trim().toLowerCase()
  const rows = useMemo(() => searchWorkJobs(contacts, searchCurrent ? serverHits : [], search), [contacts, serverHits, search, searchCurrent])
  const contactsById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows])
  const [busyId, setBusyId] = useState<string | null>(null)
  const loadError = isError ? error instanceof Error ? error.message : 'The job list could not load.' : ''
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
  // Won is no longer a stage move (Phase 9, D54, D61): the quote screen's
  // Make this a job makes the job, so Won opens the record.
  const handleWon = useCallback((c: JobRow) => {
    if (c.proposal_status === 'changes_requested') {
      toastError('Review changes first', 'Send the revised quote before making it a job.')
    }
    navigate(detailRoute(c))
  }, [navigate])
  const handleLost = useCallback((c: JobRow) => run(c, markLost, { stage: 'lost' } as Partial<JobRow>, "Couldn't mark lost"), [run])
  // Reopen asks first, like Mark lost on the job page: the card arms a
  // "Tap again to reopen" button when Reopen is picked from its menu, and
  // this runs on that second tap (D57).
  const handleReopen = useCallback(async (c: JobRow) => {
    await run(c, reopen, null, "Couldn't reopen")
  }, [run])
  const handleFollowUp = useCallback((c: JobRow, when: number | Date | null) => setFollowUp(c, when), [setFollowUp])

  return (
    <JobsPhone
      jobs={rows}
      loading={loading || membershipLoading}
      loadError={loadError}
      retrying={isFetching}
      onRetry={() => { void refetch() }}
      search={search}
      onSearchChange={setSearch}
      searchDegraded={searchDegraded}
      showMoney={showMoney}
      fieldView={!isMoneyRole}
      onNewLead={isMoneyRole ? () => navigate('/leads/new') : undefined}
      desktop={isDesktop}
      renderJobRow={isDesktop ? (row) => {
        const contact = contactsById.get(row.id)
        if (!contact || row.to !== detailRoute(contact)) return null
        return <DealCard contact={contact} busy={busyId === contact.id} canSell={isMoneyRole} showMoney={showMoney}
          onOpen={handleOpen} onHover={handleHover} onWon={handleWon} onLost={handleLost}
          onReopen={handleReopen} onFollowUp={handleFollowUp} />
      } : undefined}
    />
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
  isNew?: boolean
  busy: boolean
  // Whether this role may move the deal through the pipeline (Mark
  // won/lost). Field roles get follow-up actions but no stage moves.
  canSell: boolean
  showMoney: boolean
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
const DealCard = memo(function DealCard({ contact: c, isNew = false, busy, canSell: mayMoveStage, showMoney, onOpen, onHover, onWon, onLost, onReopen, onFollowUp }: DealCardProps) {
  // Calendar popover for "Pick a date…", anchored to the ⋯ button so
  // it opens exactly where the menu just closed.
  const [dateOpen, setDateOpen] = useState(false)
  // Reopen asks first (D57): picking it in the menu arms a "Tap again to
  // reopen" button on the card, which runs the move on the second tap and
  // goes back to resting on its own. The menu item only leaves the ask
  // here, and it is run once the menu has gone and focus is back on the ⋯
  // button, so the armed button can take focus from there.
  const askAfterMenuRef = useRef<(() => void) | null>(null)
  const reopenTap = useSecondTap()
  const reopenAgainRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (reopenTap.armed) reopenAgainRef.current?.focus()
  }, [reopenTap.armed])
  const meta = STAGE_META[c.stage || 'lead'] || STAGE_META.lead
  const follow = followUpMeta(c)
  const phone = c.phone || c.fh_clients?.phone || ''
  const est = showMoney && c.amount != null ? money(c.amount) : null
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
      fg: 'var(--v3-success-text)',
      onClick: () => { window.location.href = `tel:${phone}` }
    })
    swipeActions.push({
      icon: <MsgIcon size={18} />,
      label: `Text ${c.name || 'deal'}`,
      color: 'rgba(201, 150, 58, 0.18)',
      fg: 'var(--v3-primary-text)',
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
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12,
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
                  ? 'var(--v3-danger-text)'
                  : follow.tone === 'warn' ? 'var(--v3-primary-text)' : 'var(--v3-text-muted)'}
                icon={CalendarClock}
                label={follow.label}
              />
            </div>
          )}
        </button>

        {/* Reopen was picked in the menu: the second tap moves the deal
            back to Leads (or a closed job back to Jobs). */}
        {reopenTap.armed && (
          <div style={{ flex: '1 1 100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)' }}>
              {reopenQuestion(c).body}
            </span>
            <button
              ref={reopenAgainRef}
              type="button"
              onClick={() => reopenTap.tap(() => onReopen(c))}
              disabled={busy}
              style={{
                flexShrink: 0, minHeight: 32, padding: '0 12px', borderRadius: 10,
                border: '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)',
                background: 'var(--v3-primary-soft)', color: 'var(--v3-primary-text)',
                fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, cursor: 'pointer'
              }}
            >
              Tap again to reopen
            </button>
          </div>
        )}

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
              aria-label={`Actions for ${c.name || c.job_title || 'job'}`}
              hidden={!hasActions}
              disabled={busy || !hasActions}
              style={{
                flexShrink: 0, width: 44, height: 44, borderRadius: 10,
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
          <DropdownMenuContent
            side="bottom"
            align="end"
            sideOffset={6}
            collisionPadding={20}
            onCloseAutoFocus={() => {
              const ask = askAfterMenuRef.current
              if (!ask) return
              askAfterMenuRef.current = null
              // The menu puts focus back on its button right after this
              // handler; ask once it has.
              window.setTimeout(ask, 0)
            }}
          >
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
              <DropdownMenuItem onSelect={() => { askAfterMenuRef.current = () => reopenTap.tap(() => onReopen(c)) }}>
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
