import { lazy, Suspense, useState, useMemo, useEffect, useRef } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'framer-motion'
import { XCircle, ArrowRight } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useMembership } from '../../contexts/MembershipContext.tsx'
import { supabase } from '../../lib/supabase.ts'
import { markLost, startQuote, reopen } from '../../lib/pipeline.ts'
import { stageColor, margin } from '../../lib/stages.ts'
import { toastSuccess, toastError } from '../../lib/toast.ts'
import { hapticTap, hapticError } from '../../lib/haptics.ts'
import { SkeletonBlock as SkeletonBlock_, SkeletonList as SkeletonList_ } from '../../components/Skeleton.tsx'
const SkeletonBlock = SkeletonBlock_ as any
const SkeletonList = SkeletonList_ as any
import ActionSheet from '../../components/ActionSheet.tsx'
import AddEventSheet from '../../components/AddEventSheet.tsx'
import InvitePartnerSheet from '../../components/InvitePartnerSheet.tsx'
import DataErrorState from '../../components/DataErrorState.tsx'
import { useConfirm } from '../../components/ConfirmSheet.tsx'
// Lazy, sheets only mount on operator action (Mark Complete /
// Record Payment respectively).
const MarkCompleteSheet = lazy(() => import('../../components/MarkCompleteSheet.tsx'))
const V3PaymentSheet = lazy(() => import('../../components/V3PaymentSheet.tsx'))
const SendInvoiceSheet = lazy(() => import('../../components/SendInvoiceSheet.tsx'))
import { Eyebrow } from '../../components/v3'
import { tabPanelProps } from '../../lib/tabs.ts'
import { useJobData } from './hooks/useJobData.ts'
import { computeJobHealth } from './lib/jobHealth.ts'
import { tabsForStage, resolveTabForStage } from './lib/stageWorkspace.ts'
import { tabsForRole, pickVisibleTab } from './lib/jobAccess.ts'
import OverviewTab from './tabs/Overview.tsx'
// Lazy, non-default tabs + sections + ApproveQuoteSheet only render
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
import { useHideDock } from '../../lib/dockVisibility.ts'
import { openCapture } from '../../lib/captureAttach.ts'
import { jobMoney } from './lib/spine.ts'
import JobHeaderPhone, { JobSectionTabs, JobMoreSheet } from './phone/JobHeaderPhone.tsx'
import type { JobMoreAction } from './phone/JobHeaderPhone.tsx'
import JobActionCapsule from './phone/JobActionCapsule.tsx'
import { useJobPhotos } from './phone/SpineList.tsx'
import { saveFollowUp } from '../../lib/followUp.ts'

// Tab fallback for Suspense, replaces fallback={null}, which made tab
// taps look broken (active state animates, then blank space for the
// 100-500ms the lazy chunk takes to load). Now shows three muted bars
// so the user gets immediate "loading something" feedback the moment
// they tap.
function TabFallback() {
  return (
    <div style={{ padding: '24px 24px 0', display: 'flex', flexDirection: 'column', gap: 12 }} aria-busy="true" aria-label="Loading">
      <span style={{ width: '60%', maxWidth: 240, height: 12, borderRadius: 10, background: 'var(--v3-glass-tint-2)' }} />
      <span style={{ width: '100%', height: 60, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)', opacity: 0.55 }} />
      <span style={{ width: '100%', height: 60, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)', opacity: 0.32 }} />
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
    title: 'Follow up due',
    detail: 'Confirm scope, timing, and the next step before this deal cools off.',
    primaryLabel: 'Open overview',
    tab: 'overview',
  },
  quote_followup: {
    eyebrow: 'Quote signal',
    title: 'Quote follow up',
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
        padding: '12px 12px 12px 12px',
        borderRadius: 10,
        border: '1px solid var(--v3-border-strong)',
        background: 'linear-gradient(180deg, var(--v3-glass-tint), transparent 54%), var(--v3-surface-2)',
        boxShadow: '0 16px 40px rgba(20, 20, 20,0.18)',
      }}
    >
      <div style={{ minWidth: 0, flex: '1 1 260px', display: 'grid', gap: 4 }}>
        <Eyebrow tone="gold">{meta.eyebrow}</Eyebrow>
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
            gap: 8,
            minHeight: 36,
            padding: '8px 12px',
            borderRadius: 10,
            border: '1px solid rgba(201, 150, 58, 0.42)',
            background: 'rgba(201, 150, 58, 0.13)',
            color: 'var(--v3-primary-text)',
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
 * ContactDetail, v3 parent shell. Composes the data hook + chrome + tab router
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
  const queryClient = useQueryClient()
  const {
    contact, subs, expenses, payments, inspections, notes,
    scheduleItems, scheduleCount, todos, clientSummary,
    insurance, changeOrders, stageTransitions,
    paid, contractTotal, balance, credit, loading, isError, fetchAll, patch
  } = data
  const isDesktop = useIsDesktop()
  const confirm = useConfirm() as any

  // Role gates from lib/permissions.ts. Field roles (foreman, crew) reach
  // this screen from /work and /crew, but money stays with owner, admin
  // and manager: contract value, billing, closeout, pipeline moves. The
  // database already hides payments, invoices, change orders and quote
  // items from field roles, so showing those surfaces would only render
  // empty totals and saves that fail. Fail closed while membership
  // resolves (same trade as Work.tsx): the job hydrates from the
  // persisted cache instantly, and defaulting to money visible would
  // flash it to a crew member on every cold open.
  const membership = useMembership()
  const canSeeMoney = !membership.loading && membership.canSeeFinancials
  const canMoveMoney = !membership.loading && membership.canCreateFinancialDocs
  // Deleting a job is owner only, and only inside the viewer's own org:
  // a partner's role in their own company does not reach a job they were
  // invited to (RLS would refuse the delete anyway).
  const canDeleteJob = !membership.loading && membership.canBillOrDelete
    && (!contact?.org_id || contact.org_id === membership.orgId)
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

  // The todo "Next action" the old phone header carried lives on the
  // Overview's next action card, which uses the same resolver.
  const jobHealth = useMemo(
    () => computeJobHealth({ contact, payments, scheduleItems }),
    [contact, payments, scheduleItems]
  )

  // Tab state. Local state is the source of truth for the rendered
  // panel; the URL (?tab=) is a synced mirror for deep links and
  // refresh-persistence. Previously the URL was the only source :
  // audit found the Quote tab needed two clicks because the panel
  // waited on the searchParams round-trip. Local-first makes the
  // first click switch immediately; the URL catches up after.
  const tabParam = searchParams.get('tab')
  const stageTabs = tabsForStage(contact?.stage)
  // Field roles lose the money only tabs (Quote, Change orders) and get
  // Financials as an expenses only view.
  const visibleTabs = tabsForRole(TOP_TABS.filter((t) => stageTabs.includes(t.id as any)), canSeeMoney)
  // Jobber-style: a quote IS the quote. Opening a quote-stage deal lands
  // straight in the quote document instead of the Overview cockpit, so you
  // don't "open a deal, then go build a quote." Every other stage keeps
  // Overview as its home. `defaultTab` is also the param we omit from the
  // URL, so navigating to Overview on a quote sets ?tab=overview (and
  // doesn't bounce straight back to the quote).
  const defaultTab = String(contact?.stage || '').toLowerCase() === 'quote' && canSeeMoney ? 'quote' : 'overview'
  const urlTab = (tabParam && VALID_TABS.has(tabParam))
    ? resolveTabForStage(contact?.stage, tabParam)
    : defaultTab
  const [localTab, setLocalTab] = useState<string | null>(null)
  // A deep link or stale local choice can name a tab this role or stage
  // does not expose; render Overview then.
  const tab = pickVisibleTab(localTab ?? urlTab, visibleTabs)
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

  // Modals, own state, parent dispatches
  const [eventOpen, setEventOpen] = useState(false)
  const [payModalOpen, setPayModalOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteErr, setDeleteErr] = useState('')
  // Approve Quote sheet, lifted to root so the Overview NextAction CTA
  // and the Quote tab ApproveBand both open the same sheet without
  // duplicating state. Phase 4C-2.
  const [approveOpen, setApproveOpen] = useState(false)
  const [completeOpen, setCompleteOpen] = useState(false)
  // Send-invoice sheet (pipeline v2), the job screen's one tap billing
  // action. Opened by the stage CTA, Overview quick action, and the
  // next-action resolver's 'sendInvoice' suggestion.
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  // Edit mode is a flag the Overview tab + section editors read.
  // Header EDIT button toggles + jumps to overview if currently on another tab.
  const [isEditing, setIsEditing] = useState(false)

  // Phone (spec 8.1 and 9.4): the page brings its own onyx action
  // capsule, so the dock steps aside while it is mounted. The header's
  // cover and count and the Spine share one photo query.
  useHideDock(!isDesktop)
  const jobPhotos = useJobPhotos(isDesktop ? null : id)
  const tabsRef = useRef<HTMLDivElement | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  // Photos the capsule's camera took, waiting for the Files tab to upload.
  const [pendingPhotos, setPendingPhotos] = useState<File[] | null>(null)
  const requestedIntent = readJobActionIntent(searchParams.get('action'))
  // Dashboard cues are billing or sales work, except a reschedule, so
  // field roles only get that one.
  const actionIntent = requestedIntent && (canMoveMoney || requestedIntent === 'reschedule')
    ? requestedIntent
    : null
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
    const resolvedTab = pickVisibleTab(resolveTabForStage(contact?.stage, actionIntentMeta.tab), visibleTabs)
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
    if (deleting || !canDeleteJob) return
    setDeleting(true)
    setDeleteErr('')
    try {
      const deletedName = contact?.name || 'this job'
      // By id only: the owner deletes any job in the org, whoever created
      // it, and RLS scopes the tenant. .select() turns a zero row delete
      // (already gone, or not allowed) into a visible failure instead of
      // a false "Deleted".
      const { data: removed, error } = await supabase
        .from('fh_contacts')
        .delete()
        .eq('id', id as string)
        .select('id')
      if (error) throw error
      if (!removed || removed.length === 0) {
        setDeleting(false)
        setDeleteErr("This job wasn't deleted. It may already be gone, or your account can't delete it.")
        return
      }
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
      <div style={{ padding: '24px', minHeight: '100%', background: 'var(--v3-bg)' }}>
        <SkeletonBlock w="40%" h={14} />
        <div style={{ height: 12 }} />
        <SkeletonBlock w="70%" h={48} />
        <div style={{ height: 24 }} />
        <SkeletonList rows={4} card={false} />
      </div>
    )
  }

  // Not found, or could not load. A failed fetch (offline, 5xx, expired
  // session) is not proof the job is gone, so it gets a retry instead of
  // "not found".
  if (!contact) {
    return (
      <div style={{ padding: '32px 24px', minHeight: '100%', background: 'var(--v3-bg)', textAlign: 'center' }}>
        <button
          type="button"
          onClick={() => navigate(routeHome)}
          style={{
            background: 'none', border: 'none', color: 'var(--v3-primary-text)',
            fontWeight: 700, fontSize: 14, cursor: 'pointer', padding: '8px 12px'
          }}
        >
          ← Back to {routeHome === '/quotes' ? 'quotes' : routeHome === '/leads' ? 'leads' : 'jobs'}
        </button>
        {isError ? (
          <div style={{ marginTop: 16, textAlign: 'left' }}>
            <DataErrorState
              title="Couldn't load this job"
              message="Check your connection and try again. Nothing was changed."
              onRetry={() => { void fetchAll() }}
            />
          </div>
        ) : (
          <p style={{ color: 'var(--v3-text-muted)', marginTop: 16 }}>Contact not found.</p>
        )}
      </div>
    )
  }

  // Phase 8, desktop dispatch. At >=900px every tab (including Quote)
  // renders through DesktopJobDetail so the back button + eyebrow +
  // tab nav stay visually consistent. The Quote tab's 2-pane workspace
  // (.v3-screen--quote-active wrapper) is preserved; DesktopJobDetail
  // hides its right context rail when tab === 'quote' so the Quote
  // builder gets full width. 5/17 chrome unification, fixes the 5/13
  // audit's "two design systems on one page" finding where switching
  // to Quote on desktop swapped the entire chrome.
  // Phone (<900px) draws the redesigned top (photo header, onyx band,
  // stage rail, money strip, quick actions), the section tabs with the
  // Spine first (decision D5) and the floating action capsule. Modals
  // stay mounted at the wrapper level so both branches can dispatch them.
  const useDesktopShell = isDesktop

  // Per-stage primary action, gives the mobile deal screen the same
  // "what do I do next at this stage" CTA the desktop shell already has
  // (DesktopJobDetail's nextActionFor). Closed/lost are terminal → null.
  // "Build quote" on a lead also transitions the stage to 'quote' so the
  // deal actually advances, otherwise clicking it just jumps tabs and
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

  // Mark lost is a sales move: money roles only, and only while the deal
  // is still a lead or quote (same rule as the Work list). A won job
  // marked lost would drop its revenue out of the won totals.
  const canMarkLost = canMoveMoney && (contact.stage === 'lead' || contact.stage === 'quote')
  async function onMarkLost() {
    if (!contact || !canMarkLost) return
    const ok = await confirm({
      title: 'Mark this deal lost?',
      body: 'It moves to the lost column. You can reopen it later as a lead.',
      confirmLabel: 'Mark lost',
      destructive: true
    })
    if (!ok) return
    hapticError()
    // pipeline.markLost toasts on success; only the failure needs one.
    const res: any = await markLost(contact)
    if (res?.error) {
      toastError("Couldn't mark lost", res.error.message || 'Try again')
      return
    }
    fetchAll()
  }

  // Job-stage CTA: the user's #1 ask, invoice straight from the job.
  // While money is still owed the primary action is Send invoice; once
  // the balance is collected the job is ready for its closeout.
  // ('invoice' is the legacy alias of 'job', same treatment.) Every one
  // of these is a pipeline or billing move, so field roles get none.
  const stageCta: { label: string; onClick: () => void } | null =
    !canMoveMoney ? null
    : contact.stage === 'lead'    ? { label: 'Convert to quote', onClick: onBuildQuote }
    : contact.stage === 'quote'
      ? contact.proposal_status === 'changes_requested'
        ? { label: 'Review changes', onClick: () => setTab('quote') }
        : { label: 'Approve quote', onClick: () => setApproveOpen(true) }
    : contact.stage === 'job' || contact.stage === 'invoice'
      ? (Number(balance || 0) > 0
          ? { label: 'Send invoice',   onClick: () => setInvoiceOpen(true) }
          : { label: 'Mark complete',  onClick: () => setCompleteOpen(true) })
    : contact.stage === 'closed'  ? { label: 'Reopen',         onClick: onReopen }
    : contact.stage === 'lost'    ? { label: 'Reopen',         onClick: onReopen }
    : null

  // Phone money strip: contract, paid, balance and the margin chip, for
  // money roles only and once there is money on the job. Margin needs a
  // recorded cost; without one there is no chip rather than a false 100%.
  const phoneMoney = canSeeMoney && (Number(contractTotal || 0) > 0 || Number(paid || 0) > 0)
    ? jobMoney({
        contractTotal: Number(contractTotal || 0),
        paid: Number(paid || 0),
        balance: Number(balance || 0),
        marginPct: Number(contact.cost || 0) > 0 && Number(contact.amount || 0) > 0 ? margin(contact) : null
      })
    : null

  // Open a section from the header (the photo count, Photos) or the
  // capsule's camera, then bring the tabs into view under the thumb.
  function openSection(next: string) {
    setTab(next)
    requestAnimationFrame(() => {
      const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      tabsRef.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
    })
  }

  // The more button's sheet carries what the old header row and menu
  // did: edit, the linked client, schedule, partner, mark lost, delete.
  const isOwnerView = !!user?.id && contact.user_id === user.id
  const moreActions: JobMoreAction[] = [
    { id: 'edit', label: isEditing ? 'Stop editing' : 'Edit job details', onSelect: handleEditClick },
    ...(isOwnerView && contact.client_id
      ? [{ id: 'client', label: 'Open the client', subline: clientSummary?.name || undefined, onSelect: () => navigate(`/clients/${contact.client_id}`) }]
      : []),
    { id: 'event', label: 'Schedule an event', onSelect: () => setEventOpen(true) },
    { id: 'partner', label: 'Invite a partner', onSelect: () => setInviteOpen(true) },
    ...(canMarkLost ? [{ id: 'lost', label: 'Mark lost', onSelect: () => { void onMarkLost() } }] : [])
  ]

  // Tab router, rendered once and placed in either shell. The desktop
  // and mobile branches used to carry their own copies, and the desktop
  // copy drifted: Overview lost changeOrders (cockpit read "Paid in full"
  // while approved CO money was owed), stageTransitions (activity) and
  // onOpenMarkComplete (a dead Mark complete button), and Quote, Details
  // and Financials lost their insurance and change order data.
  const tabPanels = (
    <>
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
          canSeeMoney={canSeeMoney}
          canMoveMoney={canMoveMoney}
          onExitEdit={() => setIsEditing(false)}
          onOpenAddEvent={() => setEventOpen(true)}
          onOpenLogPayment={() => setPayModalOpen(true)}
          onOpenInvitePartner={() => setInviteOpen(true)}
          onOpenApproveQuote={() => setApproveOpen(true)}
          onOpenMarkComplete={() => setCompleteOpen(true)}
          onOpenSendInvoice={() => setInvoiceOpen(true)}
          onOpenQuote={() => setTab('quote')}
          spineFirst={!isDesktop}
          inspections={inspections}
          onAddToSpine={() => openCapture({ jobId: contact.id })}
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
            canSeeMoney={canSeeMoney}
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
            canSeeMoney={canSeeMoney}
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
            incomingPhotos={pendingPhotos}
            onIncomingPhotosHandled={() => setPendingPhotos(null)}
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
    </>
  )

  return (
    <div
      className={`v3-screen v3-screen--job-detail${tab === 'quote' ? ' v3-screen--quote-active' : ''}`}
      style={{ position: 'relative' }}
    >
      {useDesktopShell ? (
        (() => {
          // Compute truthful rail signals, null when there's no
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
          // Reports / billing, render "Not tracked" rather than fake numbers.
          const reportsMissing: number | null = null
          const billingStatus: { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } | null =
            Number(credit || 0) > 0.5
              ? { label: `${money(credit)} credit due`, tone: 'warn' }
            : (payments || []).length === 0 && Number(contact.amount || 0) === 0
              ? null
              : Number(balance || 0) > 0
                ? { label: 'Outstanding', tone: 'warn' }
                : Number(paid || 0) > 0
                  ? { label: 'Paid', tone: 'good' }
                  : { label: 'Not started', tone: 'neutral' }

          // Change order totals for the rail card. Sum approved
          // separately from pending so the rail can flag in-flight
          // amendments without lumping them into approved revenue.
          // Negative amounts are credits, they net into the totals
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
              // The shell reads Contract straight off contact.amount, so
              // field roles get a copy without it (the metric stays blank).
              contact={canSeeMoney ? contact : { ...contact, amount: null }}
              client={clientSummary}
              tabs={visibleTabs}
              activeTab={tab}
              onTabChange={setTab}
              onBack={() => navigate(detailHome)}
              backLabel={detailBackLabel}
              onEdit={handleEditClick}
              onDelete={canDeleteJob ? () => setDeleteOpen(true) : undefined}
              onAddEvent={() => setEventOpen(true)}
              primaryAction={tab === 'overview' ? null : stageCta}
              isEditing={isEditing}
              scheduleStatus={scheduleStatus}
              reportsMissing={reportsMissing}
              billingStatus={canSeeMoney ? billingStatus : null}
              health={jobHealth}
              changeOrderTotals={canSeeMoney ? changeOrderTotals : null}
              paid={canSeeMoney ? paid : null}
              outstanding={canSeeMoney ? balance : null}
              showMoney={canSeeMoney}
            >
              {actionIntentMeta && (
                <ActionIntentBanner
                  meta={actionIntentMeta}
                  onPrimary={handleActionIntentPrimary}
                  onDismiss={() => clearActionIntent()}
                />
              )}
              {tabPanels}
            </SnowJobDetailBuild></Suspense>
          )
        })()
      ) : (
      <div className="fhj-page">
        <JobHeaderPhone
          contact={contact}
          photos={jobPhotos}
          money={phoneMoney}
          backLabel={detailBackLabel}
          onBack={() => navigate(detailHome)}
          onMore={() => setMoreOpen(true)}
          onOpenPhotos={() => openSection('files')}
        />

        {actionIntentMeta && (
          <div style={{ padding: '16px 20px 0' }}>
            <ActionIntentBanner
              meta={actionIntentMeta}
              onPrimary={handleActionIntentPrimary}
              onDismiss={() => clearActionIntent()}
            />
          </div>
        )}

        {/* Sections as text tabs, Overview reads Spine (decision D5) */}
        <JobSectionTabs
          ref={tabsRef}
          tabs={visibleTabs}
          value={tab}
          onChange={setTab}
          idBase="fh-job-tabs"
        />

        <div {...tabPanelProps('fh-job-tabs', tab)}>
          {tabPanels}
        </div>

        {/* The Quote tab brings its own capsule (the total variant, from
            phone/QuotePhone.tsx), so this one steps aside there. Every
            other tab keeps the actions capsule. */}
        {tab !== 'quote' && (
          <JobActionCapsule
            action={stageCta}
            onPhotos={(files) => { setPendingPhotos(files); openSection('files') }}
            onVoice={() => openCapture({ jobId: contact.id })}
          />
        )}

        <JobMoreSheet
          open={moreOpen}
          onOpenChange={setMoreOpen}
          title={contact.job_title || contact.name || 'This job'}
          actions={moreActions}
          followUp={contact.stage === 'lost' || contact.stage === 'closed'
            ? undefined
            : { current: contact.follow_up_on ?? null, onSet: (when) => { void saveFollowUp(queryClient, contact, user?.id, when) } }}
          onDelete={canDeleteJob ? () => setDeleteOpen(true) : undefined}
        />
      </div>
      )}

      {/* MODALS. The billing, closeout and approval sheets only mount for
          money roles, so no stray open state can surface them to crew. */}
      <AnimatePresence>
        {payModalOpen && canMoveMoney && (
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

      {canMoveMoney && (
        <>
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
        </>
      )}

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
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <DeleteCascadeRow label="Subs" count={subs.length} />
          <DeleteCascadeRow label="Expenses" count={expenses.length} />
          <DeleteCascadeRow label="Payments" count={payments.length} />
          <DeleteCascadeRow label="Inspections" count={inspections.length} />
          <DeleteCascadeRow label="Schedule items" count={scheduleCount} />
          <DeleteCascadeRow label="Notes" count={notes.length} detail="detached + archived" />
        </ul>
        <Eyebrow as="p" tone="alert" style={{ margin: 0, fontSize: 12 }}>
          This cannot be undone.
        </Eyebrow>
      </ActionSheet>
    </div>
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
      borderRadius: 10
    }}>
      <Eyebrow>
        {label}
      </Eyebrow>
      <span style={{
        fontFamily: 'var(--font-body)',
        fontSize: 14,
        color: 'var(--v3-text)',
        fontVariantNumeric: 'tabular-nums'
      }}>
        {count} <span style={{ color: 'var(--v3-text-muted)', marginLeft: 6 }}>· {detail}</span>
      </span>
    </li>
  )
}

