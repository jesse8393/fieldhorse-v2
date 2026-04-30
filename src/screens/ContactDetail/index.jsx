import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, Phone, MessageSquare, Pencil, MoreHorizontal,
  XCircle, Trash2, Users, X
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { supabase } from '../../lib/supabase.js'
import { markLost, logPayment } from '../../lib/pipeline.js'
import { stageColor } from '../../lib/stages.js'
import { toastSuccess, toastInfo, toastError } from '../../lib/toast.js'
import { hapticTap, hapticError } from '../../lib/haptics.js'
import { SkeletonBlock, SkeletonList } from '../../components/Skeleton.jsx'
import ActionSheet from '../../components/ActionSheet.jsx'
import AddEventSheet from '../../components/AddEventSheet.jsx'
import InvitePartnerSheet from '../../components/InvitePartnerSheet.jsx'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { StageTimeline, SegmentedTabs, Eyebrow, StampNumber } from '../../components/v3'
import { useJobData } from './hooks/useJobData.js'
import OverviewTab from './tabs/Overview.jsx'
import DetailsTab from './tabs/Details.jsx'
import FinancialsTab from './tabs/Financials.jsx'
import FilesTab from './tabs/Files.jsx'

const TOP_TABS = [
  { id: 'overview',   label: 'Overview' },
  { id: 'details',    label: 'Details' },
  { id: 'financials', label: 'Financials' },
  { id: 'files',      label: 'Files' }
]
const VALID_TABS = new Set(TOP_TABS.map((t) => t.id))

function money(n) {
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
    paid, balance, loading, fetchAll, patch
  } = data

  // Top open todo surfaces in the cockpit "Next action" row. Sorted by the
  // hook (done asc, created desc), so [0] is the most recent open item.
  const nextTodo = useMemo(() => (todos || []).find((t) => !t.done) || null, [todos])

  async function markTodoDone(todoId) {
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

  // URL-synced tab state. Default to overview if the param is absent or invalid.
  const tabParam = searchParams.get('tab')
  const tab = VALID_TABS.has(tabParam) ? tabParam : 'overview'
  function setTab(next) {
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
  // Edit mode is a flag the Overview tab + section editors read.
  // Header EDIT button toggles + jumps to overview if currently on another tab.
  const [isEditing, setIsEditing] = useState(false)

  async function handleDelete() {
    if (deleting) return
    setDeleting(true)
    setDeleteErr('')
    try {
      const deletedName = contact?.name || 'this job'
      const { error } = await supabase.from('fh_contacts').delete().eq('id', id).eq('user_id', user.id)
      if (error) throw error
      toastSuccess('Deleted', `${deletedName} and cascading rows removed`)
      navigate('/jobs')
    } catch (e) {
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

  return (
    <div className="v3-screen" style={{ position: 'relative' }}>
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
        onClientNav={(cid) => navigate(`/clients/${cid}`)}
        onTodoDone={markTodoDone}
      />

      <StageTimeline currentStage={contact.stage} />

      {/* TOP-LEVEL TABS (underline variant) */}
      <SegmentedTabs
        value={tab}
        onChange={setTab}
        tabs={TOP_TABS}
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
            patch={patch}
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
      </div>

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
}) {
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
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border)',
        boxShadow: '0 1px 0 rgba(255, 240, 210, 0.04) inset, 0 8px 22px rgba(0, 0, 0, 0.40)'
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
function kMoney(n) {
  const v = Number(n || 0)
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`
  return `$${Math.round(v).toLocaleString()}`
}

function CockpitMetric({ label, tone = 'default', size = 'lg', children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <Eyebrow tone={tone === 'gold' ? 'gold' : 'default'}>{label}</Eyebrow>
      <StampNumber size={size} tone={tone}>{children}</StampNumber>
    </div>
  )
}

/* ============================================================
   ICON BUTTONS — header chrome
   ============================================================ */

function iconButtonStyle({ disabled = false, tone } = {}) {
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

function IconButton({ children, onClick, disabled, ariaLabel, ariaPressed, tone }) {
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
function PhoneAction({ href, ariaLabel, children }) {
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

function DeleteCascadeRow({ label, count, detail = 'deleted' }) {
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

/* ============================================================
   V3 PAYMENT SHEET — minimal v3 surface for logging payments.
   Wraps logPayment() from pipeline.js (preserves auto-close-when-paid-in-full
   cascade + haptic + toast).
   ============================================================ */

function V3PaymentSheet({ contact, balance, onClose, onLogged }) {
  const [amount, setAmount] = useState(balance > 0 ? balance : '')
  const [method, setMethod] = useState('check')
  const [reference, setReference] = useState('')
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      await logPayment(contact, { amount, method, reference, paid_on: paidOn })
      toastSuccess('Payment logged', `${money(amount)} recorded`)
      onLogged()
    } catch (err) {
      toastError("Couldn't log payment", err?.message || 'Unknown error')
      setSaving(false)
    }
  }

  return (
    <>
      <motion.div
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(8px)', zIndex: 80
        }}
      />
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 12, opacity: 0 }}
        style={{
          position: 'fixed',
          left: 16, right: 16, bottom: 'max(16px, env(safe-area-inset-bottom))',
          maxWidth: 480, margin: '0 auto',
          background: 'var(--v3-surface-2)', borderRadius: 18,
          border: '1px solid var(--v3-border)', padding: 20, zIndex: 81,
          boxShadow: '0 24px 60px rgba(0,0,0,0.5)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{
            fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
            letterSpacing: '0.18em', textTransform: 'uppercase',
            color: 'var(--v3-primary)'
          }}>
            Log Payment
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 32, height: 32, borderRadius: 10, border: '1px solid var(--v3-border)',
              background: 'transparent', color: 'var(--v3-text-muted)', cursor: 'pointer',
              display: 'grid', placeItems: 'center'
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SheetField label="Amount">
            <input
              autoFocus
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </SheetField>
          <SheetField label="Method">
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="check">Check</option>
              <option value="card">Card</option>
              <option value="cash">Cash</option>
              <option value="ach">ACH</option>
            </select>
          </SheetField>
          {method === 'check' && (
            <SheetField label="Check number">
              <input value={reference} onChange={(e) => setReference(e.target.value)} />
            </SheetField>
          )}
          <SheetField label="Paid on">
            <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </SheetField>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1, padding: '12px', borderRadius: 12,
                background: 'transparent', border: '1px solid var(--v3-border)',
                color: 'var(--v3-text)', cursor: 'pointer',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                flex: 2, padding: '12px', borderRadius: 12,
                background: 'var(--v3-primary)', border: 'none', color: 'var(--v3-on-primary)',
                cursor: saving ? 'wait' : 'pointer',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
                letterSpacing: '0.04em',
                boxShadow: '0 8px 22px rgba(212, 175, 55, 0.32)'
              }}
            >
              {saving ? 'Saving…' : 'Log Payment'}
            </button>
          </div>
        </form>
      </motion.div>
    </>
  )
}

function SheetField({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{
        fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
        letterSpacing: '0.16em', textTransform: 'uppercase',
        color: 'var(--v3-text-muted)'
      }}>
        {label}
      </span>
      <div className="v3-sheet-field">
        {children}
      </div>
      <style>{`
        .v3-sheet-field input,
        .v3-sheet-field select {
          width: 100%;
          box-sizing: border-box;
          padding: 12px 14px;
          background: var(--v3-surface);
          border: 1px solid var(--v3-border);
          border-radius: 10px;
          color: var(--v3-text);
          font-family: var(--font-body);
          font-size: 14px;
          outline: none;
          transition: border-color 160ms ease;
        }
        .v3-sheet-field input:focus,
        .v3-sheet-field select:focus {
          border-color: var(--v3-primary);
        }
      `}</style>
    </label>
  )
}
