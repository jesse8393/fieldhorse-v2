import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../components/icons/Icon.jsx'
import ActionSheet, { SheetField, SheetChipRow, SheetMoneyField } from '../components/ActionSheet.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { SkeletonBlock, SkeletonList } from '../components/Skeleton.jsx'
import SpecTabs from '../components/SpecTabs.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import {
  STAGES, STAGE_MAP, ACTIVE_STAGES, stageColor, stageLabel,
  recalcCost, margin, marginTier
} from '../lib/stages.js'
import {
  startQuote, approveQuote, markComplete, markLost, reopen, logPayment
} from '../lib/pipeline.js'
import { toast } from '../lib/toast.js'

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

  const [menuOpen, setMenuOpen] = useState(false)
  const [payModalOpen, setPayModalOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const fetchAll = useCallback(async () => {
    if (!user || !id) return
    setLoading(true)
    const [c, s, e, p, i, n] = await Promise.all([
      supabase.from('fh_contacts').select('*').eq('id', id).maybeSingle(),
      supabase.from('fh_subs').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
      supabase.from('fh_expenses').select('*').eq('contact_id', id).order('expense_date', { ascending: false }),
      supabase.from('fh_payments').select('*').eq('contact_id', id).order('paid_on', { ascending: false }),
      supabase.from('fh_inspections').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
      supabase.from('fh_notes').select('*').eq('contact_id', id).order('created_at', { ascending: false })
    ])
    setContact(c.data || null)
    setSubs(s.data || [])
    setExpenses(e.data || [])
    setPayments(p.data || [])
    setInspections(i.data || [])
    setNotes(n.data || [])
    setLoading(false)
  }, [user, id])

  useEffect(() => { fetchAll() }, [fetchAll])

  async function patch(update) {
    setContact((c) => ({ ...c, ...update }))
    await supabase.from('fh_contacts').update(update).eq('id', id)
  }

  const [deleting, setDeleting] = useState(false)
  const [deleteErr, setDeleteErr] = useState('')

  async function handleDelete() {
    if (deleting) return
    setDeleting(true)
    setDeleteErr('')
    try {
      const { error } = await supabase.from('fh_contacts').delete().eq('id', id)
      if (error) throw error
      toast('Job deleted', { accent: 'gold', duration: 2400 })
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
          <Icon name="chevron" size={18} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <div className="fh-detail__title">
          <span className="fh-eye">{stage?.label || contact.stage}</span>
          <h1 className="fh-page__title">{contact.name || 'Untitled'}</h1>
        </div>
        <div className="fh-detail__tools">
          <button
            className="fh-iconbtn"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
            aria-label="More"
            aria-expanded={menuOpen}
          >
            <Icon name="more" size={20} />
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
                    <Icon name="edit" size={16} /> Edit
                  </button>
                  <button role="menuitem" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); markLost(contact).then(fetchAll) }}>
                    <Icon name="lost" size={16} /> Mark lost
                  </button>
                  <button role="menuitem" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); patch({ partner_shared: !contact.partner_shared }) }}>
                    <Icon name="partner" size={16} /> {contact.partner_shared ? 'Unshare partner' : 'Share with partner'}
                  </button>
                  <button role="menuitem" className="is-danger" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setDeleteOpen(true) }}>
                    <Icon name="trash" size={16} /> Delete
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
        onAction={async (fn) => { await fn(contact); fetchAll() }}
        onLogPayment={() => setPayModalOpen(true)}
      />

      <div className="fh-tabs-wrap">
        <SpecTabs
          options={tabs.map((t) => ({ value: t.id, label: t.label }))}
          value={tab}
          onChange={setTab}
          ariaLabel="Detail tabs"
          size="sm"
        />
      </div>

      <div className="fh-tabpanel">
        {tab === 'overview' && <OverviewTab contact={contact} onPatch={patch} />}
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
          <DeleteRow label="Subs" count={subs.length} />
          <DeleteRow label="Expenses" count={expenses.length} />
          <DeleteRow label="Payments" count={payments.length} />
          <DeleteRow label="Inspections" count={inspections.length} />
          <DeleteRow label="Notes + schedule items" count={notes.length} detail="kept but detached" />
        </ul>
        <p style={{ margin: 0, color: 'var(--alert-red)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          This cannot be undone.
        </p>
      </ActionSheet>
    </section>
  )
}

function DeleteRow({ label, count, detail }) {
  return (
    <li style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--rule)', borderRadius: 'var(--radius-spec)' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>{label}</span>
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
    <div className="fh-summary-card">
      <div className="fh-summary-card__row">
        <SumItem k="Amount" v={money(contact.amount)} />
        <SumItem k="Cost" v={money(contact.cost)} />
        <SumItem k="Margin" v={marginValue} tone={tier} />
      </div>
      {(contact.stage === 'invoice' || contact.stage === 'closed') && (
        <div className="fh-summary-card__row">
          <SumItem k="Paid" v={money(paid)} />
          <SumItem k="Balance" v={money(balance)} tone={balance > 0 ? 'warn' : 'good'} />
        </div>
      )}
      {milestones.length > 0 && (
        <div className="fh-progress">
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
  return (
    <div className="fh-stagerow">
      {stage === 'lead' && (
        <button className="fh-btn fh-btn--primary" onClick={() => onAction(startQuote)}>
          Start quote <Icon name="arrowRight" size={16} />
        </button>
      )}
      {stage === 'quote' && (
        <button className="fh-btn fh-btn--primary" onClick={() => onAction(approveQuote)}>
          Approve quote <Icon name="check" size={16} />
        </button>
      )}
      {stage === 'job' && (
        <button className="fh-btn fh-btn--primary" onClick={() => onAction(markComplete)}>
          Mark complete <Icon name="check" size={16} />
        </button>
      )}
      {stage === 'invoice' && (
        <button className="fh-btn fh-btn--primary" onClick={onLogPayment}>
          Log payment <Icon name="dollar" size={16} />
        </button>
      )}
      {stage === 'closed' && (
        <>
          <span className="fh-status-pill fh-status-pill--gold">Closed</span>
          <button className="fh-btn fh-btn--ghost fh-btn--danger-ghost" onClick={() => onAction(reopen)}>
            Reopen
          </button>
        </>
      )}
      {stage === 'lost' && (
        <>
          <span className="fh-status-pill fh-status-pill--red">Lost</span>
          <button className="fh-btn fh-btn--ghost" onClick={() => onAction(reopen)}>
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
function OverviewTab({ contact, onPatch }) {
  const [form, setForm] = useState({ ...contact })
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
      <Toggle
        on={!!contact.has_inspections}
        label="This job requires inspections"
        onChange={(v) => onPatch({ has_inspections: v })}
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
      )
      }}
      <ul className="fh-rows">
        {subs.map((s) => (
          <li key={s.id} className="fh-row">
            <div>
              <strong>{s.name}</strong>
              <span className="fh-row__sub">{s.trade || '—'} {s.phone ? ` · ${s.phone}` : ''}</span>
            </div>
            <div className="fh-row__right">
              <span className="fh-pill">{s.status}</span>
              <strong>{money(s.rate)}</strong>
              <button className="fh-iconbtn fh-iconbtn--sm" onClick={() => remove(s.id)} aria-label="Delete">
                <Icon name="trash" size={14} />
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
      )
      }}
      <ul className="fh-rows">
        {expenses.map((e) => (
          <li key={e.id} className="fh-row">
            <div>
              <strong>{e.description}</strong>
              <span className="fh-row__sub">{e.category} · {e.expense_date}</span>
            </div>
            <div className="fh-row__right">
              <strong>{money(e.amount)}</strong>
              <button className="fh-iconbtn fh-iconbtn--sm" onClick={() => remove(e.id)} aria-label="Delete">
                <Icon name="trash" size={14} />
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
            <div>
              <strong>{money(p.amount)}</strong>
              <span className="fh-row__sub">{p.method}{p.reference ? ` · #${p.reference}` : ''}</span>
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
      )
      }}
      <ul className="fh-rows">
        {notes.map((n) => (
          <li key={n.id} className="fh-row">
            <div>
              <strong>{n.text || n.action || 'Note'}</strong>
              <span className="fh-row__sub">{n.category || 'note'} · {new Date(n.created_at).toLocaleString()}</span>
            </div>
          </li>
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
