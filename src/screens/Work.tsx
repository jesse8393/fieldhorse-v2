// One inventory for every viewport. Desktop may add job quick actions,
// but membership, filters, counts and source records stay shared.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Phone as PhoneIcon, MessageSquare as MsgIcon, CalendarClock, MoreHorizontal, RotateCcw } from 'lucide-react'
import SwipeableRow from '../components/SwipeableRow.tsx'
import { StatusPill } from '../components/v3'
import JobsPhone from './jobs/JobsPhone.tsx'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { reopen, reopenQuestion } from '../lib/pipeline.ts'
import { useSecondTap } from '../lib/secondTap.ts'
import { detailRoute, LIST_STAGE_META as STAGE_META } from '../lib/stages.ts'
import { moneyCents as money } from '../lib/format.ts'
import { prefetchJobDetail } from './ContactDetail/hooks/useJobData.ts'
import { hapticTap } from '../lib/haptics.ts'
import { toastError } from '../lib/toast.ts'
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
  // The search lives in ?q= (D18), so Back from a job and a reload keep it.
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearchState] = useState(() => searchParams.get('q') ?? '')
  const setSearch = useCallback((value: string) => {
    setSearchState(value)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set('q', value)
      else next.delete('q')
      return next
    }, { replace: true })
  }, [setSearchParams])
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

  // Stable per-row handlers (take the contact as an arg instead of
  // closing over it inline) so DealCard's props keep referential identity
  // across search keystrokes and React.memo can skip re-rendering the ~40
  // mounted cards.
  const handleOpen = useCallback((c: JobRow) => navigate(detailRoute(c)), [navigate])
  const handleHover = useCallback((c: JobRow) => { if (canHover) prefetchJobDetail(queryClient, c.id, user?.id) }, [queryClient, user?.id])
  // Reopen asks first, like Mark lost on the job page: the card arms a
  // "Tap again to reopen" button when Reopen is picked from its menu, and
  // this runs on that second tap (D57).
  const handleReopen = useCallback(async (c: JobRow) => {
    await run(c, reopen, null, "Couldn't reopen")
  }, [run])

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
          onOpen={handleOpen} onHover={handleHover} onReopen={handleReopen} />
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
   Swipe → call / text. ⋯ → the job's More screen (follow up, mark
   lost, delete), or Reopen with a second tap on a closed or lost job.
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
  onReopen: (c: JobRow) => void
}

// React.memo, DealCard used to re-render all ~40 mounted cards on every
// search keystroke because the parent passed fresh inline-arrow callbacks
// each render. With stable handlers (above) + memo, only cards whose own
// props (contact ref / isNew / busy / canSell) actually change re-render.
const DealCard = memo(function DealCard({ contact: c, isNew = false, busy, canSell: mayMoveStage, showMoney, onOpen, onHover, onReopen }: DealCardProps) {
  // Reopen asks first (D57): the card's Reopen button arms a "Tap again
  // to reopen" button, which runs the move on the second tap and goes
  // back to resting on its own.
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
  // Reopen moves a stage, money roles only.
  const canReopen = mayMoveStage && isTerminal
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

        {/* Reopen was tapped: the second tap moves the deal back to
            Leads (or a closed job back to Jobs). */}
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

        {/* ⋯ opens the job's More screen (D57: a route, not a menu). A
            closed or lost job offers Reopen instead, asked with a second tap. */}
        {!isTerminal ? (
          <Link
            to={`/jobs/${encodeURIComponent(c.id)}/more`}
            aria-label={`Actions for ${c.name || c.job_title || 'job'}`}
            style={{
              flexShrink: 0, width: 44, height: 44, borderRadius: 10,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: '1px solid var(--v3-border)',
              color: 'var(--v3-text-muted)', WebkitTapHighlightColor: 'transparent'
            }}
          >
            <MoreHorizontal size={15} aria-hidden="true" />
          </Link>
        ) : canReopen && !reopenTap.armed ? (
          <button
            type="button"
            onClick={() => reopenTap.tap(() => onReopen(c))}
            disabled={busy}
            style={{
              flexShrink: 0, minHeight: 44, padding: '0 12px', borderRadius: 10,
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: 'transparent', border: '1px solid var(--v3-border)',
              color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
              cursor: busy ? 'wait' : 'pointer', WebkitTapHighlightColor: 'transparent'
            }}
          >
            <RotateCcw size={13} aria-hidden="true" /> Reopen
          </button>
        ) : null}
      </motion.article>
    </SwipeableRow>
  )
})
