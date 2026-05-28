import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
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
import MarkCompleteSheet from '../../components/MarkCompleteSheet.tsx'
import V3PaymentSheet from '../../components/V3PaymentSheet.tsx'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { StageTimeline, SegmentedTabs, Eyebrow, StampNumber } from '../../components/v3'
import { useJobData } from './hooks/useJobData.ts'
import { resolveNextAction } from './lib/jobNextAction.ts'
import { tabsForStage, resolveTabForStage } from './lib/stageWorkspace.ts'
import OverviewTab from './tabs/Overview.tsx'
import QuoteTab from './tabs/Quote.tsx'
import DetailsTab from './tabs/Details.tsx'
import FinancialsTab from './tabs/Financials.tsx'
import FilesTab from './tabs/Files.tsx'
import DailyLogsSection from './sections/DailyLogs.tsx'
import SelectionsSection from './sections/Selections.tsx'
import MaterialsSection from './sections/Materials.tsx'
import ApproveQuoteSheet from './sections/ApproveQuoteSheet.tsx'
import SnowJobDetailBuild from '../../components/desktop/SnowJobDetailBuild.tsx'
import { useIsDesktop } from '../../lib/useMediaQuery.ts'

const TOP_TABS = [
  { id: 'overview',   label: 'Overview' },
  { id: 'quote',      label: 'Quote' },
  { id: 'details',    label: 'Details' },
  { id: 'selections', label: 'Selections' },
  { id: 'materials',  label: 'Materials' },
  { id: 'logs',       label: 'Daily logs' },
  { id: 'financials', label: 'Financials' },
  { id: 'files',      label: 'Files' }
]
const VALID_TABS = new Set(TOP_TABS.map((t) => t.id))

function money(n: any) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  })
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
  const [searchParams, setSearchParams] = useSearchParams()

  const data = useJobData(id, user?.id)
  const {
    contact, subs, expenses, payments, inspections, notes,
    scheduleItems, scheduleCount, todos, clientSummary,
    insurance, changeOrders, stageTransitions,
    paid, balance, loading, fetchAll, patch
  } = data
  const isDesktop = useIsDesktop()

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

  // URL-synced tab state. Default to overview if the param is absent,
  // invalid, or not exposed by the current stage's workspace.
  const tabParam = searchParams.get('tab')
  const stageTabs = tabsForStage(contact?.stage)
  const visibleTabs = TOP_TABS.filter((t) => stageTabs.includes(t.id as any))
  const tab = (tabParam && VALID_TABS.has(tabParam))
    ? resolveTabForStage(contact?.stage, tabParam)
    : 'overview'
  function setTab(next: any) {
    if (next === tab) return
    const sp = new URLSearchParams(searchParams)
    if (next === 'overview') sp.delete('tab')
    else sp.set('tab', next)
    setSearchParams(sp, { replace: true })
  }

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
  // Edit mode is a flag the Overview tab + section editors read.
  // Header EDIT button toggles + jumps to overview if currently on another tab.
  const [isEditing, setIsEditing] = useState(false)

  async function handleDelete() {
    if (deleting) return
    setDeleting(true)
    setDeleteErr('')
    try {
      const deletedName = contact?.name || 'this job'
      const { error } = await supabase.from('fh_contacts').delete().eq('id', id as string).eq('user_id', user?.id as string)
      if (error) throw error
      toastSuccess('Deleted', `${deletedName} and cascading rows removed`)
      navigate('/jobs')
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
          onClick={() => navigate('/jobs')}
          style={{
            background: 'none', border: 'none', color: 'var(--v3-primary)',
            fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: '8px 14px'
          }}
        >
          ← Back to jobs
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

  const stageCta: { label: string; onClick: () => void } | null =
    contact.stage === 'lead'    ? { label: 'Build quote',    onClick: onBuildQuote }
    : contact.stage === 'quote'   ? { label: 'Approve quote',  onClick: () => setApproveOpen(true) }
    : contact.stage === 'job'     ? { label: 'Mark complete',  onClick: () => setCompleteOpen(true) }
    : contact.stage === 'invoice' ? { label: 'Log payment',    onClick: () => setPayModalOpen(true) }
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

          return (
            <SnowJobDetailBuild
              contact={contact}
              client={clientSummary}
              tabs={visibleTabs}
              activeTab={tab}
              onTabChange={setTab}
              onBack={() => navigate('/jobs')}
              onEdit={handleEditClick}
              onDelete={() => setDeleteOpen(true)}
              onAddEvent={() => setEventOpen(true)}
              isEditing={isEditing}
              scheduleStatus={scheduleStatus}
              reportsMissing={reportsMissing}
              billingStatus={billingStatus}
              paid={paid}
              outstanding={balance}
            >
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
                />
              )}
              {tab === 'quote' && (
                <QuoteTab
                  contact={contact}
                  userId={user?.id}
                  fetchAll={fetchAll}
                  patch={patch}
                  onOpenApprove={() => setApproveOpen(true)}
                />
              )}
              {tab === 'details' && (
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
              )}
              {tab === 'financials' && (
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
              )}
              {tab === 'files' && (
                <FilesTab
                  contact={contact}
                  notes={notes}
                  userId={user?.id}
                  fetchAll={fetchAll}
                />
              )}
              {tab === 'logs' && (
                <DailyLogsSection jobId={contact?.id} userId={user?.id} />
              )}
              {tab === 'selections' && (
                <SelectionsSection jobId={contact?.id} userId={user?.id} clientId={contact?.client_id} />
              )}
              {tab === 'materials' && (
                <MaterialsSection jobId={contact?.id} userId={user?.id} />
              )}
            </SnowJobDetailBuild>
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
        onBack={() => navigate('/jobs')}
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
        ariaLabel="Job detail tabs"
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
          />
        )}
        {tab === 'quote' && (
          <QuoteTab
            contact={contact}
            userId={user?.id}
            fetchAll={fetchAll}
            patch={patch}
            onOpenApprove={() => setApproveOpen(true)}
            insurance={insurance}
            changeOrders={changeOrders}
          />
        )}
        {tab === 'details' && (
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
        )}
        {tab === 'financials' && (
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
        )}
        {tab === 'files' && (
          <FilesTab
            contact={contact}
            notes={notes}
            userId={user?.id}
            fetchAll={fetchAll}
          />
        )}
        {tab === 'logs' && (
          <DailyLogsSection jobId={contact?.id} userId={user?.id} />
        )}
        {tab === 'selections' && (
          <SelectionsSection jobId={contact?.id} userId={user?.id} clientId={contact?.client_id} />
        )}
        {tab === 'materials' && (
          <MaterialsSection jobId={contact?.id} userId={user?.id} />
        )}
      </div>
      </>
      )}

      {/* MODALS */}
      <AnimatePresence>
        {payModalOpen && (
          <V3PaymentSheet
            contact={contact}
            balance={balance}
            onClose={() => setPayModalOpen(false)}
            onLogged={() => { setPayModalOpen(false); fetchAll() }}
          />
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

      <MarkCompleteSheet
        open={completeOpen}
        userId={user?.id}
        contact={contact}
        onClose={() => setCompleteOpen(false)}
        onSaved={fetchAll}
      />

      <ApproveQuoteSheet
        open={approveOpen}
        contact={contact}
        userId={user?.id}
        onClose={() => setApproveOpen(false)}
        onApproved={fetchAll}
      />

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
  onBack, onEdit, onMarkLost, onDelete, onClientNav, onTodoDone
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
        <IconButton onClick={onBack} ariaLabel="Back">
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

