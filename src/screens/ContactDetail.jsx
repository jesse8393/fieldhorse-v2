import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, MoreVertical, Pencil, XCircle, Users, UserPlus, Trash2,
  Wrench, Receipt, DollarSign, ClipboardCheck, Calendar, FileText,
  ArrowRight, Check
} from 'lucide-react'
import Icon from '../components/icons/Icon.jsx'
import ActionSheet, { SheetField, SheetChipRow, SheetMoneyField } from '../components/ActionSheet.jsx'
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
import { toast, toastSuccess, toastInfo } from '../lib/toast.js'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
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
  { id: 'messages',  label: 'Messages' }
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

  const [menuOpen, setMenuOpen] = useState(false)
  const [payModalOpen, setPayModalOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

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
    setContact(c.data || null)
    setSubs(s.data || [])
    setExpenses(e.data || [])
    setPayments(p.data || [])
    setInspections(i.data || [])
    setNotes(n.data || [])
    setScheduleCount(sch.count || 0)
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
                <em className="fh-font-serif-italic fh-text-gradient-gold">{last}.</em>
              </h1>
            )
          })()}
        </div>
        <div className="fh-detail__tools">
          <button
            className="fh-iconbtn"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
            aria-label="More"
            aria-expanded={menuOpen}
          >
            <MoreVertical size={20} />
          </button>
          <AnimatePresence>
            {menuOpen && (
              <>
                <div
                  className="fh-menu-backdrop"
                  aria-hidden="true"
                  onClick={() => setMenuOpen(false)}
                />
                <motion.div
                  className="fh-menu"
                  role="menu"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button role="menuitem" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setTab('overview') }}>
                    <Pencil size={16} /> Edit
                  </button>
                  <button role="menuitem" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); markLost(contact).then(() => { toastInfo('Marked lost', 'Moved to lost column'); fetchAll() }) }}>
                    <XCircle size={16} /> Mark lost
                  </button>
                  <button role="menuitem" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); patch({ partner_shared: !contact.partner_shared }) }}>
                    <Users size={16} /> {contact.partner_shared ? 'Unshare partner' : 'Share with partner'}
                  </button>
                  <button role="menuitem" className="is-danger" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setDeleteOpen(true) }}>
                    <Trash2 size={16} /> Delete
                  </button>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      <SummaryPanel
        contact={contact}
        paid={paid}
        balance={balance}
      />

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
        {tab === 'overview' && <OverviewTab contact={contact} onPatch={patch} userId={user.id} />}
        {tab === 'milestones' && <MilestonesTab contact={contact} onPatch={patch} />}
        {tab === 'subs' && <SubsTab contact={contact} subs={subs} userId={user.id} onChange={fetchAll} />}
        {tab === 'expenses' && <ExpensesTab contact={contact} expenses={expenses} userId={user.id} onChange={fetchAll} />}
        {tab === 'inspections' && <InspectionsTab contact={contact} inspections={inspections} userId={user.id} onChange={fetchAll} />}
        {tab === 'invoice' && <InvoiceTab contact={contact} payments={payments} onLogPayment={() => setPayModalOpen(true)} />}
        {tab === 'messages' && <MessagesTab notes={notes} contactId={contact.id} userId={user.id} onChange={fetchAll} />}
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
        <motion.button whileTap={{ scale: 0.97 }} style={primaryBtn} onClick={() => onAction(startQuote)}>
          Start quote <ArrowRight size={16} />
        </motion.button>
      )}
      {stage === 'quote' && (
        <motion.button whileTap={{ scale: 0.97 }} style={primaryBtn} onClick={() => onAction(approveQuote)}>
          Approve quote <Check size={16} />
        </motion.button>
      )}
      {stage === 'job' && (
        <motion.button whileTap={{ scale: 0.97 }} style={primaryBtn} onClick={() => onAction(markComplete)}>
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
          <button style={ghostBtn} onClick={() => onAction(reopen)}>
            Reopen
          </button>
        </>
      )}
      {stage === 'lost' && (
        <>
          <span className="fh-status-pill fh-status-pill--red">Lost</span>
          <button style={ghostBtn} onClick={() => onAction(reopen)}>
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
function OverviewTab({ contact, onPatch, userId }) {
  const [form, setForm] = useState({ ...contact })
  const [inviteOpen, setInviteOpen] = useState(false)
  useEffect(() => setForm({ ...contact }), [contact])
  function set(k, v) { setForm((f) => ({ ...f, [k]: v })) }
  async function save(k) {
    if (form[k] === contact[k]) return
    await onPatch({ [k]: form[k] ?? null })
  }
  return (
    <div className="fh-tab-overview">
      <div className="fh-grid2">
        <Field label="Name"><input value={form.name || ''} onChange={(e) => set('name', e.target.value)} onBlur={() => save('name')} /></Field>
        <Field label="Phone"><input value={form.phone || ''} onChange={(e) => set('phone', e.target.value)} onBlur={() => save('phone')} /></Field>
      </div>
      <div className="fh-grid2">
        <Field label="Email"><input type="email" value={form.email || ''} onChange={(e) => set('email', e.target.value)} onBlur={() => save('email')} /></Field>
        <Field label="Address"><input value={form.address || ''} onChange={(e) => set('address', e.target.value)} onBlur={() => save('address')} /></Field>
      </div>
      <div className="fh-grid2">
        <Field label="Job title"><input value={form.job_title || ''} onChange={(e) => set('job_title', e.target.value)} onBlur={() => save('job_title')} /></Field>
        <Field label="Job type"><input value={form.job_type || ''} onChange={(e) => set('job_type', e.target.value)} onBlur={() => save('job_type')} /></Field>
      </div>
      <div className="fh-grid2">
        <Field label="Amount"><input type="number" value={form.amount || 0} onChange={(e) => set('amount', e.target.value)} onBlur={() => save('amount')} /></Field>
        <Field label="Referred by"><input value={form.referred_by || ''} onChange={(e) => set('referred_by', e.target.value)} onBlur={() => save('referred_by')} /></Field>
      </div>
      <Field label="Notes">
        <textarea rows={3} value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} onBlur={() => save('notes')} />
      </Field>

      {/* Inspections toggle — gates the Inspections tab */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--rule)', marginTop: 12 }}>
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

      {/* Partner row — UI shell. Full wiring lands after migration 004 runs. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--rule)', marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span
            aria-hidden="true"
            style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'rgba(201,150,58,0.12)', border: '1px solid rgba(201,150,58,0.3)', color: 'var(--field-gold-bright)' }}
          >
            <Users size={14} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--ink-strong)' }}>Partner</div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>Share this job with someone else to co-manage</div>
          </div>
        </div>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={() => setInviteOpen(true)}
          style={{
            flexShrink: 0,
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
    await supabase.from('fh_subs').delete().eq('id', id)
    await recalcCost(contact.id)
    onChange()
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
            <input type="number" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="0" />
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
    await supabase.from('fh_expenses').delete().eq('id', id)
    await recalcCost(contact.id)
    onChange()
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
      <AnimatePresence>
        {active && (
          <InspectionLog trade={active} onClose={() => setActive(null)} onSave={logResult} />
        )}
      </AnimatePresence>
    </div>
  )
}

function InspectionLog({ trade, onClose, onSave }) {
  const [result, setResult] = useState('pass')
  const [notes, setNotes] = useState('')
  return (
    <>
      <motion.div className="fh-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div className="fh-modal" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }}>
        <header className="fh-modal__head">
          <span className="fh-eye">Log inspection · {trade}</span>
          <button className="fh-iconbtn" onClick={onClose}><Icon name="x" size={18} /></button>
        </header>
        <div className="fh-form">
          <Field label="Result">
            <div className="fh-seg">
              {['pass', 'fail', 'na'].map((r) => (
                <button key={r} className={result === r ? 'is-active' : ''} onClick={() => setResult(r)} type="button">
                  {r.toUpperCase()}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Notes"><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <div className="fh-modal__foot">
            <button className="fh-btn fh-btn--ghost" onClick={onClose}>Cancel</button>
            <button className="fh-btn fh-btn--gold" onClick={() => onSave(trade, result, notes)}>Save</button>
          </div>
        </div>
      </motion.div>
    </>
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
            <Field label="Amount"><input autoFocus type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
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
