import { lazy, Suspense, useState, useMemo, useEffect } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, Phone, MessageSquare, Pencil, MoreHorizontal,
  XCircle, Trash2, Users, ArrowRight
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { supabase } from '../../lib/supabase.ts'
import { markLost, startQuote, reopen } from '../../lib/pipeline.ts'
import { stageColor } from '../../lib/stages.ts'
import { toastSuccess, toastInfo, toastError } from '../../lib/toast.ts'
import { hapticTap, hapticError } from '../../lib/haptics.ts'
import { dueStatus } from '../../lib/dueDate.ts'
import { SkeletonBlock as SkeletonBlock_, SkeletonList as SkeletonList_ } from '../../components/Skeleton.tsx'
const SkeletonBlock = SkeletonBlock_ as any
const SkeletonList = SkeletonList_ as any
import ActionSheet from '../../components/ActionSheet.tsx'
import AddEventSheet from '../../components/AddEventSheet.tsx'
import InvitePartnerSheet from '../../components/InvitePartnerSheet.tsx'
// Lazy — sheets only mount on operator action (Mark Complete /
// Record Payment respectively).
const MarkCompleteSheet = lazy(() => import('../../components/MarkCompleteSheet.tsx'))
const V3PaymentSheet = lazy(() => import('../../components/V3PaymentSheet.tsx'))
const SendInvoiceSheet = lazy(() => import('../../components/SendInvoiceSheet.tsx'))
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { StageTimeline, SegmentedTabs, Eyebrow, StampNumber } from '../../components/v3'
import { useJobData } from './hooks/useJobData.ts'
import { resolveNextAction } from './lib/jobNextAction.ts'
import { tabsForStage, resolveTabForStage } from './lib/stageWorkspace.ts'
import OverviewTab from './tabs/Overview.tsx'
// Lazy — non-default tabs + sections + ApproveQuoteSheet only render
// when the operator picks them. Saves ~290KB of code from the initial
// ContactDetail route chunk. Overview stays eager because it's the
// default tab (and would otherwise flash a suspense fallback on every
// detail-page open).
const QuoteTab = lazy(() => import('./tabs/Quote.tsx'))
const DetailsTab = lazy(() => import('./tabs/Details.tsx'))
const FinancialsTab = lazy(() => import('./tabs/Financials.tsx'))
const FilesTab = lazy(() => import('./tabs/Files.tsx'))
const DailyLogsSection = lazy(() => import('./sections/DailyLogs.tsx'))
const SelectionsSection = lazy(() => import('./sections/Selections.tsx'))
const MaterialsSection = lazy(() => import('./sections/Materials.tsx'))
const ChangeOrdersSection = lazy(() => import('./sections/ChangeOrdersSection.tsx'))
const ApproveQuoteSheet = lazy(() => import('./sections/ApproveQuoteSheet.tsx'))
const SnowJobDetailBuild = lazy(() => import('../../components/desktop/SnowJobDetailBuild.tsx'))
import { useIsDesktop } from '../../lib/useMediaQuery.ts'

// Tab fallback for Suspense — replaces fallback={null}, which made tab
// taps look broken (active state animates, then blank space for the
// 100-500ms the lazy chunk takes to load). Now shows three muted bars
// so the user gets immediate "loading something" feedback the moment
// they tap.
function TabFallback() {
  return (
    <div style={{ padding: '20px 20px 0', display: 'flex', flexDirection: 'column', gap: 10 }} aria-busy="true" aria-label="Loading">
      <span style={{ width: '60%', maxWidth: 240, height: 12, borderRadius: 4, background: 'rgba(255,255,255,0.07)' }} />
      <span style={{ width: '100%', height: 60, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--rule)', opacity: 0.55 }} />
      <span style={{ width: '100%', height: 60, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--rule)', opacity: 0.32 }} />
    </div>
  )
}

const TOP_TABS = [
  { id: 'overview',      label: 'Overview' },
  { id: 'quote',         label: 'Quote' },
  { id: 'details',       label: 'Details' },
  { id: 'selections',    label: 'Selections' },
  { id: 'materials',     label: 'Materials' },
  { id: 'change_orders', label: 'Change orders' },
  { id: 'logs',          label: 'Daily logs' },
  { id: 'financials',    label: 'Financials' },
  { id: 'files',         label: 'Files' }
]
const VALID_TABS = new Set(TOP_TABS.map((t) => t.id))

type JobActionIntentMeta = {
  eyebrow: string
  title: string
  detail: string
  primaryLabel: string
  tab: 'overview' | 'quote' | 'financials' | 'change_orders'
}

const JOB_ACTION_INTENTS = {
  follow_up: {
    eyebrow: 'Next action',
    title: 'Follow-up due',
    detail: 'Confirm scope, timing, and the next step before this deal cools off.',
    primaryLabel: 'Open overview',
    tab: 'overview',
  },
  quote_followup: {
    eyebrow: 'Quote signal',
    title: 'Quote follow-up',
    detail: 'This quote has gone quiet after engagement. Review the proposal before calling or messaging.',
    primaryLabel: 'Review quote',
    tab: 'quote',
  },
  reschedule: {
    eyebrow: 'Schedule risk',
    title: 'Reschedule this job',
    detail: 'The schedule signal says this job needs a new date. Add the next site event before it slips further.',
    primaryLabel: 'Schedule event',
    tab: 'overview',
  },
  send_invoice: {
    eyebrow: 'Billing action',
    title: 'Send invoice',
    detail: 'This job is ready for billing. Create or send the invoice while the work is still fresh.',
    primaryLabel: 'Send invoice',
    tab: 'financials',
  },
  nudge_invoice: {
    eyebrow: 'Collection risk',
    title: 'Invoice past due',
    detail: 'There is an open invoice past its due date. Review the balance and send the customer a reminder.',
    primaryLabel: 'Open invoice tools',
    tab: 'financials',
  },
  change_order_followup: {
    eyebrow: 'Scope control',
    title: 'Unsigned change order',
    detail: 'A sent change order is still waiting. Review it and follow up before work moves ahead.',
    primaryLabel: 'Review change orders',
    tab: 'change_orders',
  },
} as const satisfies Record<string, JobActionIntentMeta>

type JobActionIntent = keyof typeof JOB_ACTION_INTENTS

function readJobActionIntent(raw: string | null): JobActionIntent | null {
  if (!raw) return null
  return Object.prototype.hasOwnProperty.call(JOB_ACTION_INTENTS, raw)
    ? (raw as JobActionIntent)
    : null
}

function money(n: any) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  })
}

function ActionIntentBanner({
  meta,
  onPrimary,
  onDismiss,
}: {
  meta: JobActionIntentMeta
  onPrimary: () => void
  onDismiss: () => void
}) {
  return (
    <div
      role="region"
      aria-label="Dashboard action cue"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
        marginBottom: 12,
        padding: '12px 12px 12px 14px',
        borderRadius: 12,
        border: '1px solid var(--v3-border-strong)',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.035), transparent 54%), var(--v3-surface-2)',
        boxShadow: '0 16px 40px rgba(0,0,0,0.18)',
      }}
    >
      <div style={{ minWidth: 0, flex: '1 1 260px', display: 'grid', gap: 3 }}>
        <span
          style={{
            color: 'var(--v3-primary)',
            fontFamily: 'var(--font-body)',
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
          }}
        >
          {meta.eyebrow}
        </span>
        <strong style={{ color: 'var(--v3-text)', fontSize: 14, lineHeight: 1.2 }}>{meta.title}</strong>
        <span style={{ color: 'var(--v3-text-muted)', fontSize: 12, lineHeight: 1.45 }}>{meta.detail}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
        <button
          type="button"
          onClick={() => { hapticTap(); onPrimary() }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            minHeight: 36,
            padding: '8px 12px',
            borderRadius: 10,
            border: '1px solid rgba(215, 181, 109, 0.42)',
            background: 'rgba(215, 181, 109, 0.13)',
            color: 'var(--v3-primary)',
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          {meta.primaryLabel}
          <ArrowRight size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Dismiss action cue"
          onClick={() => { hapticTap(); onDismiss() }}
          style={{
            width: 36,
            height: 36,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 10,
            border: '1px solid var(--v3-border)',
            background: 'var(--v3-surface)',
            color: 'var(--v3-text-muted)',
            cursor: 'pointer',
          }}
        >
          <XCircle size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

/**
 * ContactDetail — v3 parent shell. Composes the data hook + chrome + tab router
 * + modals. Tab content lives in ./tabs/. Section CRUD lives in ./sections/.
 *
 * Tab state is URL-synced (?tab=overview|details|financials|files) so
 * notifications + emails can deep-link into a specific tab.
 */
export default function ContactDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  const data = useJobData(id, user?.id)
  const {
    contact, subs, expenses, payments, inspections, notes,
    scheduleItems, scheduleCount, todos, clientSummary,
    insurance, changeOrders, stageTransitions,
    paid, balance, loading, fetchAll, patch
  } = data
  const isDesktop = useIsDesktop()
  const routeHome = location.pathname.startsWith('/leads')
    ? '/leads'
    : location.pathname.startsWith('/quotes')
      ? '/quotes'
      : '/jobs'
  const contactStage = String(contact?.stage || '').toLowerCase()
  const detailHome = routeHome !== '/jobs'
    ? routeHome
    : contactStage === 'lead'
      ? '/leads'
      : contactStage === 'quote'
        ? '/quotes'
        : '/jobs'
  const detailBackLabel = detailHome === '/quotes' ? 'Quotes' : detailHome === '/leads' ? 'Leads' : 'Jobs'

  // Cockpit "Next action" row consumes the same due-aware resolver as
  // the Overview hero so the two never disagree (Phase 2H-5). The row's
  // "Done" button is purpose-built for fh_job_todos completion, so we
  // only surface todo-kind resolved actions here — when the resolver
  // picks a schedule/milestone/stage default the row hides and the
  // operator sees the canonical next action on the Overview tab.
  const nextAction = useMemo(
    () => resolveNextAction({ contact, scheduleItems, todos }),
    [contact, scheduleItems, todos]
  )
  const nextTodo = useMemo(() => {
    if (!nextAction || nextAction.kind !== 'todo') return null
    return {
      id: nextAction.sourceId,
      text: nextAction.title,
      due_at: nextAction.dueAt
    }
  }, [nextAction])

  async function markTodoDone(todoId: any) {
    if (!todoId || !user) return
    hapticTap()
    const { error } = await supabase
      .from('fh_job_todos')
      .update({ done: true, completed_at: new Date().toISOString() })
      .eq('id', todoId)
      .eq('user_id', user.id)
    if (error) {
      toastError("Couldn't mark done", error.message || 'Try again')
      return
    }
    toastSuccess('Done', 'Action cleared')
    fetchAll()
  }

  // Tab state. Local state is the source of truth for the rendered
  // panel; the URL (?tab=) is a synced mirror for deep links and
  // refresh-persistence. Previously the URL was the only source —
  // audit found the Quote tab needed two clicks because the panel
  // waited on the searchParams round-trip. Local-first makes the
  // first click switch immediately; the URL catches up after.
  const tabParam = searchParams.get('tab')
  const stageTabs = tabsForStage(contact?.stage)
  const visibleTabs = TOP_TABS.filter((t) => stageTabs.includes(t.id as any))
  // Jobber-style: a quote IS the quote. Opening a quote-stage deal lands
  // straight in the quote document instead of the Overview cockpit, so you
  // don't "open a deal, then go build a quote." Every other stage keeps
  // Overview as its home. `defaultTab` is also the param we omit from the
  // URL, so navigating to Overview on a quote sets ?tab=overview (and
  // doesn't bounce straight back to the quote).
  const defaultTab = String(contact?.stage || '').toLowerCase() === 'quote' ? 'quote' : 'overview'
  const urlTab = (tabParam && VALID_TABS.has(tabParam))
    ? resolveTabForStage(contact?.stage, tabParam)
    : defaultTab
  const [localTab, setLocalTab] = useState<string | null>(null)
  const tab = localTab ?? urlTab
  function setTab(next: any) {
    if (next === tab) return
    setLocalTab(next)
    const sp = new URLSearchParams(searchParams)
    if (next === defaultTab) sp.delete('tab')
    else sp.set('tab', next)
    setSearchParams(sp, { replace: true })
  }
  // External URL change (back button, deep link) resets the local
  // override so the URL wins again.
  useEffect(() => { setLocalTab(null) }, [tabParam])

  // Modals — own state, parent dispatches
  const [eventOpen, setEventOpen] = useState(false)
  const [payModalOpen, setPayModalOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteErr, setDeleteErr] = useState('')
  // Approve Quote sheet — lifted to root so the Overview NextAction CTA
  // and the Quote tab ApproveBand both open the same sheet without
  // duplicating state. Phase 4C-2.
  const [approveOpen, setApproveOpen] = useState(false)
  const [completeOpen, setCompleteOpen] = useState(false)
  // Send-invoice sheet (pipeline v2) — the job screen's one-tap billing
  // action. Opened by the stage CTA, Overview quick action, and the
  // next-action resolver's 'sendInvoice' suggestion.
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  // Edit mode is a flag the Overview tab + section editors read.
  // Header EDIT button toggles + jumps to overview if currently on another tab.
  const [isEditing, setIsEditing] = useState(false)
  const actionIntent = readJobActionIntent(searchParams.get('action'))
  const actionIntentMeta = actionIntent ? JOB_ACTION_INTENTS[actionIntent] : null

  function clearActionIntent(nextTab?: string) {
    const sp = new URLSearchParams(searchParams)
    if (nextTab) {
      if (nextTab === 'overview') sp.delete('tab')
      else sp.set('tab', nextTab)
    }
    sp.delete('action')
    setSearchParams(sp, { replace: true })
  }

  function handleActionIntentPrimary() {
    if (!actionIntent || !actionIntentMeta) return
    const resolvedTab = resolveTabForStage(contact?.stage, actionIntentMeta.tab)
    setLocalTab(resolvedTab)
    clearActionIntent(resolvedTab)

    if (actionIntent === 'reschedule') {
      setEventOpen(true)
      return
    }
    if (actionIntent === 'send_invoice' || actionIntent === 'nudge_invoice') {
      setInvoiceOpen(true)
    }
  }

  async function handleDelete() {
    if (deleting) return
    setDeleting(true)
    setDeleteErr('')
    try {
      const deletedName = contact?.name || 'this job'
      const { error } = await supabase.from('fh_contacts').delete().eq('id', id as string).eq('user_id', user?.id as string)
      if (error) throw error
      toastSuccess('Deleted', `${deletedName} and cascading rows removed`)
      navigate(detailHome)
    } catch (e: any) {
      console.error('Delete contact failed:', e)
      setDeleting(false)
      setDeleteErr("Couldn't delete this job. Check your connection and try again.")
    }
  }

  function handleEditClick() {
    // Edit form lives on Overview today; jump there first if on another tab
    // (preserves the audit-batch-X fix that "EDIT does nothing on Files").
    if (tab !== 'overview') setTab('overview')
    setIsEditing((v) => !v)
  }

  // Loading skeleton
  if (loading) {
    return (
      <div style={{ padding: '20px', minHeight: '100%', background: 'var(--v3-bg)' }}>
        <SkeletonBlock w="40%" h={14} />
        <div style={{ height: 12 }} />
        <SkeletonBlock w="70%" h={48} />
        <div style={{ height: 24 }} />
        <SkeletonList rows={4} card={false} />
      </div>
    )
  }

  // Not found
  if (!contact) {
    return (
      <div style={{ padding: '40px 20px', minHeight: '100%', background: 'var(--v3-bg)', textAlign: 'center' }}>
        <button
          type="button"
          onClick={() => navigate(routeHome)}
          style={{
            background: 'none', border: 'none', color: 'var(--v3-primary)',
            fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: '8px 14px'
          }}
        >
          ← Back to {routeHome === '/quotes' ? 'quotes' : routeHome === '/leads' ? 'leads' : 'jobs'}
        </button>
        <p style={{ color: 'var(--v3-text-muted)', marginTop: 16 }}>Contact not found.</p>
      </div>
    )
  }

  // Phase 8 — desktop dispatch. At >=900px every tab (including Quote)
  // renders through DesktopJobDetail so the back button + eyebrow +
  // tab nav stay visually consistent. The Quote tab's 2-pane workspace
  // (.v3-screen--quote-active wrapper) is preserved; DesktopJobDetail
  // hides its right context rail when tab === 'quote' so the Quote
  // builder gets full width. 5/17 chrome unification — fixes the 5/13
  // audit's "two design systems on one page" finding where switching
  // to Quote on desktop swapped the entire chrome.
  // Mobile <900px continues to use the Header + StageTimeline +
  // SegmentedTabs + tab content flow verbatim. Modals stay mounted at
  // the wrapper level so both branches can dispatch them.
  const useDesktopShell = isDesktop

  // Per-stage primary action — gives the mobile deal screen the same
  // "what do I do next at this stage" CTA the desktop shell already has
  // (DesktopJobDetail's nextActionFor). Closed/lost are terminal → null.
  // "Build quote" on a lead also transitions the stage to 'quote' so the
  // deal actually advances — otherwise clicking it just jumps tabs and
  // the lead never leaves the lead stage.
  async function onBuildQuote() {
    if (!contact) return
    const res: any = await startQuote(contact)
    if (res?.error) {
      toastError("Couldn't start quote", res.error.message || 'Try again')
      return
    }
    await fetchAll()
    setTab('quote')
  }

  async function onReopen() {
    if (!contact) return
    const res: any = await reopen(contact)
    if (res?.error) {
      toastError("Couldn't reopen", res.error.message || 'Try again')
      return
    }
    await fetchAll()
  }

  // Job-stage CTA: the user's #1 ask — invoice straight from the job.
  // While money is still owed the primary action is Send invoice; once
  // the balance is collected the job is ready for its closeout.
  // ('invoice' is the legacy alias of 'job' — same treatment.)
  const stageCta: { label: string; onClick: () => void } | null =
    contact.stage === 'lead'    ? { label: 'Convert to quote', onClick: onBuildQuote }
    : contact.stage === 'quote'   ? { label: 'Approve quote',  onClick: () => setApproveOpen(true) }
    : contact.stage === 'job' || contact.stage === 'invoice'
      ? (Number(balance || 0) > 0
          ? { label: 'Send invoice',   onClick: () => setInvoiceOpen(true) }
          : { label: 'Mark complete',  onClick: () => setCompleteOpen(true) })
    : contact.stage === 'closed'  ? { label: 'Reopen',         onClick: onReopen }
    : contact.stage === 'lost'    ? { label: 'Reopen',         onClick: onReopen }
    : null

  return (
    <div
      className={`v3-screen v3-screen--job-detail${tab === 'quote' ? ' v3-screen--quote-active' : ''}`}
      style={{ position: 'relative' }}
    >
      {useDesktopShell ? (
        (() => {
          // Compute truthful rail signals — null when there's no
          // data to honestly answer the signal.
          const today = Date.now()
          const upcoming = (scheduleItems || []).filter((e: any) => {
            const t = new Date(e.start_at || 0).getTime()
            return Number.isFinite(t) && t >= today
          })
          const past = (scheduleItems || []).filter((e: any) => {
            const t = new Date(e.start_at || 0).getTime()
            return Number.isFinite(t) && t < today
          })
          const scheduleStatus: { label: string; tone: 'good' | 'warn' | 'bad' } | null =
            (scheduleItems || []).length === 0
              ? null
              : upcoming.length === 0 && past.length > 0
                ? { label: 'No upcoming events', tone: 'warn' }
                : { label: `${upcoming.length} upcoming`, tone: 'good' }
          // Reports / billing — render "Not tracked" rather than fake numbers.
          const reportsMissing: number | null = null
          const billingStatus: { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } | null =
            (payments || []).length === 0 && Number(contact.amount || 0) === 0
              ? null
              : Number(balance || 0) > 0
                ? { label: 'Outstanding', tone: 'warn' }
                : Number(paid || 0) > 0
                  ? { label: 'Paid', tone: 'good' }
                  : { label: 'Not started', tone: 'neutral' }

          // Change-order totals for the rail card. Sum approved
          // separately from pending so the rail can flag in-flight
          // amendments without lumping them into approved revenue.
          // Negative amounts are credits — they net into the totals
          // the same way they do in the existing invoice template
          // (ChangeOrdersBlock + InvoiceBalanceBlock).
          const changeOrderTotals = (() => {
            const list = (changeOrders || []) as any[]
            if (list.length === 0) return null
            let pending = 0
            let approved = 0
            for (const co of list) {
              const amt = Number(co.amount || 0)
              if (co.status === 'approved') approved += amt
              else if (co.status === 'draft' || co.status === 'sent') pending += amt
            }
            return {
              count: list.length,
              pending,
              approved,
              total: pending + approved,
            }
          })()

          return (
            <Suspense fallback={null}><SnowJobDetailBuild
              contact={contact}
              client={clientSummary}
              tabs={visibleTabs}
              activeTab={tab}
              onTabChange={setTab}
              onBack={() => navigate(detailHome)}
              backLabel={detailBackLabel}
              onEdit={handleEditClick}
              onDelete={() => setDeleteOpen(true)}
              onAddEvent={() => setEventOpen(true)}
              isEditing={isEditing}
              scheduleStatus={scheduleStatus}
              reportsMissing={reportsMissing}
              billingStatus={billingStatus}
              changeOrderTotals={changeOrderTotals}
              paid={paid}
              outstanding={balance}
            >
              {actionIntentMeta && (
                <ActionIntentBanner
                  meta={actionIntentMeta}
                  onPrimary={handleActionIntentPrimary}
                  onDismiss={() => clearActionIntent()}
                />
              )}
              {tab === 'overview' && (
                <OverviewTab
                  contact={contact}
                  notes={notes}
                  payments={payments}
                  scheduleItems={scheduleItems}
                  todos={todos}
                  paid={paid}
                  balance={balance}
                  userId={user?.id}
                  fetchAll={fetchAll}
                  patch={patch}
                  isEditing={isEditing}
                  onExitEdit={() => setIsEditing(false)}
                  onOpenAddEvent={() => setEventOpen(true)}
                  onOpenLogPayment={() => setPayModalOpen(true)}
                  onOpenInvitePartner={() => setInviteOpen(true)}
                  onOpenApproveQuote={() => setApproveOpen(true)}
                  onOpenSendInvoice={() => setInvoiceOpen(true)}
                  onOpenQuote={() => setTab('quote')}
                />
              )}
              {tab === 'quote' && (
                <Suspense fallback={<TabFallback />}>
                  <QuoteTab
                    contact={contact}
                    userId={user?.id}
                    fetchAll={fetchAll}
                    patch={patch}
                    onOpenApprove={() => setApproveOpen(true)}
                  />
                </Suspense>
              )}
              {tab === 'details' && (
                <Suspense fallback={<TabFallback />}>
                  <DetailsTab
                    contact={contact}
                    inspections={inspections}
                    scheduleItems={scheduleItems}
                    userId={user?.id}
                    fetchAll={fetchAll}
                    patch={patch}
                    onOpenAddEvent={() => setEventOpen(true)}
                    onOpenInvitePartner={() => setInviteOpen(true)}
                  />
                </Suspense>
              )}
              {tab === 'financials' && (
                <Suspense fallback={<TabFallback />}>
                  <FinancialsTab
                    contact={contact}
                    subs={subs}
                    expenses={expenses}
                    payments={payments}
                    paid={paid}
                    balance={balance}
                    userId={user?.id}
                    fetchAll={fetchAll}
                    onOpenLogPayment={() => setPayModalOpen(true)}
                  />
                </Suspense>
              )}
              {tab === 'files' && (
                <Suspense fallback={<TabFallback />}>
                  <FilesTab
                    contact={contact}
                    notes={notes}
                    userId={user?.id}
                    fetchAll={fetchAll}
                  />
                </Suspense>
              )}
              {tab === 'logs' && (
                <Suspense fallback={<TabFallback />}>
                  <DailyLogsSection jobId={contact?.id} userId={user?.id} />
                </Suspense>
              )}
              {tab === 'selections' && (
                <Suspense fallback={<TabFallback />}>
                  <SelectionsSection jobId={contact?.id} userId={user?.id} clientId={contact?.client_id} />
                </Suspense>
              )}
              {tab === 'materials' && (
                <Suspense fallback={<TabFallback />}>
                  <MaterialsSection jobId={contact?.id} userId={user?.id} />
                </Suspense>
              )}
              {tab === 'change_orders' && (
                <Suspense fallback={<TabFallback />}>
                  <ChangeOrdersSection
                    contact={contact}
                    userId={user?.id}
                    changeOrders={changeOrders}
                    onChange={() => fetchAll?.()}
                  />
                </Suspense>
              )}
            </SnowJobDetailBuild></Suspense>
          )
        })()
      ) : (
      <>
      {/* HEADER — back / title / more, then action row, then stage timeline */}
      <Header
        contact={contact}
        clientSummary={clientSummary}
        viewerUserId={user?.id}
        isEditing={isEditing}
        paid={paid}
        balance={balance}
        nextTodo={nextTodo}
        onBack={() => navigate(detailHome)}
        backLabel={detailBackLabel}
        onEdit={handleEditClick}
        onMarkLost={async () => {
          hapticError()
          await markLost(contact)
          toastInfo('Marked lost', 'Moved to lost column')
          fetchAll()
        }}
        onDelete={() => setDeleteOpen(true)}
        onClientNav={(cid: any) => navigate(`/clients/${cid}`)}
        onTodoDone={markTodoDone}
      />

      <StageTimeline currentStage={contact.stage ?? undefined} />

      {actionIntentMeta && (
        <div style={{ padding: '0 20px 8px' }}>
          <ActionIntentBanner
            meta={actionIntentMeta}
            onPrimary={handleActionIntentPrimary}
            onDismiss={() => clearActionIntent()}
          />
        </div>
      )}

      {/* STAGE PRIMARY ACTION — one clear next step per stage */}
      {stageCta && (
        <div style={{ padding: '4px 20px 8px' }}>
          <motion.button
            type="button"
            whileTap={{ scale: 0.99 }}
            onClick={() => { hapticTap(); stageCta.onClick() }}
            style={{
              width: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '12px 16px', borderRadius: 12, border: 'none',
              background: 'var(--v3-primary)', color: 'var(--v3-on-primary)',
              fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, letterSpacing: '0.02em',
              cursor: 'pointer', boxShadow: 'var(--v3-gold-glow)',
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            {stageCta.label}
            <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
          </motion.button>
        </div>
      )}

      {/* TOP-LEVEL TABS (underline variant) */}
      <SegmentedTabs
        value={tab}
        onChange={setTab}
        tabs={visibleTabs}
        ariaLabel={`${detailBackLabel.slice(0, -1) || 'Job'} detail tabs`}
      />

      {/* TAB ROUTER */}
      <div>
        {tab === 'overview' && (
          <OverviewTab
            contact={contact}
            notes={notes}
            payments={payments}
            scheduleItems={scheduleItems}
            todos={todos}
            changeOrders={changeOrders}
            stageTransitions={stageTransitions}
            paid={paid}
            balance={balance}
            userId={user?.id}
            fetchAll={fetchAll}
            patch={patch}
            isEditing={isEditing}
            onExitEdit={() => setIsEditing(false)}
            onOpenAddEvent={() => setEventOpen(true)}
            onOpenLogPayment={() => setPayModalOpen(true)}
            onOpenInvitePartner={() => setInviteOpen(true)}
            onOpenApproveQuote={() => setApproveOpen(true)}
            onOpenMarkComplete={() => setCompleteOpen(true)}
            onOpenSendInvoice={() => setInvoiceOpen(true)}
            onOpenQuote={() => setTab('quote')}
          />
        )}
        {tab === 'quote' && (
          <Suspense fallback={<TabFallback />}>
            <QuoteTab
              contact={contact}
              userId={user?.id}
              fetchAll={fetchAll}
              patch={patch}
              onOpenApprove={() => setApproveOpen(true)}
              insurance={insurance}
              changeOrders={changeOrders}
            />
          </Suspense>
        )}
        {tab === 'details' && (
          <Suspense fallback={<TabFallback />}>
            <DetailsTab
              contact={contact}
              inspections={inspections}
              scheduleItems={scheduleItems}
              userId={user?.id}
              fetchAll={fetchAll}
              patch={patch}
              onOpenAddEvent={() => setEventOpen(true)}
              onOpenInvitePartner={() => setInviteOpen(true)}
              insurance={insurance}
            />
          </Suspense>
        )}
        {tab === 'financials' && (
          <Suspense fallback={<TabFallback />}>
            <FinancialsTab
              contact={contact}
              subs={subs}
              expenses={expenses}
              payments={payments}
              paid={paid}
              balance={balance}
              userId={user?.id}
              fetchAll={fetchAll}
              patch={patch}
              onOpenLogPayment={() => setPayModalOpen(true)}
              insurance={insurance}
              changeOrders={changeOrders}
            />
          </Suspense>
        )}
        {tab === 'files' && (
          <Suspense fallback={<TabFallback />}>
            <FilesTab
              contact={contact}
              notes={notes}
              userId={user?.id}
              fetchAll={fetchAll}
            />
          </Suspense>
        )}
        {tab === 'logs' && (
          <Suspense fallback={<TabFallback />}>
            <DailyLogsSection jobId={contact?.id} userId={user?.id} />
          </Suspense>
        )}
        {tab === 'selections' && (
          <Suspense fallback={<TabFallback />}>
            <SelectionsSection jobId={contact?.id} userId={user?.id} clientId={contact?.client_id} />
          </Suspense>
        )}
        {tab === 'materials' && (
          <Suspense fallback={<TabFallback />}>
            <MaterialsSection jobId={contact?.id} userId={user?.id} />
          </Suspense>
        )}
        {tab === 'change_orders' && (
          <Suspense fallback={<TabFallback />}>
            <ChangeOrdersSection
              contact={contact}
              userId={user?.id}
              changeOrders={changeOrders}
              onChange={() => fetchAll?.()}
            />
          </Suspense>
        )}
      </div>
      </>
      )}

      {/* MODALS */}
      <AnimatePresence>
        {payModalOpen && (
          <Suspense fallback={null}>
            <V3PaymentSheet
              contact={contact}
              balance={balance}
              onClose={() => setPayModalOpen(false)}
              onLogged={() => { setPayModalOpen(false); fetchAll() }}
            />
          </Suspense>
        )}
      </AnimatePresence>

      <AddEventSheet
        open={eventOpen}
        userId={user?.id}
        defaultContactId={contact.id}
        onClose={() => setEventOpen(false)}
        onSaved={() => { setEventOpen(false); toastSuccess('Event scheduled', 'Added to schedule'); fetchAll() }}
      />

      <InvitePartnerSheet
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        contactId={contact.id}
        contactName={contact.name}
        invitedByUserId={user?.id}
      />

      <Suspense fallback={null}>
        <MarkCompleteSheet
          open={completeOpen}
          userId={user?.id}
          contact={contact}
          onClose={() => setCompleteOpen(false)}
          onSaved={fetchAll}
        />
      </Suspense>

      <Suspense fallback={null}>
        <SendInvoiceSheet
          open={invoiceOpen}
          userId={user?.id}
          contact={contact}
          payments={payments}
          changeOrders={changeOrders}
          insurance={insurance}
          onClose={() => setInvoiceOpen(false)}
          onDone={fetchAll}
        />
      </Suspense>

      <Suspense fallback={null}>
        <ApproveQuoteSheet
          open={approveOpen}
          contact={contact}
          userId={user?.id}
          onClose={() => setApproveOpen(false)}
          onApproved={fetchAll}
        />
      </Suspense>

      <ActionSheet
        open={deleteOpen}
        title="Delete this job?"
        accentWord="Delete"
        sectionLabel="Destructive"
        stepCount={1}
        currentStep={1}
        commitLabel={deleting ? 'Deleting…' : 'Yes, delete everything'}
        commitBusy={deleting}
        commitDisabled={deleting}
        destructive
        onClose={() => { if (!deleting) { setDeleteOpen(false); setDeleteErr('') } }}
        onCommit={handleDelete}
      >
        {deleteErr && (
          <div className="fh-sheet-error" role="alert">
            <span className="fh-sheet-error__dot" aria-hidden="true" />
            <span className="fh-sheet-error__text">{deleteErr}</span>
            <button type="button" className="fh-sheet-error__dismiss" aria-label="Dismiss" onClick={() => setDeleteErr('')}>×</button>
          </div>
        )}
        <p style={{ margin: 0, color: 'var(--v3-text)', fontSize: '1rem', lineHeight: 1.45 }}>
          Removing <strong>{contact?.name || 'this job'}</strong> cascades to everything attached.
        </p>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <DeleteCascadeRow label="Subs" count={subs.length} />
          <DeleteCascadeRow label="Expenses" count={expenses.length} />
          <DeleteCascadeRow label="Payments" count={payments.length} />
          <DeleteCascadeRow label="Inspections" count={inspections.length} />
          <DeleteCascadeRow label="Schedule items" count={scheduleCount} />
          <DeleteCascadeRow label="Notes" count={notes.length} detail="detached + archived" />
        </ul>
        <p style={{
          margin: 0, color: 'var(--v3-danger-bright)', fontFamily: 'var(--font-body)',
          fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 700
        }}>
          This cannot be undone.
        </p>
      </ActionSheet>
    </div>
  )
}

/* ============================================================
   HEADER — back / title / stage / client / action row / more menu
   ============================================================ */

function Header({
  contact, clientSummary, viewerUserId, isEditing,
  paid, balance, nextTodo,
  onBack, backLabel = 'Jobs', onEdit, onMarkLost, onDelete, onClientNav, onTodoDone
}: any) {
  const isOwnerView = !!viewerUserId && contact.user_id === viewerUserId
  const phoneHref = contact.phone ? `tel:${contact.phone}` : null
  const smsHref = contact.phone ? `sms:${contact.phone}` : null

  const contractValue = Number(contact?.amount || 0)
  const showMetrics = contractValue > 0
  // Owner-view eyebrow shows the resolved client name; partner view still
  // shows the static CLIENT label so the chrome doesn't go blank when RLS
  // hides clientSummary.
  const clientLabel = contact.client_id
    ? (isOwnerView ? (clientSummary?.name || 'Client') : 'Client')
    : null

  return (
    <div style={{ padding: '8px 20px 12px' }}>
      {/* Top row: back · spacer · more */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <IconButton onClick={onBack} ariaLabel={`Back to ${String(backLabel).toLowerCase()}`}>
          <ChevronLeft size={18} aria-hidden="true" />
        </IconButton>

        {/* Action row — Call, Text, Edit, More */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {phoneHref ? (
            <PhoneAction href={phoneHref} ariaLabel={`Call ${contact.name || 'contact'}`}>
              <Phone size={16} aria-hidden="true" />
            </PhoneAction>
          ) : (
            <IconButton disabled ariaLabel="Call (no phone on file)">
              <Phone size={16} aria-hidden="true" />
            </IconButton>
          )}
          {smsHref ? (
            <PhoneAction href={smsHref} ariaLabel={`Text ${contact.name || 'contact'}`}>
              <MessageSquare size={16} aria-hidden="true" />
            </PhoneAction>
          ) : (
            <IconButton disabled ariaLabel="Text (no phone on file)">
              <MessageSquare size={16} aria-hidden="true" />
            </IconButton>
          )}
          <IconButton
            onClick={onEdit}
            ariaLabel={isEditing ? 'Stop editing' : 'Edit job'}
            ariaPressed={isEditing}
            tone={isEditing ? 'primary' : undefined}
          >
            <Pencil size={16} aria-hidden="true" />
          </IconButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="More actions"
                style={iconButtonStyle()}
              >
                <MoreHorizontal size={18} aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" sideOffset={8} collisionPadding={20}>
              <DropdownMenuItem onSelect={onMarkLost}>
                <XCircle size={14} /> Mark lost
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 size={14} /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Cockpit — eyebrow client / serif title / job_title / metrics / next action */}
      <div style={{
        padding: '12px 14px',
        borderRadius: 16,
        background: 'linear-gradient(180deg, #1b1816 0%, #121010 72%)',
        border: '1px solid var(--v3-border)',
        boxShadow: '0 1px 0 rgba(255, 240, 210, 0.06) inset, 0 1px 2px rgba(0, 0, 0, 0.40), 0 8px 22px rgba(0, 0, 0, 0.42), 0 20px 44px rgba(0, 0, 0, 0.28)'
      }}>
        {clientLabel && (isOwnerView && contact.client_id ? (
          <button
            type="button"
            onClick={() => onClientNav(contact.client_id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 6px',
              marginLeft: -6,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--v3-text-muted)',
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            <Users size={10} aria-hidden="true" />
            {clientLabel}
          </button>
        ) : (
          <Eyebrow as="span" aria-label="Shared job — client visible only to owner">
            <Users size={10} aria-hidden="true" />
            {clientLabel}
          </Eyebrow>
        ))}

        <h1 style={{
          margin: clientLabel ? '4px 0 0' : 0,
          fontSize: 'clamp(22px, 6vw, 28px)',
          lineHeight: 1.1,
          letterSpacing: '-0.015em',
          fontWeight: 600,
          color: 'var(--v3-text)'
        }}>
          {contact.name || 'Untitled'}
        </h1>
        {contact.job_title && (
          <div style={{
            marginTop: 2,
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            color: 'var(--v3-text-muted)',
            lineHeight: 1.3
          }}>
            {contact.job_title}
          </div>
        )}

        {showMetrics && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: paid > 0 ? '1fr 1fr 1fr' : '1fr',
            alignItems: 'end',
            gap: 10,
            marginTop: 10,
            paddingTop: 10,
            borderTop: '1px solid var(--v3-border)'
          }}>
            <CockpitMetric label="Value" tone="gold" size="lg">
              {kMoney(contractValue)}
            </CockpitMetric>
            {paid > 0 && (
              <>
                <CockpitMetric label="Paid" tone="success" size="md">
                  {kMoney(paid)}
                </CockpitMetric>
                <CockpitMetric label="Balance" size="md">
                  {kMoney(balance)}
                </CockpitMetric>
              </>
            )}
          </div>
        )}

        {nextTodo && (
          <div style={{
            marginTop: 10,
            padding: '8px 10px 8px 12px',
            borderRadius: 10,
            background: 'var(--v3-surface-2)',
            border: '1px solid var(--v3-border)',
            display: 'flex',
            alignItems: 'center',
            gap: 10
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Eyebrow tone="gold">Next action</Eyebrow>
              <div style={{
                marginTop: 2,
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--v3-text)',
                lineHeight: 1.3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {nextTodo.text || 'Open todo'}
              </div>
              <NextTodoDueChip iso={nextTodo.due_at} />
            </div>
            <button
              type="button"
              onClick={() => onTodoDone?.(nextTodo.id)}
              style={{
                flexShrink: 0,
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid color-mix(in srgb, var(--v3-primary) 50%, transparent)',
                background: 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
                color: 'var(--v3-on-primary)',
                fontFamily: 'var(--font-body)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                boxShadow: '0 0 0 2px rgba(228, 190, 111, 0.10), 0 3px 8px rgba(201, 150, 58, 0.16)'
              }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* Compact money formatter — $46K / $1.2M for cockpit metrics. Falls back to
   full dollars under 1k. */
function kMoney(n: any) {
  const v = Number(n || 0)
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`
  return `$${Math.round(v).toLocaleString()}`
}

function CockpitMetric({ label, tone = 'default', size = 'lg', children }: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <Eyebrow tone={tone === 'gold' ? 'gold' : 'default'}>{label}</Eyebrow>
      <StampNumber size={size} tone={tone}>{children}</StampNumber>
    </div>
  )
}

/**
 * NextTodoDueChip — read-only due-status chip rendered under the
 * cockpit Next-Action text. Returns null when iso is null/undefined
 * so rows without a due date stay clean. Tones mirror the v3 pattern:
 *   danger  → overdue
 *   warn    → today (gold)
 *   muted   → future (date label)
 */
function NextTodoDueChip({ iso }: any) {
  const status = dueStatus(iso)
  if (!status) return null
  const palette = status.tone === 'danger'
    ? {
        bg: 'var(--v3-danger-soft)',
        border: 'color-mix(in srgb, var(--v3-danger) 40%, transparent)',
        color: 'var(--v3-danger-bright)'
      }
    : status.tone === 'warn'
      ? {
          bg: 'var(--v3-primary-soft)',
          border: 'color-mix(in srgb, var(--v3-primary) 35%, transparent)',
          color: 'var(--v3-primary)'
        }
      : {
          bg: 'var(--v3-surface-2)',
          border: 'var(--v3-border)',
          color: 'var(--v3-text-muted)'
        }
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      marginTop: 4,
      padding: '2px 8px',
      borderRadius: 999,
      background: palette.bg,
      border: `1px solid ${palette.border}`,
      color: palette.color,
      fontFamily: 'var(--font-body)',
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      lineHeight: 1.4,
      whiteSpace: 'nowrap'
    }}>
      Due · {status.label}
    </span>
  )
}

/* ============================================================
   ICON BUTTONS — header chrome
   ============================================================ */

function iconButtonStyle({ disabled = false, tone }: any = {}) {
  return {
    width: 40,
    height: 40,
    borderRadius: 12,
    display: 'grid',
    placeItems: 'center',
    background: tone === 'primary' ? 'var(--v3-primary-soft)' : 'var(--v3-surface)',
    border: tone === 'primary'
      ? '1px solid color-mix(in srgb, var(--v3-primary) 45%, transparent)'
      : '1px solid var(--v3-border)',
    color: tone === 'primary' ? 'var(--v3-primary)' : disabled ? 'var(--v3-text-muted)' : 'var(--v3-text)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    WebkitTapHighlightColor: 'transparent'
  }
}

function IconButton({ children, onClick, disabled, ariaLabel, ariaPressed, tone }: any) {
  return (
    <motion.button
      type="button"
      whileTap={disabled ? undefined : { scale: 0.94 }}
      onClick={() => { if (!disabled) { hapticTap(); onClick?.() } }}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      style={iconButtonStyle({ disabled, tone })}
    >
      {children}
    </motion.button>
  )
}

/**
 * PhoneAction — plain <a> with setTimeout fallback. The audit-batch-6 fix:
 * framer-motion + Vaul drawer was eating clicks on iOS Safari for tel:/sms:.
 * Plain anchor + manual location.href fallback ensures the OS handler fires.
 */
function PhoneAction({ href, ariaLabel, children }: any) {
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation()
        hapticTap()
        if (typeof window !== 'undefined') {
          setTimeout(() => { window.location.href = href }, 0)
        }
      }}
      style={{ ...iconButtonStyle({}), textDecoration: 'none' }}
    >
      {children}
    </a>
  )
}

/* ============================================================
   DELETE CASCADE ROW (used inside the delete ActionSheet)
   ============================================================ */

function DeleteCascadeRow({ label, count, detail = 'deleted' }: any) {
  return (
    <li style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 12px',
      background: 'var(--v3-surface-2)',
      border: '1px solid var(--v3-border)',
      borderRadius: 8
    }}>
      <span style={{
        fontFamily: 'var(--font-body)',
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--v3-text-muted)',
        fontWeight: 700
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: 'var(--font-body)',
        fontSize: 13,
        color: 'var(--v3-text)',
        fontVariantNumeric: 'tabular-nums'
      }}>
        {count} <span style={{ color: 'var(--v3-text-muted)', marginLeft: 6 }}>· {detail}</span>
      </span>
    </li>
  )
}

