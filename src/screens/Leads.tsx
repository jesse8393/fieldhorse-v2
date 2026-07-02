// src/screens/Leads.tsx
//
// Leads are their own thing now (pipeline v2). This screen owns the
// pre-deal lifecycle: capture → follow up → quote → won (becomes a
// Job, carrying its quote/files with it) or lost. Jobs.tsx no longer
// mixes leads into the job board.
//
// Storage note: a lead is still an fh_contacts row (stage lead/quote)
// — that's what makes "Mark won" instant and lossless. What changed
// is the experience: own route, own lifecycle, follow-up dates, and
// lead-shaped cards instead of job cards.

import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Search, Phone as PhoneIcon, MessageSquare as MsgIcon,
  Sparkles, CalendarClock, FileText, Trophy, XCircle, MoreHorizontal, Eye, ArrowRight
} from 'lucide-react'
import SwipeableRow from '../components/SwipeableRow.tsx'
import { SkeletonList } from '../components/Skeleton.tsx'
import DataErrorState from '../components/DataErrorState.tsx'
import { FilterPill, FloatingActionButton, ScreenCloser } from '../components/v3'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { useAuth } from '../contexts/AuthContext.tsx'
import { supabase } from '../lib/supabase.ts'
import { LEAD_STAGES } from '../lib/stages.ts'
import { markWon, markLost, reopen, startQuote } from '../lib/pipeline.ts'
import { useInfiniteRender } from '../lib/useInfiniteRender.ts'
import { hapticTap, hapticMedium } from '../lib/haptics.ts'
import { toastSuccess, toastError } from '../lib/toast.ts'
import { useFhMotion } from '../lib/motion.ts'
import { useJobs, useJobsRealtime, queryKeys, type JobRow } from '../lib/queries.ts'

const NewLeadSheet = lazy(() => import('../components/NewLeadSheet.tsx'))
const NewQuoteSheet = lazy(() => import('../components/NewQuoteSheet.tsx'))

type LeadFilter = 'open' | 'new' | 'quoted' | 'lost'
type LeadSurface = 'leads' | 'quotes'
type LeadsProps = { surface?: LeadSurface }
type LeadContact = JobRow
type ViewIntel = { viewed_at: string | null }
type LeadStatus = { id: 'lost' | 'sent' | 'quoting' | 'new'; label: string; color: string }
type FollowUpMeta = { label: string; tone: 'danger' | 'warn' | 'muted' }
type LeadSummary = {
  openCount: number
  pipeline: number
  dueCount: number
  quotedValue: number
}
type LeadCommand = {
  focus: LeadContact | null
  score: number
  reason: string
  cta: string
  dueCount: number
  hotQuoteCount: number
  staleCount: number
  openValue: number
}
type LeadTab = {
  id: LeadFilter
  label: string
  match: (contact: LeadContact) => boolean
}

function money(n: number | string | null | undefined) {
  const v = Number(n || 0)
  if (!v) return null
  if (v >= 1000) return `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K`
  return `$${Math.round(v).toLocaleString()}`
}

// Lead status is derived, not stored — the record itself is the truth:
//   quote sent     → stage 'quote' + proposal_status sent/viewed
//   quoting        → stage 'quote' (draft quote in progress)
//   new            → stage 'lead'
function leadStatus(c: Pick<LeadContact, 'stage' | 'proposal_status'>): LeadStatus {
  if (c.stage === 'lost') return { id: 'lost', label: 'Lost', color: 'var(--v3-text-muted)' }
  if (c.stage === 'quote') {
    if (c.proposal_status === 'sent' || c.proposal_status === 'viewed') {
      return { id: 'sent', label: 'Quote sent', color: 'var(--v3-primary)' }
    }
    return { id: 'quoting', label: 'Quoting', color: 'var(--v3-primary)' }
  }
  return { id: 'new', label: 'New', color: 'var(--v3-success-bright, #4ade80)' }
}

function followUpMeta(c: Pick<LeadContact, 'follow_up_on'>): FollowUpMeta | null {
  if (!c.follow_up_on) return null
  const due = new Date(c.follow_up_on + 'T00:00:00')
  if (Number.isNaN(due.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000)
  if (diffDays < 0) return { label: `Follow-up ${-diffDays}d overdue`, tone: 'danger' }
  if (diffDays === 0) return { label: 'Follow up today', tone: 'warn' }
  if (diffDays === 1) return { label: 'Follow up tomorrow', tone: 'muted' }
  return { label: `Follow up ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`, tone: 'muted' }
}

// "They saw it" intel for quote-sent leads, derived from the public
// proposal link's view tracking. Two days of silence after a view is
// the follow-up trigger — engaged-then-quiet is the hottest call to make.
function viewedMeta(intel: { viewed_at: string | null } | undefined, statusId: string):
  { label: string; tone: 'warn' | 'muted' } | null {
  if (statusId !== 'sent') return null
  if (!intel) return null
  if (!intel.viewed_at) return { label: 'Not viewed yet', tone: 'muted' }
  const viewed = new Date(intel.viewed_at)
  if (Number.isNaN(viewed.getTime())) return null
  const mins = Math.max(0, Math.round((Date.now() - viewed.getTime()) / 60000))
  const ago = mins < 60
    ? `${mins || 1}m ago`
    : mins < 60 * 24
      ? `${Math.round(mins / 60)}h ago`
      : `${Math.round(mins / (60 * 24))}d ago`
  if (mins >= 60 * 48) return { label: `Viewed ${ago} — follow up`, tone: 'warn' }
  return { label: `Viewed ${ago}`, tone: 'muted' }
}

function daysSince(iso: string | null | undefined) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / 86400000))
}

function buildLeadCommand(leads: LeadContact[], viewIntel: Record<string, ViewIntel>): LeadCommand {
  const open = leads.filter((c) => LEAD_STAGES.includes(c.stage || ''))
  let focus: LeadContact | null = null
  let bestScore = -1
  let bestReason = 'No open leads need attention.'
  let hotQuoteCount = 0
  let dueCount = 0
  let staleCount = 0

  for (const c of open) {
    const amount = Number(c.amount || 0)
    const follow = followUpMeta(c)
    const viewed = viewedMeta(viewIntel[c.id], leadStatus(c).id)
    const staleDays = daysSince(c.updated_at || c.created_at)
    let score = Math.min(30, amount / 2500)
    let reason = amount > 0 ? `${money(amount)} opportunity` : 'Open opportunity'

    if (follow?.tone === 'danger') {
      score += 55
      reason = follow.label
      dueCount++
    } else if (follow?.tone === 'warn') {
      score += 42
      reason = follow.label
      dueCount++
    }

    if (viewed?.tone === 'warn') {
      score += 45
      reason = viewed.label
      hotQuoteCount++
    }

    if (c.stage === 'quote') score += 16
    if (staleDays != null && staleDays >= 7) {
      score += Math.min(24, staleDays)
      staleCount++
      if (!follow && viewed?.tone !== 'warn') reason = `${staleDays}d since last touch`
    }

    if (score > bestScore) {
      focus = c
      bestScore = score
      bestReason = reason
    }
  }

  return {
    focus,
    score: Math.max(0, Math.round(bestScore)),
    reason: bestReason,
    cta: focus?.stage === 'quote' ? 'Open quote' : 'Open lead',
    dueCount,
    hotQuoteCount,
    staleCount,
    openValue: open.reduce((sum, c) => sum + Number(c.amount || 0), 0),
  }
}

const LEAD_TABS: LeadTab[] = [
  { id: 'open',   label: 'Open',       match: (c) => LEAD_STAGES.includes(c.stage || '') },
  { id: 'new',    label: 'New',        match: (c) => c.stage === 'lead' },
  { id: 'quoted', label: 'Quoting',    match: (c) => c.stage === 'quote' },
  { id: 'lost',   label: 'Lost',       match: (c) => c.stage === 'lost' }
]

const QUOTE_TABS: LeadTab[] = [
  { id: 'quoted', label: 'Active quotes', match: (c) => c.stage === 'quote' }
]

function leadDetailRoute(c: Pick<LeadContact, 'id' | 'stage'>, surface: LeadSurface) {
  if (surface === 'quotes' || c.stage === 'quote') return `/quotes/${c.id}?tab=quote`
  return `/leads/${c.id}`
}

export default function Leads({ surface = 'leads' }: LeadsProps = {}) {
  const isQuotesSurface = surface === 'quotes'
  const tabs = isQuotesSurface ? QUOTE_TABS : LEAD_TABS
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const {
    data: contacts = [],
    isLoading: loading,
    isError,
    error,
    refetch,
    isFetching,
  } = useJobs()
  useJobsRealtime(user?.id, queryClient)
  const [searchParams, setSearchParams] = useSearchParams()
  const [filter, setFilter] = useState<LeadFilter>(isQuotesSurface ? 'quoted' : 'open')
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [justAddedId, setJustAddedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const loadError = isError
    ? error instanceof Error ? error.message : 'The lead data request failed.'
    : ''

  useEffect(() => {
    setFilter(isQuotesSurface ? 'quoted' : 'open')
  }, [isQuotesSurface])

  // Proposal-link view intel, keyed by contact. Owner-only via RLS.
  const [viewIntel, setViewIntel] = useState<Record<string, ViewIntel>>({})
  useEffect(() => {
    if (!user?.id) return
    let alive = true
    ;(async () => {
      const { data, error } = await supabase
        .from('fh_public_links')
        .select('contact_id, last_viewed_at')
        .eq('kind', 'proposal')
      if (error) throw error
      if (!alive || !data) return
      const map: Record<string, ViewIntel> = {}
      for (const r of data as any[]) {
        if (!r.contact_id) continue
        const prev = map[r.contact_id]?.viewed_at
        // Keep the most recent view across multiple links per contact.
        if (!prev || (r.last_viewed_at && r.last_viewed_at > prev)) {
          map[r.contact_id] = { viewed_at: r.last_viewed_at || prev || null }
        }
      }
      setViewIntel(map)
    })().catch((e) => {
      if (!alive) return
      console.error('[fieldhorse] lead proposal view intel failed', e)
      setViewIntel({})
    })
    return () => { alive = false }
  }, [user?.id, contacts.length])

  // ?new=1 deep link (Command palette / Home quick action).
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setAddOpen(true)
      const sp = new URLSearchParams(searchParams)
      sp.delete('new')
      setSearchParams(sp, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // Deep links from Command-K, Home pipeline chips, and the Job Desk
  // redirect land here. Keep the Lead Desk filter honest instead of
  // dropping every lead-shaped link into the generic Open view.
  useEffect(() => {
    const stage = searchParams.get('stage')
    const view = searchParams.get('view')
    const requested = stage || view
    if (!requested) return
    const next: LeadFilter | null =
      requested === 'lead' || requested === 'new' ? 'new'
      : requested === 'quote' || requested === 'quoted' ? 'quoted'
      : !isQuotesSurface && requested === 'lost' ? 'lost'
      : !isQuotesSurface && (requested === 'open' || requested === 'leads') ? 'open'
      : null
    if (!next) return
    setFilter(next)
    const sp = new URLSearchParams(searchParams)
    sp.delete('stage')
    sp.delete('view')
    setSearchParams(sp, { replace: true })
  }, [isQuotesSurface, searchParams, setSearchParams])

  const leads = useMemo(
    () => contacts.filter((c) => (
      isQuotesSurface
        ? c.stage === 'quote'
        : LEAD_STAGES.includes(c.stage || '') || c.stage === 'lost'
    )),
    [contacts, isQuotesSurface]
  )

  const activeTab = tabs.find((t) => t.id === filter) || tabs[0]

  const filtered = useMemo(() => {
    let rows = leads.filter(activeTab.match)
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter((c) =>
        [c.name, c.phone, c.email, c.address, c.referred_by, c.job_type]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q))
      )
    }
    // Follow-ups due float to the top; inside each band, newest first.
    return [...rows].sort((a, b) => {
      const fa = a.follow_up_on ? new Date(a.follow_up_on).getTime() : Infinity
      const fb = b.follow_up_on ? new Date(b.follow_up_on).getTime() : Infinity
      if (fa !== fb) return fa - fb
      return new Date(b.updated_at || b.created_at || 0).getTime()
        - new Date(a.updated_at || a.created_at || 0).getTime()
    })
  }, [leads, activeTab, search])

  // Bounded render window that grows on scroll — keeps the DOM small at
  // thousands of leads/quotes without changing the card or swipe behavior.
  const { visible: visibleLeads, sentinelRef: leadsSentinelRef, hasMore: leadsHasMore } = useInfiniteRender(
    filtered,
    `${filter}|${search}`
  )

  const tabCounts = useMemo<Partial<Record<LeadFilter, number>>>(() => {
    if (loading) return {}
    const out: Partial<Record<LeadFilter, number>> = {}
    for (const t of tabs) out[t.id] = leads.filter(t.match).length
    return out
  }, [leads, loading, tabs])

  const summary = useMemo(() => {
    const open = leads.filter((c) => LEAD_STAGES.includes(c.stage || ''))
    const quoted = leads.filter((c) => c.stage === 'quote')
    const pipeline = open.reduce((s, c) => s + Number(c.amount || 0), 0)
    const quotedValue = quoted.reduce((s, c) => s + Number(c.amount || 0), 0)
    const dueCount = open.filter((c) => {
      const m = followUpMeta(c)
      return m && (m.tone === 'danger' || m.tone === 'warn')
    }).length
    return { openCount: open.length, pipeline, dueCount, quotedValue } satisfies LeadSummary
  }, [leads])

  const leadCommand = useMemo(
    () => buildLeadCommand(leads, viewIntel),
    [leads, viewIntel]
  )

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.jobs })
  }

  async function onWon(c: LeadContact) {
    if (busyId) return
    setBusyId(c.id)
    try {
      const res: any = await markWon(c)
      if (res?.error) throw res.error
      await refresh()
      navigate(`/jobs/${c.id}`)
    } catch (e: any) {
      toastError("Couldn't mark won", e?.message || 'Try again')
    } finally {
      setBusyId(null)
    }
  }

  async function onQuote(c: LeadContact) {
    if (busyId) return
    if (c.stage === 'quote') {
      navigate(leadDetailRoute(c, 'quotes'))
      return
    }
    setBusyId(c.id)
    try {
      const res: any = await startQuote(c)
      if (res?.error) throw res.error
      await refresh()
      navigate(leadDetailRoute({ id: c.id, stage: 'quote' }, 'quotes'))
    } catch (e: any) {
      toastError("Couldn't start quote", e?.message || 'Try again')
    } finally {
      setBusyId(null)
    }
  }

  async function onLost(c: LeadContact) {
    if (busyId) return
    setBusyId(c.id)
    try {
      const res: any = await markLost(c)
      if (res?.error) throw res.error
      await refresh()
    } catch (e: any) {
      toastError("Couldn't mark lost", e?.message || 'Try again')
    } finally {
      setBusyId(null)
    }
  }

  async function onReopen(c: LeadContact) {
    if (busyId) return
    setBusyId(c.id)
    try {
      const res: any = await reopen(c)
      if (res?.error) throw res.error
      await refresh()
    } catch (e: any) {
      toastError("Couldn't reopen", e?.message || 'Try again')
    } finally {
      setBusyId(null)
    }
  }

  async function setFollowUp(c: LeadContact, days: number | null) {
    const value = days === null
      ? null
      : new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
    const { error } = await supabase
      .from('fh_contacts')
      .update({ follow_up_on: value })
      .eq('id', c.id)
      .eq('user_id', c.user_id)
    if (error) {
      toastError("Couldn't set follow-up", error.message)
      return
    }
    toastSuccess(value ? 'Follow-up set' : 'Follow-up cleared', value ? `${c.name || 'Lead'} · ${followUpMeta({ follow_up_on: value })?.label || value}` : '')
    await refresh()
  }

  const { stagger, item } = useFhMotion()
  const itemNoun = isQuotesSurface ? 'quote' : 'lead'
  const itemPlural = isQuotesSurface ? 'quotes' : 'leads'
  const createLabel = isQuotesSurface ? 'New quote' : 'New lead'
  const baseFilter: LeadFilter = isQuotesSurface ? 'quoted' : 'open'
  const titleAccent = isQuotesSurface ? '& Proposals' : '& Follow-ups'
  const searchLabel = isQuotesSurface ? 'Search quotes' : 'Search leads'
  const searchPlaceholder = isQuotesSurface ? 'Search quotes, customers, numbers...' : 'Search leads, sources, numbers...'

  return (
    <motion.div
      className="v3-screen v3-screen--leads"
      variants={stagger}
      initial="hidden"
      animate="show"
      style={{ position: 'relative', paddingBottom: 'calc(76px + env(safe-area-inset-bottom, 0px))' }}
    >
      {/* HEADER */}
      <motion.div className="fh-leads__head" variants={item} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '12px 20px 8px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 className="jobs-title">
            {isQuotesSurface ? 'Quotes' : 'Leads'}{' '}
            <span style={{ color: 'var(--v3-primary-bright)' }}>{titleAccent}</span>
          </h1>
          <div className="jobs-stats">
            {loading ? (
              <span style={{ color: 'var(--v3-text-muted)' }}>Loading…</span>
            ) : (
              <>
                <span><b>{summary.openCount}</b> {isQuotesSurface ? 'active' : 'open'}</span>
                {summary.pipeline > 0 && (
                  <>
                    <span className="dot-sep">·</span>
                    <span><b>{money(summary.pipeline)}</b> {isQuotesSurface ? 'quoted' : 'potential'}</span>
                  </>
                )}
                {summary.dueCount > 0 && (
                  <>
                    <span className="dot-sep">·</span>
                    <span className="jobs-stats__alert"><b>{summary.dueCount}</b> need a follow-up</span>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          className="fh-jobs__action fh-desktop-only-action"
          onClick={() => { hapticMedium(); setAddOpen(true) }}
          aria-label={createLabel}
        >
          <Plus size={15} strokeWidth={2.4} />
          <span>{createLabel}</span>
        </button>
      </motion.div>

      {/* SEARCH */}
      <motion.div className="fh-leads__search" variants={item} style={{ padding: '12px 20px 10px' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={16} style={{ position: 'absolute', left: 14, color: 'var(--v3-text-muted)', pointerEvents: 'none' }} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={searchLabel}
            autoComplete="off"
            placeholder={searchPlaceholder}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '12px 14px 12px 40px', borderRadius: 12,
              background: 'var(--v3-surface)', border: '1px solid var(--v3-border)',
              color: 'var(--v3-text)', fontFamily: 'var(--font-body)', fontSize: 13,
              outline: 'none'
            }}
          />
        </div>
      </motion.div>

      {/* STATUS TABS */}
      <motion.div className="fh-leads__tabs" variants={item} style={{ padding: '0 var(--v3-gutter) 14px' }}>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }} role="tablist" aria-label={isQuotesSurface ? 'Quote filters' : 'Lead filters'}>
          {tabs.map((t) => (
            <FilterPill
              key={t.id}
              active={filter === t.id}
              count={tabCounts[t.id]}
              ariaLabel={`Show ${t.label.toLowerCase()} ${itemPlural}`}
              onClick={() => { hapticTap(); setFilter(t.id) }}
            >
              {t.label}
            </FilterPill>
          ))}
        </div>
      </motion.div>

      <motion.div className="fh-leads__ops-wrap" variants={item}>
        <LeadOpsPanel
          loading={loading}
          summary={summary}
          tabCounts={tabCounts}
          surface={surface}
          onFilter={(next: LeadFilter) => {
            hapticTap()
            setFilter(next)
          }}
          onNewLead={() => {
            hapticMedium()
            setAddOpen(true)
          }}
          onJobs={() => navigate('/jobs')}
        />
      </motion.div>

      <motion.div className="fh-leads__conversion-wrap" variants={item}>
        <LeadConversionPanel
          command={leadCommand}
          loading={loading}
          surface={surface}
          onOpenFocus={() => {
            if (!leadCommand.focus?.id) return
            navigate(leadDetailRoute(leadCommand.focus, surface))
          }}
          onFilterDue={() => {
            hapticTap()
            setFilter(baseFilter)
          }}
          onFilterQuoted={() => {
            hapticTap()
            setFilter('quoted')
          }}
          onNewLead={() => {
            hapticMedium()
            setAddOpen(true)
          }}
        />
      </motion.div>

      {/* LIST */}
      {loadError && filtered.length > 0 && (
        <motion.div className="fh-leads__list" variants={item} style={{ padding: '0 var(--v3-gutter) 14px' }}>
          <DataErrorState
            compact
            title={`Could not refresh ${itemPlural}`}
            message="Showing the last loaded results."
            onRetry={() => { void refetch() }}
            actionLabel={isFetching ? 'Retrying' : 'Retry'}
          />
        </motion.div>
      )}

      {loading && (
        <motion.div className="fh-leads__list fh-leads__list--loading" variants={item} style={{ padding: '0 var(--v3-gutter) 32px' }}>
          <SkeletonList rows={5} />
        </motion.div>
      )}

      {!loading && loadError && filtered.length === 0 && (
        <motion.div className="fh-leads__list fh-leads__list--empty" variants={item} style={{ padding: '0 var(--v3-gutter) 32px' }}>
          <DataErrorState
            title={`Could not load ${itemPlural}`}
            message={loadError}
            onRetry={() => { void refetch() }}
            actionLabel={isFetching ? 'Retrying' : 'Retry'}
          />
        </motion.div>
      )}

      {!loading && !loadError && filtered.length === 0 && (
        <motion.div className="fh-leads__list fh-leads__list--empty" variants={item} style={{ padding: '0 var(--v3-gutter) 32px' }}>
          <div className="v3-empty">
            <Sparkles size={20} color="var(--v3-text-muted)" style={{ margin: '0 auto 8px' }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
              {filter !== baseFilter || search ? `No ${itemPlural} match that view.` : `No ${itemPlural} yet.`}
            </div>
            <div style={{ fontSize: 12, marginBottom: 10 }}>
              {filter !== baseFilter || search
                ? 'Clear the search or switch views to see more.'
                : isQuotesSurface
                  ? 'Start the proposal once scope is real, then win it into a job.'
                  : 'Drop the next phone call in here and let it work the pipeline.'}
            </div>
            {filter === baseFilter && !search && (
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                style={{
                  background: 'none', border: 'none', padding: 0,
                  color: 'var(--v3-primary)', fontWeight: 700, fontSize: 12, cursor: 'pointer'
                }}
              >
                Add first {itemNoun} →
              </button>
            )}
          </div>
        </motion.div>
      )}

      {!loading && filtered.length > 0 && (
        <motion.div className="fh-leads__list" variants={item} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 var(--v3-gutter) 32px' }}>
          <AnimatePresence>
            {visibleLeads.map((c) => (
              <LeadCard
                key={c.id}
                contact={c}
                isNew={c.id === justAddedId}
                busy={busyId === c.id}
                onOpen={() => navigate(leadDetailRoute(c, surface))}
                onQuote={() => onQuote(c)}
                onWon={() => onWon(c)}
                onLost={() => onLost(c)}
                onReopen={() => onReopen(c)}
                onFollowUp={(days: number | null) => setFollowUp(c, days)}
                viewIntel={viewIntel[c.id]}
              />
            ))}
          </AnimatePresence>
          {leadsHasMore && <div ref={leadsSentinelRef} aria-hidden="true" style={{ height: 1 }} />}
        </motion.div>
      )}

      {/* CREATE SHEET — quotes get the minimal "who's it for → build" flow;
          leads get the full capture form. One way to start each. */}
      <Suspense fallback={null}>
        {isQuotesSurface ? (
          <NewQuoteSheet
            open={addOpen}
            userId={user?.id}
            onClose={() => setAddOpen(false)}
            onStarted={(created: any) => {
              setAddOpen(false)
              // Straight into the line-item builder — that's the whole point.
              if (created?.id) navigate(`/quotes/${created.id}?tab=quote`)
            }}
          />
        ) : (
          <NewLeadSheet
            open={addOpen}
            userId={user?.id}
            initialStage="lead"
            lockStage
            onClose={() => setAddOpen(false)}
            onCreated={async (created: any) => {
              setAddOpen(false)
              // Converting a lead into a quote later lands in the builder; a
              // brand-new quote here would too, but leads stay on the board
              // so you can capture several in a row.
              if (created?.id && created.stage === 'quote') {
                navigate(`/quotes/${created.id}?tab=quote`)
                return
              }
              if (created?.id) setJustAddedId(created.id)
              await refresh()
              setTimeout(() => setJustAddedId(null), 1200)
              toastSuccess(`${createLabel} added`, created?.name ? `${created.name} is on the board` : 'On the board')
            }}
          />
        )}
      </Suspense>

      <FloatingActionButton
        onClick={() => setAddOpen(true)}
        ariaLabel={createLabel}
        hideOnDesktop
      />

      <ScreenCloser caption={`${filtered.length} ${filtered.length === 1 ? itemNoun : itemPlural} in this view.`} />
    </motion.div>
  )
}

type LeadOpsPanelProps = {
  loading: boolean
  summary: LeadSummary
  tabCounts: Partial<Record<LeadFilter, number>>
  surface: LeadSurface
  onFilter: (next: LeadFilter) => void
  onNewLead: () => void
  onJobs: () => void
}

function LeadOpsPanel({ loading, summary, tabCounts, surface, onFilter, onNewLead, onJobs }: LeadOpsPanelProps) {
  const isQuotesSurface = surface === 'quotes'
  const newCount = Number(tabCounts.new || 0)
  const quotedCount = Number(tabCounts.quoted || 0)
  const dueCount = Number(summary.dueCount || 0)
  const potential = money(summary.pipeline) || '$0'
  const quotedValue = money(summary.quotedValue) || '$0'
  const nextFilter: LeadFilter = isQuotesSurface ? 'quoted' : dueCount > 0 ? 'open' : newCount > 0 ? 'new' : 'quoted'
  const createLabel = isQuotesSurface ? 'New quote' : 'New lead'

  return (
    <section className="fh-leads-ops" aria-label={`${isQuotesSurface ? 'Quote' : 'Lead'} Desk operating summary`}>
      <button
        type="button"
        className="fh-leads-ops__primary"
        onClick={() => onFilter(nextFilter)}
      >
        <span className="fh-leads-ops__eyebrow">{isQuotesSurface ? 'Proposal desk' : 'Revenue intake'}</span>
        <strong>{loading ? 'Syncing...' : dueCount > 0 ? `${dueCount} follow-ups due` : isQuotesSurface ? `${quotedCount} active quotes` : `${newCount} new leads`}</strong>
        <span>{loading ? 'Refreshing the board' : isQuotesSurface ? `${quotedValue} quoted value` : `${potential} open potential`}</span>
      </button>

      <div className="fh-leads-ops__metrics">
        {isQuotesSurface ? (
          <>
            <button type="button" onClick={() => onFilter('quoted')}>
              <FileText size={14} aria-hidden="true" />
              <span>Active</span>
              <strong>{loading ? '--' : quotedCount}</strong>
            </button>
            <button type="button" onClick={() => onFilter('quoted')}>
              <CalendarClock size={14} aria-hidden="true" />
              <span>Due</span>
              <strong>{loading ? '--' : dueCount}</strong>
            </button>
            <button type="button" onClick={() => onFilter('quoted')}>
              <Trophy size={14} aria-hidden="true" />
              <span>Quoted $</span>
              <strong>{loading ? '--' : quotedValue}</strong>
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => onFilter('new')}>
              <Sparkles size={14} aria-hidden="true" />
              <span>New</span>
              <strong>{loading ? '--' : newCount}</strong>
            </button>
            <button type="button" onClick={() => onFilter('quoted')}>
              <FileText size={14} aria-hidden="true" />
              <span>Quoting</span>
              <strong>{loading ? '--' : quotedCount}</strong>
            </button>
            <button type="button" onClick={() => onFilter('open')}>
              <CalendarClock size={14} aria-hidden="true" />
              <span>Due</span>
              <strong>{loading ? '--' : dueCount}</strong>
            </button>
            <button type="button" onClick={() => onFilter('quoted')}>
              <Trophy size={14} aria-hidden="true" />
              <span>Quoted $</span>
              <strong>{loading ? '--' : quotedValue}</strong>
            </button>
          </>
        )}
      </div>

      <div className="fh-leads-ops__actions">
        <button type="button" className="fh-leads-ops__new" onClick={onNewLead}>
          <Plus size={15} aria-hidden="true" />
          <span>{createLabel}</span>
        </button>
        <button type="button" className="fh-leads-ops__job" onClick={onJobs}>
          <Trophy size={15} aria-hidden="true" />
          <span>Pipeline</span>
        </button>
      </div>
    </section>
  )
}

type LeadConversionPanelProps = {
  command: LeadCommand
  loading: boolean
  surface: LeadSurface
  onOpenFocus: () => void
  onFilterDue: () => void
  onFilterQuoted: () => void
  onNewLead: () => void
}

function LeadConversionPanel({
  command,
  loading,
  surface,
  onOpenFocus,
  onFilterDue,
  onFilterQuoted,
  onNewLead,
}: LeadConversionPanelProps) {
  const isQuotesSurface = surface === 'quotes'
  const focusName = command.focus?.name || command.focus?.job_title || `No ${isQuotesSurface ? 'quote' : 'lead'} selected`
  const focusAmount = money(command.focus?.amount) || '$0'
  const hasFocus = !!command.focus

  return (
    <section className="fh-lead-command" aria-label={`${isQuotesSurface ? 'Quote' : 'Lead'} conversion command`}>
      <button
        type="button"
        className="fh-lead-command__focus"
        onClick={hasFocus ? onOpenFocus : onNewLead}
      >
        <span className="fh-lead-command__eyebrow">Next best move</span>
        <strong>{loading ? 'Ranking opportunities...' : hasFocus ? focusName : `Create your first live ${isQuotesSurface ? 'quote' : 'lead'}`}</strong>
        <span>{loading ? 'Checking follow-ups, quote views, and deal value.' : hasFocus ? `${command.reason} · ${focusAmount}` : `Start the board with one real ${isQuotesSurface ? 'proposal' : 'opportunity'}.`}</span>
        <em>
          {hasFocus ? command.cta : isQuotesSurface ? 'New quote' : 'New lead'}
          <ArrowRight size={13} aria-hidden="true" />
        </em>
      </button>

      <div className="fh-lead-command__signals">
        <button type="button" onClick={onFilterDue}>
          <CalendarClock size={15} aria-hidden="true" />
          <span>Follow-ups</span>
          <strong>{loading ? '--' : command.dueCount}</strong>
        </button>
        <button type="button" onClick={onFilterQuoted}>
          <Eye size={15} aria-hidden="true" />
          <span>Hot quotes</span>
          <strong>{loading ? '--' : command.hotQuoteCount}</strong>
        </button>
        <button type="button" onClick={onFilterDue}>
          <Trophy size={15} aria-hidden="true" />
          <span>Open value</span>
          <strong>{loading ? '--' : (money(command.openValue) || '$0')}</strong>
        </button>
      </div>
    </section>
  )
}

/* ============================================================
   LeadCard — lead-shaped card: who · source · status · value ·
   follow-up, with the three moves that matter (Quote / Won / Lost)
   right on the card. Swipe for call/text.
   ============================================================ */
type LeadCardProps = {
  contact: LeadContact
  isNew: boolean
  busy: boolean
  onOpen: () => void
  onQuote: () => void
  onWon: () => void
  onLost: () => void
  onReopen: () => void
  onFollowUp: (days: number | null) => void
  viewIntel?: ViewIntel
}

function LeadCard({ contact: c, isNew, busy, onOpen, onQuote, onWon, onLost, onReopen, onFollowUp, viewIntel }: LeadCardProps) {
  const status = leadStatus(c)
  const viewed = viewedMeta(viewIntel, status.id)
  const follow = followUpMeta(c)
  const phone = c.phone || c.fh_clients?.phone || ''
  const est = money(c.amount)
  const isLost = c.stage === 'lost'

  const swipeActions: Array<{
    icon: ReactNode
    label: string
    color: string
    fg: string
    onClick: () => void
  }> = []
  if (phone) {
    swipeActions.push({
      icon: <PhoneIcon size={18} />,
      label: `Call ${c.name || 'lead'}`,
      color: 'rgba(46, 204, 113, 0.22)',
      fg: 'var(--v3-success-bright)',
      onClick: () => { window.location.href = `tel:${phone}` }
    })
    swipeActions.push({
      icon: <MsgIcon size={18} />,
      label: `Text ${c.name || 'lead'}`,
      color: 'rgba(212, 175, 55, 0.18)',
      fg: 'var(--v3-primary)',
      onClick: () => { window.location.href = `sms:${phone}` }
    })
  }

  return (
    <SwipeableRow actions={swipeActions} disabled={!phone}>
      <motion.article
        className={`fh-lead-card${isLost ? ' is-lost' : ''}`}
        initial={isNew ? { opacity: 0, scale: 0.97 } : false}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, height: 0, marginBottom: -8 }}
        style={{
          position: 'relative',
          display: 'flex', flexDirection: 'column', gap: 10,
          padding: '13px 14px 12px 20px',
          borderRadius: 14,
          background: 'var(--v3-surface)',
          border: isNew
            ? '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)'
            : '1px solid var(--v3-border)',
          opacity: isLost ? 0.7 : 1,
          overflow: 'hidden'
        }}
      >
        {/* Status spine */}
        <span aria-hidden="true" style={{
          position: 'absolute', left: 0, top: 10, bottom: 10, width: 3,
          background: status.color, borderRadius: '0 3px 3px 0', pointerEvents: 'none'
        }} />

        {/* Top: name + source / value + status */}
        <button
          type="button"
          onClick={() => { hapticTap(); onOpen() }}
          style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
            background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
            textAlign: 'left', width: '100%', WebkitTapHighlightColor: 'transparent'
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 15,
              color: 'var(--v3-text)', letterSpacing: '-0.005em',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            }}>
              {c.name || 'Unnamed lead'}
            </div>
            <div style={{
              marginTop: 2, fontSize: 11.5, color: 'var(--v3-text-muted)',
              fontFamily: 'var(--font-body)', display: 'flex', gap: 6, flexWrap: 'wrap'
            }}>
              {c.referred_by && <span>via {c.referred_by}</span>}
              {c.job_type && <span>· {c.job_type}</span>}
              {!c.referred_by && !c.job_type && c.address && <span>{c.address}</span>}
            </div>
          </div>
          <div style={{ flexShrink: 0, textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            {est && (
              <span style={{
                fontFamily: 'var(--font-display)', fontSize: 17, lineHeight: 1,
                color: 'var(--v3-text)', fontVariantNumeric: 'tabular-nums'
              }}>
                {est}
              </span>
            )}
            <span style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '2px 8px', borderRadius: 999,
              background: `color-mix(in srgb, ${status.color} 12%, transparent)`,
              border: `1px solid color-mix(in srgb, ${status.color} 35%, transparent)`,
              color: status.color,
              fontSize: 9, fontWeight: 700, letterSpacing: '0.14em',
              textTransform: 'uppercase', lineHeight: 1.4
            }}>
              {status.label}
            </span>
          </div>
        </button>

        {/* Viewed-intel chip — only on quote-sent leads */}
        {viewed && !isLost && (
          <div>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 9px', borderRadius: 999,
              background: viewed.tone === 'warn'
                ? 'var(--v3-primary-soft, rgba(228,190,111,0.12))'
                : 'var(--v3-surface-2)',
              border: viewed.tone === 'warn'
                ? '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)'
                : '1px solid var(--v3-border)',
              color: viewed.tone === 'warn' ? 'var(--v3-primary)' : 'var(--v3-text-muted)',
              fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
              letterSpacing: '0.08em', textTransform: 'uppercase', lineHeight: 1.4
            }}>
              <Eye size={10} aria-hidden="true" />
              {viewed.label}
            </span>
          </div>
        )}

        {/* Follow-up chip */}
        {follow && !isLost && (
          <div>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 9px', borderRadius: 999,
              background: follow.tone === 'danger'
                ? 'var(--v3-danger-soft, rgba(232,90,87,0.12))'
                : follow.tone === 'warn'
                  ? 'var(--v3-primary-soft, rgba(228,190,111,0.12))'
                  : 'var(--v3-surface-2)',
              border: follow.tone === 'danger'
                ? '1px solid color-mix(in srgb, var(--v3-danger) 40%, transparent)'
                : follow.tone === 'warn'
                  ? '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)'
                  : '1px solid var(--v3-border)',
              color: follow.tone === 'danger'
                ? 'var(--v3-danger-bright)'
                : follow.tone === 'warn'
                  ? 'var(--v3-primary)'
                  : 'var(--v3-text-muted)',
              fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
              letterSpacing: '0.08em', textTransform: 'uppercase', lineHeight: 1.4
            }}>
              <CalendarClock size={10} aria-hidden="true" />
              {follow.label}
            </span>
          </div>
        )}

        {/* Action row */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {isLost ? (
            <LeadAction onClick={onReopen} disabled={busy}>
              Reopen
            </LeadAction>
          ) : (
            <>
              <LeadAction onClick={onQuote} disabled={busy}>
                <FileText size={12} aria-hidden="true" />
                {c.stage === 'quote' ? 'Open quote' : 'Build quote'}
              </LeadAction>
              <LeadAction onClick={onWon} disabled={busy} primary>
                <Trophy size={12} aria-hidden="true" />
                {busy ? 'Working…' : 'Won'}
              </LeadAction>
            </>
          )}
          <div style={{ marginLeft: 'auto' }}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More lead actions"
                  style={{
                    width: 34, height: 34, borderRadius: 8,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: 'transparent', border: '1px solid var(--v3-border)',
                    color: 'var(--v3-text-muted)', cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent'
                  }}
                >
                  <MoreHorizontal size={15} aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="bottom" align="end" sideOffset={6} collisionPadding={20}>
                <DropdownMenuItem onSelect={() => onFollowUp(1)}>
                  <CalendarClock size={13} /> Follow up tomorrow
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onFollowUp(3)}>
                  <CalendarClock size={13} /> Follow up in 3 days
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onFollowUp(7)}>
                  <CalendarClock size={13} /> Follow up next week
                </DropdownMenuItem>
                {c.follow_up_on && (
                  <DropdownMenuItem onSelect={() => onFollowUp(null)}>
                    Clear follow-up
                  </DropdownMenuItem>
                )}
                {!isLost && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={onLost}>
                      <XCircle size={13} /> Mark lost
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </motion.article>
    </SwipeableRow>
  )
}

type LeadActionProps = {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  primary?: boolean
}

function LeadAction({ children, onClick, disabled, primary }: LeadActionProps) {
  return (
    <button
      type="button"
      onClick={() => { hapticTap(); onClick?.() }}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '9px 13px', minHeight: 36, borderRadius: 9,
        border: primary
          ? '1px solid color-mix(in srgb, var(--v3-primary) 60%, transparent)'
          : '1px solid var(--v3-border-strong)',
        background: primary
          ? 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)'
          : 'var(--v3-surface-2)',
        color: primary ? 'var(--v3-on-primary)' : 'var(--v3-text)',
        fontFamily: 'var(--font-body)', fontSize: 12,
        fontWeight: primary ? 700 : 600,
        letterSpacing: primary ? '0.03em' : 0,
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        WebkitTapHighlightColor: 'transparent'
      }}
    >
      {children}
    </button>
  )
}
