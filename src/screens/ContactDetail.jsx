import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, MoreHorizontal, Pencil, XCircle, Users, UserPlus, Trash2,
  Wrench, Receipt, DollarSign, ClipboardCheck, Calendar, FileText,
  ArrowRight, Check, Plus, X as XIcon, Save as SaveIcon,
  Image as ImageIcon, Paperclip, ListChecks, Download, Upload as UploadIcon,
  Clock
} from 'lucide-react'
import Icon from '../components/icons/Icon.jsx'
import ActionSheet, { SheetField, SheetChipRow, SheetMoneyField } from '../components/ActionSheet.jsx'
import AddEventSheet from '../components/AddEventSheet.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { SkeletonBlock, SkeletonList } from '../components/Skeleton.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import {
  STAGES, STAGE_MAP, ACTIVE_STAGES, stageColor, stageLabel,
  recalcCost, margin, marginTier
} from '../lib/stages.js'
import {
  startQuote, approveQuote, markComplete, markLost, reopen, logPayment
} from '../lib/pipeline.js'
import { toast, toastSuccess, toastInfo, toastUndo, toastError } from '../lib/toast.js'
import { hapticTap, hapticMedium, hapticStageChange, hapticSuccess, hapticError } from '../lib/haptics.js'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import CountUp from '../components/fx/CountUp.jsx'
import Spotlight from '../components/fx/Spotlight.jsx'
import InvitePartnerSheet from '../components/InvitePartnerSheet.jsx'

const TABS = [
  { id: 'overview',  label: 'Overview' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'subs',      label: 'Subs' },
  { id: 'expenses',  label: 'Expenses' },
  { id: 'inspections', label: 'Inspections' },
  { id: 'invoice',   label: 'Invoice' },
  { id: 'messages',  label: 'Messages' },
  { id: 'files',     label: 'Files' },
  { id: 'photos',    label: 'Photos' },
  { id: 'todos',     label: 'To-do' },
  { id: 'scheduled', label: 'Scheduled' }
]

const TRADES = [
  'Concrete', 'Framing', 'Roofing', 'Electrical', 'Plumbing',
  'HVAC', 'Insulation', 'Drywall', 'Paint'
]

function money(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  })
}

export default function ContactDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [contact, setContact] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')
  const [subs, setSubs] = useState([])
  const [expenses, setExpenses] = useState([])
  const [payments, setPayments] = useState([])
  const [inspections, setInspections] = useState([])
  const [notes, setNotes] = useState([])
  const [scheduleCount, setScheduleCount] = useState(0)

  const [payModalOpen, setPayModalOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [eventOpen, setEventOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  const [clientSummary, setClientSummary] = useState(null)

  const fetchAll = useCallback(async () => {
    if (!user || !id) return
    setLoading(true)
    const [c, s, e, p, i, n, sch] = await Promise.all([
      supabase.from('fh_contacts').select('*').eq('id', id).maybeSingle(),
      supabase.from('fh_subs').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
      supabase.from('fh_expenses').select('*').eq('contact_id', id).order('expense_date', { ascending: false }),
      supabase.from('fh_payments').select('*').eq('contact_id', id).order('paid_on', { ascending: false }),
      supabase.from('fh_inspections').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
      supabase.from('fh_notes').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
      supabase.from('fh_schedule').select('id', { count: 'exact', head: true }).eq('contact_id', id)
    ])
    const contactRow = c.data || null
    setContact(contactRow)
    setSubs(s.data || [])
    setExpenses(e.data || [])
    setPayments(p.data || [])
    setInspections(i.data || [])
    setNotes(n.data || [])
    setScheduleCount(sch.count || 0)
    // Client pill: only fetch the client row when the viewer is the owner.
    // Migration 007's fh_clients RLS denies partner reads; in partner view
    // we paint a static "CLIENT" pill with no name leak.
    const isOwnerView = contactRow && contactRow.user_id === user.id
    if (isOwnerView && contactRow.client_id) {
      const { data: cli } = await supabase
        .from('fh_clients')
        .select('id, name')
        .eq('id', contactRow.client_id)
        .maybeSingle()
      setClientSummary(cli || null)
    } else {
      setClientSummary(null)
    }
    setLoading(false)
  }, [user, id])

  useEffect(() => { fetchAll() }, [fetchAll])

  async function patch(update) {
    setContact((c) => ({ ...c, ...update }))
    const { error } = await supabase.from('fh_contacts').update(update).eq('id', id)
    if (!error) toastSuccess('Saved', 'Changes synced')
  }

  const [deleting, setDeleting] = useState(false)
  const [deleteErr, setDeleteErr] = useState('')

  async function handleDelete() {
    if (deleting) return
    setDeleting(true)
    setDeleteErr('')
    try {
      const deletedName = contact?.name || 'this job'
      const { error } = await supabase.from('fh_contacts').delete().eq('id', id)
      if (error) throw error
      toastSuccess('Deleted', `${deletedName} and cascading rows removed`)
      navigate('/jobs')
    } catch (e) {
      console.error('Delete contact failed:', e)
      setDeleting(false)
      setDeleteErr("Couldn't delete this job. Check your connection and try again.")
    }
  }

  if (loading) return (
    <div className="fh-page">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <SkeletonBlock w="40%" h={14} />
        <SkeletonBlock w="70%" h={48} />
        <SkeletonList rows={4} card={false} />
      </div>
    </div>
  )
  if (!contact) return (
    <div className="fh-page">
      <button className="fh-link" onClick={() => navigate('/jobs')}>← Back to jobs</button>
      <p>Contact not found.</p>
    </div>
  )

  const stage = STAGE_MAP[contact.stage]
  const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0)
  const balance = Math.max(0, Number(contact.amount || 0) - paid)
  const tabs = TABS.filter((t) => {
    if (t.id === 'inspections') return contact.has_inspections
    if (t.id === 'invoice') return contact.stage === 'invoice' || contact.stage === 'closed'
    return true
  })

  return (
    <section className="fh-page fh-detail">
      <div className="fh-detail__top">
        <button className="fh-iconbtn" onClick={() => navigate('/jobs')} aria-label="Back">
          <ChevronLeft size={18} />
        </button>
        <div className="fh-detail__title">
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '2px 9px',
              borderRadius: 999,
              background: `${stageColor(contact.stage)}22`,
              border: `1px solid ${stageColor(contact.stage)}44`,
              color: stageColor(contact.stage),
              fontFamily: 'var(--font-display)',
              fontSize: 11,
              fontWeight: 400,
              letterSpacing: '0.14em',
              textTransform: 'uppercase'
            }}
          >
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: stageColor(contact.stage) }} />
            {stage?.label || contact.stage}
          </span>
          {(() => {
            const full = (contact.name || 'Untitled').trim()
            const parts = full.split(/\s+/)
            const hasFirst = parts.length > 1
            const first = hasFirst ? parts.slice(0, -1).join(' ') : ''
            const last = hasFirst ? parts[parts.length - 1] : parts[0]
            return (
              <h1
                className="fh-font-serif"
                style={{ margin: '6px 0 0', fontSize: 28, lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}
              >
                {hasFirst && `${first} `}
                {last}.
              </h1>
            )
          })()}
          {/* CLIENT pill — owner: tappable link. Partner: static, no name. */}
          {contact.client_id && (
            contact.user_id === user.id
              ? (
                <button
                  type="button"
                  onClick={() => navigate(`/clients/${contact.client_id}`)}
                  style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, background: 'rgba(201,150,58,0.1)', border: '1px solid rgba(201,150,58,0.28)', color: 'var(--field-gold-bright)', fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer' }}
                >
                  <Users size={10} />
                  Client · {clientSummary?.name || '…'}
                </button>
                )
              : (
                <span
                  aria-label="Shared job — client visible only to owner"
                  style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', color: 'var(--ink-faint)', fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'default' }}
                >
                  <Users size={10} />
                  Client
                </span>
                )
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="fh-iconbtn"
              aria-label="More actions"
            >
              <MoreHorizontal size={20} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="bottom"
            align="end"
            sideOffset={8}
            collisionPadding={20}
            className="ui:min-w-[180px]"
          >
            <DropdownMenuItem
              onSelect={() => { hapticError(); markLost(contact).then(() => { toastInfo('Marked lost', 'Moved to lost column'); fetchAll() }) }}
            >
              <XCircle size={14} /> Mark lost
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setDeleteOpen(true)}
            >
              <Trash2 size={14} /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <SummaryPanel
        contact={contact}
        paid={paid}
        balance={balance}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '0 20px 12px' }}>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={() => setIsEditing((v) => !v)}
          aria-pressed={isEditing}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '11px 14px',
            borderRadius: 12,
            background: isEditing ? 'rgba(201,150,58,0.18)' : 'rgba(255,255,255,0.04)',
            border: isEditing ? '1px solid rgba(201,150,58,0.5)' : '1px solid var(--rule)',
            color: isEditing ? 'var(--field-gold-bright)' : 'var(--ink-strong)',
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            letterSpacing: '0.14em',
            cursor: 'pointer'
          }}
        >
          <Pencil size={14} />
          {isEditing ? 'EDITING' : 'EDIT'}
        </motion.button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={() => setEventOpen(true)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '11px 14px',
            borderRadius: 12,
            border: 'none',
            background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
            color: 'var(--onyx)',
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            letterSpacing: '0.14em',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(201,150,58,0.3)'
          }}
        >
          <Calendar size={14} />
          + EVENT
        </motion.button>
      </div>

      <StageActions
        contact={contact}
        onAction={async (fn) => {
          await fn(contact)
          fetchAll()
          if (fn === markComplete) toastSuccess('Job complete', 'Ready to invoice')
        }}
        onLogPayment={() => setPayModalOpen(true)}
      />

      <div className="fh-tabs-wrap">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList
            aria-label="Detail tabs"
            className="ui:flex ui:w-full ui:gap-1 ui:overflow-x-auto ui:bg-white/[0.03] ui:border ui:border-border ui:rounded-xl ui:p-1"
          >
            {tabs.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                className="ui:flex-shrink-0 ui:px-3 ui:py-1.5 ui:rounded-lg ui:text-xs ui:font-bold ui:uppercase ui:tracking-wider ui:text-muted-foreground ui:data-[state=active]:bg-white/[0.08] ui:data-[state=active]:text-foreground"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="fh-tabpanel">
        {tab === 'overview' && (
          <OverviewTab
            contact={contact}
            onPatch={patch}
            userId={user.id}
            isEditing={isEditing}
            onExitEdit={() => setIsEditing(false)}
          />
        )}
        {tab === 'milestones' && <MilestonesTab contact={contact} onPatch={patch} />}
        {tab === 'subs' && <SubsTab contact={contact} subs={subs} userId={user.id} onChange={fetchAll} />}
        {tab === 'expenses' && <ExpensesTab contact={contact} expenses={expenses} userId={user.id} onChange={fetchAll} />}
        {tab === 'inspections' && <InspectionsTab contact={contact} inspections={inspections} userId={user.id} onChange={fetchAll} />}
        {tab === 'invoice' && <InvoiceTab contact={contact} payments={payments} onLogPayment={() => setPayModalOpen(true)} />}
        {tab === 'messages' && <MessagesTab notes={notes} contactId={contact.id} userId={user.id} onChange={fetchAll} />}
        {tab === 'files' && <FilesTab jobId={contact.id} userId={user.id} />}
        {tab === 'photos' && <PhotosTab jobId={contact.id} userId={user.id} />}
        {tab === 'todos' && <TodosTab jobId={contact.id} userId={user.id} />}
        {tab === 'scheduled' && <ScheduledTab jobId={contact.id} userId={user.id} />}
      </div>

      <AnimatePresence>
        {payModalOpen && (
          <PaymentModal
            contact={contact}
            balance={balance}
            onClose={() => setPayModalOpen(false)}
            onLogged={() => { setPayModalOpen(false); fetchAll() }}
          />
        )}
      </AnimatePresence>

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
        <p style={{ margin: 0, color: 'var(--ink-strong)', fontSize: '1rem', lineHeight: 1.45 }}>
          Removing <strong>{contact?.name || 'this job'}</strong> cascades to everything attached.
        </p>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <DeleteRow label="Subs" count={subs.length} detail="deleted" />
          <DeleteRow label="Expenses" count={expenses.length} detail="deleted" />
          <DeleteRow label="Payments" count={payments.length} detail="deleted" />
          <DeleteRow label="Inspections" count={inspections.length} detail="deleted" />
          <DeleteRow label="Schedule items" count={scheduleCount} detail="deleted" />
          <DeleteRow label="Notes" count={notes.length} detail="detached + archived" />
        </ul>
        <p style={{ margin: 0, color: 'var(--alert-red)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          This cannot be undone.
        </p>
      </ActionSheet>

      <AddEventSheet
        open={eventOpen}
        userId={user.id}
        defaultContactId={contact.id}
        onClose={() => setEventOpen(false)}
        onSaved={() => { setEventOpen(false); toastSuccess('Event scheduled', 'Added to schedule') }}
      />
    </section>
  )
}

const DELETE_ROW_ICONS = {
  Subs: Wrench,
  Expenses: Receipt,
  Payments: DollarSign,
  Inspections: ClipboardCheck,
  'Schedule items': Calendar,
  Notes: FileText
}

function DeleteRow({ label, count, detail }) {
  const I = DELETE_ROW_ICONS[label]
  return (
    <li style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--rule)', borderRadius: 'var(--radius-spec)' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>
        {I && <I size={12} aria-hidden="true" />}
        {label}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink-strong)' }}>
        {count} {detail ? <span style={{ color: 'var(--ink-muted)', marginLeft: 8 }}>· {detail}</span> : null}
      </span>
    </li>
  )
}

function SummaryPanel({ contact, paid, balance }) {
  const cost = Number(contact.cost || 0)
  const milestones = Array.isArray(contact.milestones) ? contact.milestones : []
  const milestonesDone = milestones.filter((x) => x.done).length
  const pct = milestones.length ? Math.round((milestonesDone / milestones.length) * 100) : 0
  // Show em-dash until the operator has actual cost data; "100% margin on $0 cost" reads as noise.
  const hasCostData = cost > 0 || milestonesDone > 0
  const m = margin(contact)
  const tier = hasCostData ? marginTier(m) : undefined
  const marginValue = hasCostData ? `${m.toFixed(0)}%` : '—'

  return (
    <div className="fh-summary-card" style={{ position: 'relative', overflow: 'hidden' }}>
      <Spotlight style={{ top: -90, right: -90, opacity: 0.55 }} />
      <div className="fh-summary-card__row" style={{ position: 'relative', zIndex: 1 }}>
        <SumItem
          k="Amount"
          v={<CountUp to={Number(contact.amount || 0)} duration={0.9} formatter={money} />}
        />
        <SumItem k="Cost" v={money(contact.cost)} />
        <SumItem k="Margin" v={marginValue} tone={tier} />
      </div>
      {(contact.stage === 'invoice' || contact.stage === 'closed') && (
        <div className="fh-summary-card__row" style={{ position: 'relative', zIndex: 1 }}>
          <SumItem k="Paid" v={money(paid)} />
          <SumItem k="Balance" v={money(balance)} tone={balance > 0 ? 'warn' : 'good'} />
        </div>
      )}
      {milestones.length > 0 && (
        <div className="fh-progress" style={{ position: 'relative', zIndex: 1 }}>
          <div className="fh-progress__bar" style={{ width: `${pct}%` }} />
          <span className="fh-progress__label">{milestonesDone}/{milestones.length} milestones · {pct}%</span>
        </div>
      )}
    </div>
  )
}

function SumItem({ k, v, tone }) {
  return (
    <div className={`fh-sumitem${tone ? ` fh-sumitem--${tone}` : ''}`}>
      <span className="fh-sumitem__k">{k}</span>
      <span className="fh-sumitem__v">{v}</span>
    </div>
  )
}

function StageActions({ contact, onAction, onLogPayment }) {
  const stage = contact.stage
  const primaryBtn = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '11px 18px',
    borderRadius: 12,
    border: 'none',
    background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
    color: 'var(--onyx)',
    fontFamily: 'var(--font-display)',
    fontSize: 14,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    boxShadow: '0 6px 16px rgba(201,150,58,0.3)'
  }
  const ghostBtn = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    borderRadius: 12,
    border: '1px solid var(--rule)',
    background: 'rgba(255,255,255,0.04)',
    color: 'var(--ink-strong)',
    fontFamily: 'var(--font-body)',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer'
  }
  return (
    <div className="fh-stagerow">
      {stage === 'lead' && (
        <motion.button whileTap={{ scale: 0.97 }} style={primaryBtn} onClick={() => { hapticStageChange(); onAction(startQuote) }}>
          Start quote <ArrowRight size={16} />
        </motion.button>
      )}
      {stage === 'quote' && (
        <motion.button whileTap={{ scale: 0.97 }} style={primaryBtn} onClick={() => { hapticStageChange(); onAction(approveQuote) }}>
          Approve quote <Check size={16} />
        </motion.button>
      )}
      {stage === 'job' && (
        <motion.button whileTap={{ scale: 0.97 }} style={primaryBtn} onClick={() => { hapticSuccess(); onAction(markComplete) }}>
          Mark complete <Check size={16} />
        </motion.button>
      )}
      {stage === 'invoice' && (
        <motion.button whileTap={{ scale: 0.97 }} style={primaryBtn} onClick={onLogPayment}>
          Log payment <DollarSign size={16} />
        </motion.button>
      )}
      {stage === 'closed' && (
        <>
          <span className="fh-status-pill fh-status-pill--gold">Closed</span>
          <button style={ghostBtn} onClick={() => { hapticTap(); onAction(reopen) }}>
            Reopen
          </button>
        </>
      )}
      {stage === 'lost' && (
        <>
          <span className="fh-status-pill fh-status-pill--red">Lost</span>
          <button style={ghostBtn} onClick={() => { hapticTap(); onAction(reopen) }}>
            Reopen
          </button>
        </>
      )}
    </div>
  )
}

// ============================================================
// TABS
// ============================================================
const JOB_TYPES = [
  'New Construction',
  'Renovation',
  'Concrete',
  'Outdoor Living',
  'Insurance',
  'Roofing',
  'Kitchen',
  'Bath',
  'Addition'
]

function OverviewTab({ contact, onPatch, userId, isEditing, onExitEdit }) {
  const [form, setForm] = useState({ ...contact })
  const [inviteOpen, setInviteOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setForm({ ...contact }) }, [contact, isEditing])

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  async function commit() {
    const EDITABLE = ['name', 'phone', 'email', 'address', 'job_title', 'job_type', 'amount', 'referred_by', 'notes']
    const patch = {}
    for (const k of EDITABLE) {
      const next = form[k]
      const prev = contact[k]
      if ((next ?? null) !== (prev ?? null)) {
        patch[k] = next === '' ? null : (k === 'amount' ? Number(next) || 0 : next)
      }
    }
    if (Object.keys(patch).length === 0) { onExitEdit(); return }
    setSaving(true)
    await onPatch(patch)
    setSaving(false)
    onExitEdit()
  }

  function cancel() {
    setForm({ ...contact })
    onExitEdit()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {isEditing
        ? <OverviewEditForm form={form} set={set} saving={saving} onCommit={commit} onCancel={cancel} />
        : <OverviewReadCard contact={contact} />
      }

      {/* Inspections toggle — gates the Inspections tab */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--rule)' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--ink-strong)' }}>This job requires inspections</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>Enables the Inspections tab for permit-tracked trades</div>
        </div>
        <Switch
          checked={!!contact.has_inspections}
          onCheckedChange={(v) => onPatch({ has_inspections: v })}
          aria-label="Toggle inspections tab"
        />
      </div>

      {/* Partner row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--rule)', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <span
            aria-hidden="true"
            style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'rgba(201,150,58,0.12)', border: '1px solid rgba(201,150,58,0.3)', color: 'var(--field-gold-bright)' }}
          >
            <Users size={14} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--ink-strong)' }}>Partner</div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-muted)', marginTop: 2, overflowWrap: 'anywhere' }}>Share this job with someone else to co-manage</div>
          </div>
        </div>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={() => setInviteOpen(true)}
          style={{
            flexShrink: 0,
            whiteSpace: 'nowrap',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 12px',
            borderRadius: 10,
            border: 'none',
            background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
            color: 'var(--onyx)',
            fontFamily: 'var(--font-display)',
            fontSize: 11,
            letterSpacing: '0.12em',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(201,150,58,0.3)'
          }}
        >
          <UserPlus size={12} />
          INVITE
        </motion.button>
      </div>

      <InvitePartnerSheet
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        contactId={contact.id}
        contactName={contact.name || 'this job'}
        invitedByUserId={userId}
      />
    </div>
  )
}

function OverviewReadCard({ contact }) {
  const rows = [
    { label: 'Name', value: contact.name },
    { label: 'Phone', value: contact.phone },
    { label: 'Email', value: contact.email },
    { label: 'Address', value: contact.address },
    { label: 'Job title', value: contact.job_title },
    { label: 'Job type', value: contact.job_type },
    { label: 'Amount', value: contact.amount ? money(contact.amount) : '', isGold: !!contact.amount },
    { label: 'Referred by', value: contact.referred_by },
    { label: 'Notes', value: contact.notes, multiline: true }
  ]
  return (
    <div style={{ padding: '4px 14px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--rule)' }}>
      {rows.map((r, i) => (
        <div
          key={r.label}
          style={{
            display: r.multiline ? 'block' : 'grid',
            gridTemplateColumns: r.multiline ? undefined : '110px 1fr',
            gap: r.multiline ? 4 : 12,
            alignItems: 'baseline',
            padding: '12px 0',
            borderBottom: i < rows.length - 1 ? '1px solid rgba(201,150,58,0.08)' : 'none'
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>{r.label}</span>
          {r.value
            ? <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: r.isGold ? 'var(--field-gold-bright)' : 'var(--ink-strong)', fontWeight: r.isGold ? 700 : 400, wordBreak: 'break-word', whiteSpace: r.multiline ? 'pre-wrap' : 'normal' }}>{r.value}</span>
            : <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-faint)', fontStyle: 'italic' }}>Not set</span>
          }
        </div>
      ))}
    </div>
  )
}

function OverviewEditForm({ form, set, saving, onCommit, onCancel }) {
  const fieldStyle = {
    width: '100%',
    padding: '11px 14px',
    borderRadius: 12,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid var(--rule)',
    color: 'var(--ink-strong)',
    fontFamily: 'var(--font-body)',
    fontSize: 14,
    outline: 'none'
  }
  const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }
  return (
    <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--rule)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>Name</span>
          <input style={fieldStyle} value={form.name || ''} onChange={(e) => set('name', e.target.value)} placeholder="Contact name" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>Phone</span>
          <input type="tel" inputMode="tel" style={fieldStyle} value={form.phone || ''} onChange={(e) => set('phone', e.target.value)} placeholder="555-1234" />
        </label>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={labelStyle}>Email</span>
        <input type="email" inputMode="email" style={fieldStyle} value={form.email || ''} onChange={(e) => set('email', e.target.value)} placeholder="name@example.com" />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={labelStyle}>Address</span>
        <textarea rows={2} style={{ ...fieldStyle, resize: 'vertical' }} value={form.address || ''} onChange={(e) => set('address', e.target.value)} placeholder="Street, city, state" />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>Job title</span>
          <input style={fieldStyle} value={form.job_title || ''} onChange={(e) => set('job_title', e.target.value)} placeholder="Kitchen remodel" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>Job type</span>
          <select style={fieldStyle} value={form.job_type || ''} onChange={(e) => set('job_type', e.target.value)}>
            <option value="">Select…</option>
            {JOB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>Amount</span>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', fontSize: 14, pointerEvents: 'none' }}>$</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              style={{ ...fieldStyle, paddingLeft: 28 }}
              value={form.amount ?? ''}
              onChange={(e) => set('amount', e.target.value)}
              placeholder="0"
            />
          </div>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>Referred by</span>
          <input style={fieldStyle} value={form.referred_by || ''} onChange={(e) => set('referred_by', e.target.value)} placeholder="Source" />
        </label>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={labelStyle}>Notes</span>
        <textarea rows={4} style={{ ...fieldStyle, resize: 'vertical' }} value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} placeholder="Anything worth remembering…" />
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 4 }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          <XIcon size={14} />
          Cancel
        </button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={onCommit}
          disabled={saving}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '12px 14px',
            borderRadius: 12,
            border: 'none',
            background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
            color: 'var(--onyx)',
            fontFamily: 'var(--font-display)',
            fontSize: 14,
            letterSpacing: '0.14em',
            cursor: saving ? 'default' : 'pointer',
            boxShadow: '0 6px 16px rgba(201,150,58,0.3)',
            opacity: saving ? 0.6 : 1
          }}
        >
          <SaveIcon size={14} />
          {saving ? 'SAVING…' : 'SAVE'}
        </motion.button>
      </div>
    </div>
  )
}

function MilestonesTab({ contact, onPatch }) {
  const list = Array.isArray(contact.milestones) ? contact.milestones : []
  const [draft, setDraft] = useState('')
  async function toggle(i) {
    const next = list.map((m, idx) => idx === i ? { ...m, done: !m.done } : m)
    await onPatch({ milestones: next })
  }
  async function add() {
    const txt = draft.trim()
    if (!txt) return
    const next = [...list, { label: txt, done: false, created_at: new Date().toISOString() }]
    await onPatch({ milestones: next })
    setDraft('')
  }
  async function remove(i) {
    const next = list.filter((_, idx) => idx !== i)
    await onPatch({ milestones: next })
  }
  return (
    <div>
      <div className="fh-inline-add">
        <input
          placeholder="Add milestone…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
        />
        <button className="fh-btn fh-btn--ghost" onClick={add}><Icon name="plus" size={14} /> Add</button>
      </div>
      {list.length === 0 && <EmptyMini label="No milestones yet." />}
      <ul className="fh-milestones">
        {list.map((m, i) => (
          <li key={i} className={m.done ? 'is-done' : ''}>
            <button className="fh-check" onClick={() => toggle(i)} aria-label={m.done ? 'Uncheck' : 'Check'}>
              {m.done && <Icon name="check" size={14} />}
            </button>
            <span>{m.label}</span>
            <button className="fh-iconbtn fh-iconbtn--sm" onClick={() => remove(i)} aria-label="Delete">
              <Icon name="x" size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

const SUB_STATUSES = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'onsite', label: 'On site' },
  { value: 'complete', label: 'Complete' },
  { value: 'paid', label: 'Paid' }
]

function SubsTab({ contact, subs, userId, onChange }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', trade: '', phone: '', rate: '', status: 'scheduled' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) setForm({ name: '', trade: '', phone: '', rate: '', status: 'scheduled' })
  }, [open])

  const step = form.name ? (form.trade || form.rate ? 3 : 2) : 1

  async function save() {
    if (!form.name.trim()) return
    setSaving(true)
    await supabase.from('fh_subs').insert({
      user_id: userId,
      contact_id: contact.id,
      name: form.name,
      trade: form.trade || null,
      phone: form.phone || null,
      rate: Number(form.rate) || 0,
      status: form.status
    })
    await recalcCost(contact.id)
    setSaving(false)
    setOpen(false)
    onChange()
  }

  async function remove(id) {
    const snapshot = subs.find((s) => s.id === id)
    const { error } = await supabase.from('fh_subs').delete().eq('id', id)
    if (error) { toastError("Couldn't delete", error.message); return }
    await recalcCost(contact.id)
    onChange()
    toastUndo('Sub removed', {
      description: snapshot?.name || 'Tap Undo to restore',
      onUndo: async () => {
        if (!snapshot) return
        const { error: insErr } = await supabase.from('fh_subs').insert(snapshot)
        if (insErr) { toastError("Couldn't undo", insErr.message); return }
        await recalcCost(contact.id)
        onChange()
        toastSuccess('Restored', snapshot.name || '')
      }
    })
  }

  return (
    <div>
      <button className="fh-btn fh-btn--ghost" onClick={() => setOpen(true)}>
        <Icon name="plus" size={14} /> Add sub
      </button>
      <ActionSheet
        open={open}
        title="New sub on the crew."
        accentWord="sub"
        sectionLabel="New sub"
        stepCount={3}
        currentStep={step}
        commitLabel={saving ? 'Committing…' : 'Commit sub'}
        commitBusy={saving}
        commitDisabled={!form.name.trim()}
        onClose={() => setOpen(false)}
        onCommit={save}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <SheetField label="Name" code="01·NAME">
            <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Crew lead name" />
          </SheetField>
          <SheetField label="Trade" code="02·TRD">
            <input value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })} placeholder="Framer, roofer…" />
          </SheetField>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <SheetField label="Phone" code="03·PHN">
            <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </SheetField>
          <SheetField label="Rate" code="04·RATE">
            <input type="number" inputMode="decimal" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="0" />
          </SheetField>
        </div>
        <SheetChipRow
          label="Status"
          code="05·STAT"
          value={form.status}
          options={SUB_STATUSES}
          onChange={(v) => setForm({ ...form, status: v })}
        />
      </ActionSheet>
      {subs.length === 0 && (
        <EmptyState
          icon="crew"
          code="CREW · EMPTY"
          title="No subs on this job."
          sub="Add who's running each trade. Rates roll into cost + margin live."
          action="Add sub"
          onAction={() => setOpen(true)}
        />
      )}
      <ul className="fh-rows">
        {subs.map((s) => (
          <li key={s.id} className="fh-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span aria-hidden="true" style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--rule)', color: 'var(--field-gold-bright)' }}>
                <Wrench size={14} />
              </span>
              <div style={{ minWidth: 0 }}>
                <strong>{s.name}</strong>
                <span className="fh-row__sub">{s.trade || '—'} {s.phone ? ` · ${s.phone}` : ''}</span>
              </div>
            </div>
            <div className="fh-row__right">
              <span className="fh-pill">{s.status}</span>
              <strong>{money(s.rate)}</strong>
              <button className="fh-iconbtn fh-iconbtn--sm" onClick={() => remove(s.id)} aria-label="Delete">
                <Trash2 size={14} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

const EXPENSE_CATEGORIES = [
  { value: 'Materials', label: 'Materials' },
  { value: 'Fuel', label: 'Fuel' },
  { value: 'Permits', label: 'Permits' },
  { value: 'Equipment', label: 'Equipment' },
  { value: 'Other', label: 'Other' }
]

function ExpensesTab({ contact, expenses, userId, onChange }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ description: '', amount: '', category: 'Materials', expense_date: new Date().toISOString().slice(0, 10) })
  const [saving, setSaving] = useState(false)
  const total = expenses.reduce((s, e) => s + Number(e.amount || 0), 0)

  useEffect(() => {
    if (!open) {
      setForm({ description: '', amount: '', category: 'Materials', expense_date: new Date().toISOString().slice(0, 10) })
    }
  }, [open])

  const step = form.description ? (form.amount ? 3 : 2) : 1

  async function save() {
    if (!form.description.trim()) return
    setSaving(true)
    await supabase.from('fh_expenses').insert({
      user_id: userId,
      contact_id: contact.id,
      description: form.description,
      amount: Number(form.amount) || 0,
      category: form.category,
      expense_date: form.expense_date
    })
    await recalcCost(contact.id)
    setSaving(false)
    setOpen(false)
    onChange()
  }

  async function remove(id) {
    const snapshot = expenses.find((e) => e.id === id)
    const { error } = await supabase.from('fh_expenses').delete().eq('id', id)
    if (error) { toastError("Couldn't delete", error.message); return }
    await recalcCost(contact.id)
    onChange()
    toastUndo('Expense removed', {
      description: snapshot ? `${snapshot.description || 'Expense'} · $${Number(snapshot.amount || 0).toLocaleString()}` : 'Tap Undo to restore',
      onUndo: async () => {
        if (!snapshot) return
        const { error: insErr } = await supabase.from('fh_expenses').insert(snapshot)
        if (insErr) { toastError("Couldn't undo", insErr.message); return }
        await recalcCost(contact.id)
        onChange()
        toastSuccess('Restored', snapshot.description || '')
      }
    })
  }

  return (
    <div>
      <div className="fh-rowline">
        <button className="fh-btn fh-btn--ghost" onClick={() => setOpen(true)}>
          <Icon name="plus" size={14} /> Add expense
        </button>
        <span className="fh-rowline__total">Total <strong>{money(total)}</strong></span>
      </div>
      <ActionSheet
        open={open}
        title="New expense on the job."
        accentWord="expense"
        sectionLabel="New expense"
        stepCount={3}
        currentStep={step}
        commitLabel={saving ? 'Committing…' : 'Commit expense'}
        commitBusy={saving}
        commitDisabled={!form.description.trim()}
        onClose={() => setOpen(false)}
        onCommit={save}
      >
        <SheetField label="Description" code="01·DESC">
          <input
            autoFocus
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="What was purchased?"
          />
        </SheetField>
        <SheetMoneyField
          label="Amount"
          code="02·AMT"
          value={form.amount}
          onChange={(v) => setForm({ ...form, amount: v })}
        />
        <SheetChipRow
          label="Category"
          code="03·CAT"
          value={form.category}
          options={EXPENSE_CATEGORIES}
          onChange={(v) => setForm({ ...form, category: v })}
        />
        <SheetField label="Date" code="04·DT">
          <input
            type="date"
            value={form.expense_date}
            onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
          />
        </SheetField>
      </ActionSheet>
      {expenses.length === 0 && (
        <EmptyState
          icon="receipt"
          code="EXPENSES · 0"
          title="No expenses yet."
          sub="Materials, fuel, permits — log as you go so margin stays real."
          action="Add expense"
          onAction={() => setOpen(true)}
        />
      )}
      <ul className="fh-rows">
        {expenses.map((e) => (
          <li key={e.id} className="fh-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span aria-hidden="true" style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--rule)', color: 'var(--field-gold-bright)' }}>
                <Receipt size={14} />
              </span>
              <div style={{ minWidth: 0 }}>
                <strong>{e.description}</strong>
                <span className="fh-row__sub">{e.category} · {e.expense_date}</span>
              </div>
            </div>
            <div className="fh-row__right">
              <strong>{money(e.amount)}</strong>
              <button className="fh-iconbtn fh-iconbtn--sm" onClick={() => remove(e.id)} aria-label="Delete">
                <Trash2 size={14} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function InspectionsTab({ contact, inspections, userId, onChange }) {
  const byTrade = useMemo(() => {
    const map = {}
    for (const i of inspections) {
      if (!map[i.trade]) map[i.trade] = []
      map[i.trade].push(i)
    }
    return map
  }, [inspections])

  const [active, setActive] = useState(null)

  async function logResult(trade, result, notes) {
    await supabase.from('fh_inspections').insert({
      user_id: userId,
      contact_id: contact.id,
      trade,
      result,
      data: { notes: notes || '' }
    })
    setActive(null)
    onChange()
  }

  return (
    <div>
      <div className="fh-trades">
        {TRADES.map((t) => {
          const list = byTrade[t] || []
          const last = list[0]
          return (
            <button key={t} type="button" className={`fh-trade fh-trade--${last?.result || 'none'}`} onClick={() => setActive(t)}>
              <span className="fh-trade__name">{t}</span>
              <span className="fh-trade__status">{last ? last.result : 'Not yet'}</span>
              <span className="fh-trade__count">{list.length} log{list.length === 1 ? '' : 's'}</span>
            </button>
          )
        })}
      </div>
      <InspectionLog
        open={!!active}
        trade={active}
        onOpenChange={(v) => { if (!v) setActive(null) }}
        onSave={logResult}
      />
    </div>
  )
}

function InspectionLog({ open, trade, onOpenChange, onSave }) {
  const [result, setResult] = useState('pass')
  const [notes, setNotes] = useState('')
  useEffect(() => {
    if (!open) { setResult('pass'); setNotes('') }
  }, [open])
  function commit() {
    onSave(trade, result, notes)
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
            <ClipboardCheck size={12} />
            Inspection
          </div>
          <DrawerTitle asChild>
            <h2
              className="fh-font-serif"
              style={{ margin: '6px 0 0', fontSize: 'clamp(22px, 6vw, 28px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}
            >
              Log{' '}
              {trade || 'inspection'}.
            </h2>
          </DrawerTitle>
          <DrawerDescription
            style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.45 }}
          >
            Record the result and any notes from the inspector.
          </DrawerDescription>
        </DrawerHeader>

        <div style={{ padding: '6px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>Result</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {['pass', 'fail', 'na'].map((r) => {
                const on = result === r
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setResult(r)}
                    style={{
                      padding: '12px 8px',
                      borderRadius: 12,
                      border: on ? '1px solid rgba(201,150,58,0.5)' : '1px solid var(--rule)',
                      background: on ? 'rgba(201,150,58,0.14)' : 'rgba(255,255,255,0.03)',
                      color: on ? 'var(--field-gold-bright)' : 'var(--ink-strong)',
                      fontFamily: 'var(--font-display)',
                      fontSize: 13,
                      letterSpacing: '0.14em',
                      cursor: 'pointer'
                    }}
                  >
                    {r.toUpperCase()}
                  </button>
                )
              })}
            </div>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>Notes</span>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Corrections needed, re-inspection date, inspector name…"
              style={{ width: '100%', padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontSize: 14, fontFamily: 'var(--font-body)', outline: 'none', resize: 'vertical' }}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={commit}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '12px 14px',
                borderRadius: 12,
                border: 'none',
                background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
                color: 'var(--onyx)',
                fontFamily: 'var(--font-display)',
                fontSize: 14,
                letterSpacing: '0.14em',
                cursor: 'pointer',
                boxShadow: '0 6px 16px rgba(201,150,58,0.3)'
              }}
            >
              SAVE
            </motion.button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function InvoiceTab({ contact, payments, onLogPayment }) {
  const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0)
  const balance = Math.max(0, Number(contact.amount || 0) - paid)
  return (
    <div>
      <div className="fh-invoice-bar">
        <div>
          <span className="fh-eye">Balance</span>
          <strong className="fh-invoice-balance">{money(balance)}</strong>
        </div>
        <button className="fh-btn fh-btn--gold" onClick={onLogPayment}>
          <Icon name="dollar" size={16} /> Log payment
        </button>
      </div>
      {payments.length === 0 && <EmptyMini label="No payments yet." />}
      <ul className="fh-rows">
        {payments.map((p) => (
          <li key={p.id} className="fh-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span aria-hidden="true" style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'rgba(45,122,79,0.12)', border: '1px solid rgba(45,122,79,0.3)', color: 'var(--signal-green)' }}>
                <DollarSign size={14} />
              </span>
              <div style={{ minWidth: 0 }}>
                <strong>{money(p.amount)}</strong>
                <span className="fh-row__sub">{p.method}{p.reference ? ` · #${p.reference}` : ''}</span>
              </div>
            </div>
            <span className="fh-row__sub">{p.paid_on}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function MessagesTab({ notes, contactId, userId, onChange }) {
  const [draft, setDraft] = useState('')
  async function add() {
    if (!draft.trim()) return
    await supabase.from('fh_notes').insert({
      user_id: userId,
      contact_id: contactId,
      text: draft.trim(),
      category: 'note'
    })
    setDraft('')
    onChange()
  }
  return (
    <div>
      <div className="fh-inline-add">
        <input placeholder="Log a note, call, touchpoint…" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="fh-btn fh-btn--ghost" onClick={add}><Icon name="plus" size={14} /> Log</button>
      </div>
      {notes.length === 0 && (
        <EmptyState
          icon="message"
          code="HISTORY · EMPTY"
          title="No communications logged."
          sub="Every touchpoint — call, text, onsite — captured in order below."
        />
      )}
      <ul className="fh-rows">
        {notes.map((n, i) => (
          <motion.li
            key={n.id}
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.04, 0.25), duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
            className="fh-row"
          >
            <div>
              <strong>{n.text || n.action || 'Note'}</strong>
              <span className="fh-row__sub">{n.category || 'note'} · {new Date(n.created_at).toLocaleString()}</span>
            </div>
          </motion.li>
        ))}
      </ul>
    </div>
  )
}

// ============================================================
// PAYMENT MODAL
// ============================================================
function PaymentModal({ contact, balance, onClose, onLogged }) {
  const [amount, setAmount] = useState(balance)
  const [method, setMethod] = useState('check')
  const [reference, setReference] = useState('')
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    await logPayment(contact, { amount, method, reference, paid_on: paidOn })
    setSaving(false)
    toastSuccess('Payment logged', `${money(amount)} recorded`)
    onLogged()
  }

  return (
    <>
      <motion.div className="fh-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div className="fh-modal" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }}>
        <header className="fh-modal__head">
          <span className="fh-eye">Log payment</span>
          <button className="fh-iconbtn" onClick={onClose}><Icon name="x" size={18} /></button>
        </header>
        <form onSubmit={submit} className="fh-form">
          <div className="fh-grid2">
            <Field label="Amount"><input autoFocus type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label="Method">
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="check">Check</option>
                <option value="card">Card</option>
                <option value="cash">Cash</option>
                <option value="ach">ACH</option>
              </select>
            </Field>
          </div>
          {method === 'check' && (
            <Field label="Check number"><input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          )}
          <Field label="Paid on"><input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
          <div className="fh-modal__foot">
            <button type="button" className="fh-btn fh-btn--ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="fh-btn fh-btn--gold" disabled={saving}>{saving ? 'Saving…' : 'Log payment'}</button>
          </div>
        </form>
      </motion.div>
    </>
  )
}

function ConfirmModal({ title, body, confirmLabel = 'Confirm', onConfirm, onCancel }) {
  return (
    <>
      <motion.div className="fh-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCancel} />
      <motion.div className="fh-modal" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }}>
        <header className="fh-modal__head">
          <span className="fh-eye">Confirm</span>
          <button className="fh-iconbtn" onClick={onCancel}><Icon name="x" size={18} /></button>
        </header>
        <div className="fh-form">
          <h3 style={{ margin: 0 }}>{title}</h3>
          <p style={{ color: 'var(--ink-muted)' }}>{body}</p>
          <div className="fh-modal__foot">
            <button className="fh-btn fh-btn--ghost" onClick={onCancel}>Cancel</button>
            <button className="fh-btn fh-btn--danger" onClick={onConfirm}>{confirmLabel}</button>
          </div>
        </div>
      </motion.div>
    </>
  )
}

// ============================================================
// PRIMITIVES
// ============================================================
// ============================================================
// FILES TAB (Phase 17 item 4a)
// ============================================================
function FilesTab({ jobId, userId }) {
  return <UploadList jobId={jobId} userId={userId} kind="file" />
}

// ============================================================
// PHOTOS TAB (Phase 17 item 4b) — same storage/table as files, kind='photo'
// ============================================================
function PhotosTab({ jobId, userId }) {
  return <UploadList jobId={jobId} userId={userId} kind="photo" />
}

function UploadList({ jobId, userId, kind }) {
  const bucket = kind === 'photo' ? 'job-photos' : 'job-files'
  const accept = kind === 'photo' ? 'image/*' : '*/*'
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState('')
  const inputRef = useRef(null)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('fh_job_files')
      .select('*')
      .eq('job_id', jobId)
      .eq('kind', kind)
      .order('uploaded_at', { ascending: false })
    setRows(data || [])
    setLoading(false)
  }, [jobId, kind])

  useEffect(() => { fetchRows() }, [fetchRows])

  async function pick() { inputRef.current?.click() }

  async function handleFile(e) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    setUploading(true)
    try {
      for (const file of files) {
        // Basic per-file size cap: 25 MB for files, 10 MB for photos
        const cap = kind === 'photo' ? 10 * 1024 * 1024 : 25 * 1024 * 1024
        if (file.size > cap) {
          toast({ kind: 'error', title: 'File too large', body: `${file.name} exceeds ${Math.round(cap / (1024 * 1024))} MB` })
          continue
        }
        const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
        const rowId = crypto.randomUUID()
        const path = `${userId}/${jobId}/${rowId}.${ext}`
        const { error: upErr } = await supabase.storage
          .from(bucket)
          .upload(path, file, { upsert: false, contentType: file.type })
        if (upErr) throw upErr
        const { error: insErr } = await supabase.from('fh_job_files').insert({
          id: rowId,
          user_id: userId,
          job_id: jobId,
          filename: file.name,
          storage_path: path,
          mime_type: file.type || null,
          size_bytes: file.size,
          kind
        })
        if (insErr) throw insErr
      }
      toastSuccess(kind === 'photo' ? 'Photos uploaded' : 'Files uploaded', `Added ${files.length}`)
      await fetchRows()
    } catch (ex) {
      toast({ kind: 'error', title: 'Upload failed', body: ex?.message || 'Try again' })
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function remove(row) {
    if (!window.confirm(`Delete "${row.filename}"?`)) return
    try {
      await supabase.storage.from(bucket).remove([row.storage_path])
      await supabase.from('fh_job_files').delete().eq('id', row.id)
      toastSuccess('Deleted', row.filename)
      await fetchRows()
    } catch (ex) {
      toast({ kind: 'error', title: 'Delete failed', body: ex?.message || 'Try again' })
    }
  }

  async function open(row) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(row.storage_path, 60 * 60)
    if (error || !data?.signedUrl) {
      toast({ kind: 'error', title: 'Could not open', body: error?.message || 'Try again' })
      return
    }
    if (kind === 'photo') {
      setLightboxUrl(data.signedUrl)
    } else {
      window.open(data.signedUrl, '_blank', 'noopener')
    }
  }

  function fmtSize(n) {
    if (!n) return ''
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>
          {kind === 'photo' ? `${rows.length} photo${rows.length === 1 ? '' : 's'}` : `${rows.length} file${rows.length === 1 ? '' : 's'}`}
        </span>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={pick}
          disabled={uploading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))', color: 'var(--onyx)', fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: '0.12em', cursor: uploading ? 'default' : 'pointer', boxShadow: '0 4px 12px rgba(201,150,58,0.3)', opacity: uploading ? 0.6 : 1 }}
        >
          <UploadIcon size={12} />
          {uploading ? 'UPLOADING…' : (kind === 'photo' ? 'ADD PHOTOS' : 'ADD FILES')}
        </motion.button>
      </div>
      <input ref={inputRef} type="file" accept={accept} multiple hidden onChange={handleFile} />

      {loading && <SkeletonList rows={3} card={false} />}
      {!loading && rows.length === 0 && (
        <EmptyMini label={kind === 'photo' ? 'No photos yet.' : 'No files yet.'} />
      )}

      {!loading && rows.length > 0 && kind === 'photo' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {rows.map((r) => (
            <PhotoThumb key={r.id} row={r} bucket={bucket} onOpen={() => open(r)} onDelete={() => remove(r)} />
          ))}
        </div>
      )}

      {!loading && rows.length > 0 && kind === 'file' && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((r) => (
            <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--rule)' }}>
              <span aria-hidden="true" style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 8, background: 'rgba(201,150,58,0.12)', border: '1px solid rgba(201,150,58,0.3)', color: 'var(--field-gold-bright)', display: 'grid', placeItems: 'center' }}>
                <Paperclip size={14} />
              </span>
              <button type="button" onClick={() => open(r)} style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', color: 'var(--ink-strong)' }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.filename}</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-muted)' }}>
                  {fmtSize(r.size_bytes)} · {new Date(r.uploaded_at).toLocaleDateString()}
                </div>
              </button>
              <button type="button" onClick={() => open(r)} aria-label="Open" style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--ink-muted)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
                <Download size={14} />
              </button>
              <button type="button" onClick={() => remove(r)} aria-label="Delete" style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--ink-faint)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {lightboxUrl && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxUrl('')}
          style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.88)', display: 'grid', placeItems: 'center', padding: 16, cursor: 'zoom-out' }}
        >
          <img src={lightboxUrl} alt="Photo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </div>
      )}
    </div>
  )
}

function PhotoThumb({ row, bucket, onOpen, onDelete }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let cancelled = false
    supabase.storage
      .from(bucket)
      .createSignedUrl(row.storage_path, 60 * 60)
      .then(({ data }) => { if (!cancelled && data?.signedUrl) setUrl(data.signedUrl) })
    return () => { cancelled = true }
  }, [row.storage_path, bucket])
  return (
    <div style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: 10, overflow: 'hidden', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)' }}>
      <button
        type="button"
        onClick={onOpen}
        style={{ position: 'absolute', inset: 0, border: 'none', padding: 0, cursor: 'pointer', background: 'transparent' }}
        aria-label={row.filename}
      >
        {url ? (
          <img src={url} alt={row.filename} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <span style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', color: 'var(--ink-faint)' }}>
            <ImageIcon size={20} />
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete photo"
        style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 7, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', display: 'grid', placeItems: 'center', opacity: 0.85 }}
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

// ============================================================
// TO-DO TAB (Phase 17 item 4c)
// ============================================================
function TodosTab({ jobId, userId }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')

  const fetchRows = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('fh_job_todos')
      .select('*')
      .eq('job_id', jobId)
      .order('done', { ascending: true })
      .order('created_at', { ascending: false })
    setRows(data || [])
    setLoading(false)
  }, [jobId])

  useEffect(() => { fetchRows() }, [fetchRows])

  async function add() {
    const txt = draft.trim()
    if (!txt) return
    const { error } = await supabase.from('fh_job_todos').insert({
      user_id: userId, job_id: jobId, text: txt
    })
    if (error) {
      toast({ kind: 'error', title: "Couldn't add", body: error.message })
      return
    }
    setDraft('')
    fetchRows()
  }

  async function toggle(row) {
    const next = !row.done
    const { error } = await supabase
      .from('fh_job_todos')
      .update({ done: next, completed_at: next ? new Date().toISOString() : null })
      .eq('id', row.id)
    if (error) {
      toast({ kind: 'error', title: "Couldn't update", body: error.message })
      return
    }
    fetchRows()
  }

  async function remove(rowId) {
    const snapshot = rows.find((r) => r.id === rowId)
    const { error } = await supabase.from('fh_job_todos').delete().eq('id', rowId)
    if (error) { toastError("Couldn't delete", error.message); return }
    setRows((rs) => rs.filter((r) => r.id !== rowId))
    toastUndo('Task deleted', {
      description: (snapshot?.text || '').slice(0, 60) || 'Tap Undo to restore',
      onUndo: async () => {
        if (!snapshot) return
        const { error: insErr } = await supabase.from('fh_job_todos').insert(snapshot)
        if (insErr) { toastError("Couldn't undo", insErr.message); return }
        fetchRows()
        toastSuccess('Restored', '')
      }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          placeholder="Add a task…"
          style={{ flex: 1, minWidth: 0, padding: '11px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 14, outline: 'none' }}
        />
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={add}
          disabled={!draft.trim()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 14px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))', color: 'var(--onyx)', fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: '0.12em', cursor: draft.trim() ? 'pointer' : 'default', opacity: draft.trim() ? 1 : 0.5 }}
        >
          <Plus size={14} />
          ADD
        </motion.button>
      </div>

      {loading && <SkeletonList rows={3} card={false} />}
      {!loading && rows.length === 0 && <EmptyMini label="No tasks yet." />}
      {!loading && rows.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((r) => (
            <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--rule)' }}>
              <button
                type="button"
                onClick={() => toggle(r)}
                aria-label={r.done ? 'Mark not done' : 'Mark done'}
                style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 7, border: `1px solid ${r.done ? 'rgba(45,122,79,0.6)' : 'var(--rule)'}`, background: r.done ? 'rgba(45,122,79,0.22)' : 'rgba(255,255,255,0.04)', color: 'var(--signal-green)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
              >
                {r.done && <Check size={13} />}
              </button>
              <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-body)', fontSize: 14, color: r.done ? 'var(--ink-faint)' : 'var(--ink-strong)', textDecoration: r.done ? 'line-through' : 'none', opacity: r.done ? 0.6 : 1, overflowWrap: 'anywhere' }}>
                {r.text}
              </span>
              <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'var(--font-body)' }}>
                {new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
              <button type="button" onClick={() => remove(r.id)} aria-label="Delete task" style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--ink-faint)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ============================================================
// SCHEDULED TAB (Phase 17 item 3b)
// ============================================================
function ScheduledTab({ jobId }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('fh_schedule')
        .select('*')
        .eq('contact_id', jobId)
        .order('start_at', { ascending: true })
      if (cancelled) return
      setRows(data || [])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [jobId])

  function openOnSchedule(row) {
    const d = new Date(row.start_at)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    navigate(`/schedule?d=${iso}`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {loading && <SkeletonList rows={3} card={false} />}
      {!loading && rows.length === 0 && (
        <EmptyMini label="Nothing scheduled for this job." />
      )}
      {!loading && rows.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((e) => {
            const d = new Date(e.start_at)
            const dateStr = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
            const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => openOnSchedule(e)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--rule)', textAlign: 'left', cursor: 'pointer', color: 'var(--ink-strong)' }}
                >
                  <span aria-hidden="true" style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 8, background: 'rgba(201,150,58,0.12)', border: '1px solid rgba(201,150,58,0.3)', color: 'var(--field-gold-bright)', display: 'grid', placeItems: 'center' }}>
                    <Calendar size={14} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700 }}>{e.title || 'Untitled'}</div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-muted)', display: 'inline-flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                      <Calendar size={10} /> {dateStr}
                      <span aria-hidden="true">·</span>
                      <Clock size={10} /> {timeStr}
                    </div>
                  </div>
                  <ArrowRight size={14} color="var(--ink-faint)" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="fh-field">
      <span className="fh-field__k">{label}</span>
      {children}
    </label>
  )
}

function Toggle({ on, label, onChange }) {
  return (
    <button type="button" className={`fh-toggle${on ? ' is-on' : ''}`} onClick={() => onChange(!on)}>
      <span className="fh-toggle__track"><span className="fh-toggle__thumb" /></span>
      <span className="fh-toggle__label">{label}</span>
    </button>
  )
}

function EmptyMini({ label }) {
  return <div className="fh-empty fh-empty--mini"><p>{label}</p></div>
}
