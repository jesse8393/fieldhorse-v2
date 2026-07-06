import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Plus, Pencil, X as XIcon, ShieldCheck, Receipt } from 'lucide-react'
import { supabase } from '../../../lib/supabase.ts'
import {
  startQuote, approveQuote, markComplete, reopen
} from '../../../lib/pipeline.ts'
import { toastSuccess, toastError } from '../../../lib/toast.ts'
import { hapticTap, hapticStageChange } from '../../../lib/haptics.ts'
import {
  NextActionCard,
  HealthDonut,
  ProgressMeter,
  Button,
  Eyebrow
} from '../../../components/v3'
import TimeClockCard from '../../../components/TimeClockCard.tsx'
import { computeJobHealth } from '../lib/jobHealth.ts'
import ActivityLog from '../sections/ActivityLog.tsx'
import { resolvePrimaryAction } from '../lib/jobNextAction.ts'
import ClientPicker from '../../../components/ClientPicker.tsx'
import { money } from '../lib/format.ts'

/**
 * v3 OVERVIEW tab — the "money screen" of the Job Detail.
 *
 * Layout:
 *   NextActionCard      | HealthDonut         (tablet+: side-by-side)
 *                                              (mobile:    stacked)
 *   ProgressMeter (full width)
 *   Recent Activity feed (notes ∪ payments ∪ scheduleItems)
 *   TimeClockCard (only when stage in {job, invoice} — preserved from legacy)
 *
 * NextActionCard owns the primary action per ruleset ("Max 1 primary action
 * per screen"). Its CTA dispatches by `kind` resolved from jobNextAction.ts:
 *   - milestone → patch contact.milestones[i].done = true
 *   - todo      → fh_job_todos UPDATE done=true
 *   - schedule  → open AddEventSheet via onOpenAddEvent (parent owns sheet)
 *   - stage     → call pipelineFn from pipeline.ts (markComplete/etc)
 *   - idle      → open AddEventSheet
 */
export default function OverviewTab({
  contact,
  notes = [],
  payments = [],
  scheduleItems = [],
  todos = [],
  changeOrders = [],
  stageTransitions = [],
  paid,
  balance,
  userId,
  fetchAll,
  patch,
  isEditing,
  onExitEdit,
  onOpenAddEvent,
  onOpenLogPayment,
  onOpenInvitePartner,
  onOpenApproveQuote,
  onOpenMarkComplete,
  onOpenSendInvoice,
  onOpenQuote
}: any) {
  const [actionLoading, setActionLoading] = useState(false)
  const queryClient = useQueryClient()

  const health = useMemo(
    () => computeJobHealth({ contact, payments, scheduleItems }),
    [contact, payments, scheduleItems]
  )

  const nextAction = useMemo(
    () => resolvePrimaryAction({ contact, scheduleItems, todos }),
    [contact, scheduleItems, todos]
  )

  const milestones = useMemo(
    () => Array.isArray(contact?.milestones) ? contact.milestones : [],
    [contact?.milestones]
  )
  const milestonePct = milestones.length
    ? Math.round((milestones.filter((m: any) => m.done).length / milestones.length) * 100)
    : 0

  async function handleNextActionComplete() {
    if (actionLoading) return
    setActionLoading(true)
    try {
      switch (nextAction.kind) {
        case 'milestone': {
          const next = milestones.map((m: any, i: any) =>
            i === nextAction.sourceId ? { ...m, done: true } : m
          )
          await patch({ milestones: next })
          break
        }
        case 'todo': {
          // Speed pass: flip the todo in the detail cache immediately so
          // the NextActionCard advances the instant the thumb lifts; the
          // fetchAll/rollback below reconciles with server truth.
          const todoId = String(nextAction.sourceId || '')
          queryClient.setQueryData(['jobDetail', contact?.id], (prev: any) =>
            prev
              ? { ...prev, todos: (prev.todos || []).map((t: any) => t.id === todoId ? { ...t, done: true } : t) }
              : prev
          )
          const { error } = await supabase
            .from('fh_job_todos')
            .update({ done: true, completed_at: new Date().toISOString() })
            .eq('id', todoId)
            .eq('user_id', userId)
          if (error) {
            toastError("Couldn't mark to-do done", error.message)
            await fetchAll() // roll the optimistic flip back
          } else {
            toastSuccess('To-do complete')
            await fetchAll()
          }
          break
        }
        case 'schedule': {
          // Schedule entries don't have a `done` column. Tapping Mark Complete
          // here advances stage if the user is on `job` (kickoff scheduled →
          // mark job complete). Otherwise fall through to opening the next-
          // event sheet so they can schedule the follow-up.
          if (contact.stage === 'job') {
            const res: any = await markComplete(contact)
            if (res?.error) throw res.error
            await fetchAll()
          } else {
            onOpenAddEvent?.()
          }
          break
        }
        case 'stage': {
          // Approval intercept (Phase 4C-2): the bare approveQuote()
          // pipeline call would advance stage + add a kickoff schedule
          // but write NO immutable snapshot, leaving no record of what
          // was approved. Route through the ApproveQuoteSheet instead
          // so every approval lands as an fh_quote_versions row via
          // fn_approve_quote_version. The sheet itself calls
          // approveQuote() afterward when the operator leaves the
          // "Move to Job" checkbox checked.
          if (nextAction.pipelineFn === 'approveQuote' && onOpenApproveQuote) {
            hapticStageChange()
            onOpenApproveQuote()
            break
          }
          // Billing intercept (pipeline v2): "Send invoice" opens the
          // SendInvoiceSheet in the parent rather than mutating stage —
          // invoicing isn't a stage anymore.
          if (nextAction.pipelineFn === 'sendInvoice') {
            hapticStageChange()
            onOpenSendInvoice?.()
            break
          }
          const fn = STAGE_FN_MAP[nextAction.pipelineFn || ""]
          if (fn) {
            // Heavier haptic on stage boundary — matches haptics.ts convention
            // that lead→quote→job transitions get hapticStageChange.
            // pipeline.ts fires its own commit haptic; this one announces the
            // boundary BEFORE the network call.
            hapticStageChange()
            const res: any = await fn(contact)
            if (res?.error) throw res.error
            await fetchAll()
            if (nextAction.pipelineFn === 'startQuote') {
              onOpenQuote?.()
            }
          } else if (nextAction.pipelineFn === 'logPayment') {
            // Log payment opens the modal in the parent — stays in flight as
            // the operator inputs amount/date/method.
            onOpenLogPayment?.()
          }
          break
        }
        case 'idle':
        default:
          onOpenAddEvent?.()
      }
    } catch (e: any) {
      toastError("Couldn't complete action", e?.message || 'Unknown error')
    } finally {
      setActionLoading(false)
    }
  }

  function handleNextActionSchedule() {
    onOpenAddEvent?.()
  }

  const contractValue = Number(contact?.amount || 0)
  const paidNum = Number(paid || 0)
  const remaining = Math.max(0, contractValue - paidNum)
  const billedPct = contractValue > 0 ? Math.min(1, paidNum / contractValue) : 0
  const isExecutionStage = contact?.stage === 'job' || contact?.stage === 'invoice' || contact?.stage === 'closed'
  const showCockpit = contractValue > 0 && isExecutionStage

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '8px 20px 32px' }}>

      {/* EDIT FIELDS — only shown when header EDIT toggle is on. Renders ABOVE
          the dashboard so the operator's eye lands on the form. Cancel/Save
          collapses back to the read-only Overview. */}
      {isEditing && (
        <EditFieldsCard
          contact={contact}
          patch={patch}
          onExitEdit={onExitEdit}
          userId={userId}
        />
      )}

      {/* COCKPIT HEADLINE — contract-value hero. Ported from the v3 design
          handoff (.cockpit-headline). Only renders once the job has a real
          contract value AND has moved past quote — before that, the
          NextActionCard is still the right primary focus. */}
      {showCockpit && (
        <div className="cockpit-headline">
          <div className="cockpit-headline__top">
            <div>
              <div className="cockpit-headline__lbl">Contract value</div>
              <div className="cockpit-headline__amt">{money(contractValue)}</div>
              <div className="cockpit-headline__sub">
                {contact?.invoice_no ? `Invoice #${contact.invoice_no} · ` : ''}
                {billedPct >= 1 ? 'Paid in full' : `${Math.round(billedPct * 100)}% collected`}
              </div>
            </div>
            <div className="cockpit-headline__r">
              <div className="cockpit-headline__lbl">Health</div>
              <div className="cockpit-headline__margin" style={{
                color: health.score >= 75 ? 'var(--v3-success-bright, #7BB58E)'
                  : health.score >= 50 ? 'var(--v3-primary)'
                  : 'var(--v3-danger-bright)'
              }}>{health.score}%</div>
              <div className="cockpit-headline__sub">{health.label}</div>
            </div>
          </div>
          <div className="cockpit-headline__bar">
            <div className="cockpit-headline__bar-fill" style={{ width: `${billedPct * 100}%` }} />
          </div>
          <div className="cockpit-headline__bar-meta">
            <span><b>{money(paidNum)}</b> collected</span>
            <span>{money(remaining)} remaining</span>
          </div>
        </div>
      )}

      {/* PRIMARY ROW — NextAction (+ HealthDonut on execution stages).
          A lead/quote has no scheduled work, so "Health 20% · Behind"
          is structurally meaningless before the job is active —
          audit §D3 ("a deal with no scheduled work cannot be behind").
          Health + Progress only render from stage='job' onward. */}
      {isExecutionStage ? (
        <div className="v3-overview-grid">
          <NextActionCard
            title={nextAction.kind === 'idle' ? null : nextAction.title}
            date={nextAction.date}
            dueIso={nextAction.kind === 'todo' ? nextAction.dueAt : null}
            cta={nextAction.ctaLabel}
            onComplete={handleNextActionComplete}
            onSchedule={handleNextActionSchedule}
            loading={actionLoading}
          />
          <HealthDonut value={health.score} label={health.label} />
        </div>
      ) : (
        <NextActionCard
          title={nextAction.kind === 'idle' ? null : nextAction.title}
          date={nextAction.date}
          dueIso={nextAction.kind === 'todo' ? nextAction.dueAt : null}
          cta={nextAction.ctaLabel}
          onComplete={handleNextActionComplete}
          onSchedule={handleNextActionSchedule}
          loading={actionLoading}
        />
      )}

      {/* PROGRESS — milestone completion (execution stages only) */}
      {isExecutionStage && (
        <ProgressMeter
          label="Job Progress"
          value={milestonePct}
          caption={milestones.length
            ? `${milestones.filter((m: any) => m.done).length} of ${milestones.length} milestones complete`
            : 'No milestones added yet'
          }
        />
      )}

      {/* DAILY ACTIONS — the highest-frequency job actions live here, directly
          under the status/next-action so they're reachable without scrolling
          past the activity feed. Money actions come first, then time clock,
          then the lower-frequency schedule/partner actions. */}
      {(contact?.stage === 'job' || contact?.stage === 'invoice') && (
        <TimeClockCard
          contact={contact}
          userId={userId}
          onLogged={fetchAll}
        />
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {(contact?.stage === 'invoice' || contact?.stage === 'job') && (
          <Button variant="secondary" leftIcon={Receipt} onClick={() => { hapticTap(); onOpenSendInvoice?.() }}>
            Send invoice
          </Button>
        )}
        {(contact?.stage === 'invoice' || contact?.stage === 'job' || contact?.stage === 'closed') && (
          <Button variant="secondary" leftIcon={Plus} onClick={() => { hapticTap(); onOpenLogPayment?.() }}>
            Log payment
          </Button>
        )}
        {(contact?.stage === 'invoice' || contact?.stage === 'job' || contact?.stage === 'closed') && (
          <Button variant="secondary" leftIcon={ShieldCheck} onClick={() => { hapticTap(); onOpenMarkComplete?.() }}>
            {contact?.stage === 'closed' ? 'Closeout record' : 'Mark complete'}
          </Button>
        )}
        <Button variant="secondary" leftIcon={Plus} onClick={() => { hapticTap(); onOpenAddEvent?.() }}>
          Schedule event
        </Button>
        <Button variant="secondary" leftIcon={Plus} onClick={() => { hapticTap(); onOpenInvitePartner?.() }}>
          Invite partner
        </Button>
      </div>

      {/* ACTIVITY — single chronological timeline synthesized from existing
          arrays (notes, payments, schedule, change orders, stage history,
          contact metadata). This is the one activity feed on the Overview;
          the old compact "Recent Activity" list above it duplicated these
          same events. Payment deletion moved to the Financials → Invoice
          payment-history list, its natural home. Auto-hides on a brand-new
          job with no events. */}
      <ActivityLog
        contact={contact}
        notes={notes}
        payments={payments}
        scheduleItems={scheduleItems}
        changeOrders={changeOrders}
        stageTransitions={stageTransitions}
      />

      {/* Inline grid CSS — mobile-first stack, 1.5fr/1fr at ≥768px */}
      <style>{`
        .v3-overview-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 14px;
        }
        @media (min-width: 768px) {
          .v3-overview-grid {
            grid-template-columns: 1.5fr 1fr;
            align-items: start;
          }
        }
      `}</style>
    </div>
  )
}

/* ----------- helpers ----------- */

const STAGE_FN_MAP: Record<string, any> = {
  startQuote,
  approveQuote,
  markComplete,
  reopen
}

/* ============================================================
   EditFieldsCard — controlled form for the editable fh_contacts
   fields. Save patches only the diff (matches legacy commit() behavior
   so we don't write fields the user didn't touch). Cancel exits edit
   mode without saving.

   Rebuilt v3 from the legacy OverviewEditForm at lines 776-888 of the
   pre-Drop-3 ContactDetail.jsx (since deleted in Drop 3.3).
   ============================================================ */

const EDITABLE_FIELDS = [
  { key: 'name',        label: 'Name',        kind: 'text',     placeholder: 'Client or job name', col: 1 },
  { key: 'phone',       label: 'Phone',       kind: 'tel',      placeholder: '(555) 555-5555',    col: 2 },
  { key: 'email',       label: 'Email',       kind: 'email',    placeholder: 'name@example.com',  col: 1 },
  { key: 'address',     label: 'Address',     kind: 'text',     placeholder: 'Job site address',  col: 1 },
  { key: 'job_title',   label: 'Job title',   kind: 'text',     placeholder: 'e.g. Bath remodel', col: 1 },
  { key: 'scope_text',  label: 'Scope notes', kind: 'textarea', placeholder: 'Scope, timing, constraints, must-haves...', col: 1 },
  { key: 'job_type',    label: 'Job type',    kind: 'text',     placeholder: 'e.g. Concrete',     col: 2 },
  { key: 'amount',      label: 'Amount',      kind: 'number',   placeholder: '0',                 col: 1 },
  { key: 'referred_by', label: 'Referred by', kind: 'text',     placeholder: 'Source',            col: 2 },
  { key: 'notes',       label: 'Notes',       kind: 'textarea', placeholder: 'Anything else…',    col: 1 }
]

function EditFieldsCard({ contact, patch, onExitEdit, userId }: any) {
  const [form, setForm] = useState(() => buildForm(contact))
  const [saving, setSaving] = useState(false)
  const recordNoun = contact?.stage === 'lead' ? 'lead'
    : contact?.stage === 'quote' ? 'quote'
    : 'job'
  // Linked fh_clients row used for the "Pull from client" button. Loaded
  // only when contact has a client_id + caller is the owner (RLS on
  // fh_clients denies partner reads — owner-only by design).
  const [linkedClient, setLinkedClient] = useState<any>(null)
  const [hydrating, setHydrating] = useState(false)
  // Pending client_id change tracked separately so the diff at commit()
  // time can include it without polluting the EDITABLE_FIELDS form
  // shape. null = no change, '' = explicit unlink, uuid = new link.
  const [pendingClientId, setPendingClientId] = useState<any>(null)

  // Reset form whenever the underlying contact changes (e.g. a partner edit
  // streams in via realtime mid-edit). Keeps the form authoritative for
  // changed fields while reflecting truth for untouched ones.
  useEffect(() => { setForm(buildForm(contact)) }, [contact?.id])

  // Lazy-load the linked client when present. Skips silently when the
  // contact has no client link or RLS denies (partner viewer).
  useEffect(() => {
    let cancelled = false
    if (!contact?.client_id || !userId) { setLinkedClient(null); return }
    ;(async () => {
      const { data } = await supabase
        .from('fh_clients')
        .select('id, name, company_name, phone, email, address')
        .eq('id', contact.client_id)
        .maybeSingle()
      if (!cancelled) setLinkedClient(data || null)
    })()
    return () => { cancelled = true }
  }, [contact?.client_id, userId])

  function set(key: any, value: any) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // Pull from the linked client — fills empty form fields with the
  // client's values. Never clobbers anything the user has typed on
  // the form. Surfaces only when there's at least one field to fill.
  function hydrateFromClient() {
    if (!linkedClient) return
    setHydrating(true)
    setForm((prev) => {
      const next = { ...prev }
      const mapping = {
        name:    linkedClient.name,
        phone:   linkedClient.phone,
        email:   linkedClient.email,
        address: linkedClient.address
      }
      for (const [k, v] of Object.entries(mapping)) {
        const cur = (prev[k] || '').toString().trim()
        if (!cur && v) next[k] = v
      }
      return next
    })
    setTimeout(() => setHydrating(false), 250)
  }

  // Which fields would actually change if the user tapped "Pull from
  // client"? Drives whether the button surfaces at all.
  const fieldsToFill = (() => {
    if (!linkedClient) return []
    const fields = []
    const checks = [
      ['name',    linkedClient.name],
      ['phone',   linkedClient.phone],
      ['email',   linkedClient.email],
      ['address', linkedClient.address]
    ]
    for (const [k, v] of checks) {
      const cur = (form[k] || '').toString().trim()
      if (!cur && v) fields.push(k)
    }
    return fields
  })()

  async function commit() {
    if (saving) return
    // Diff: only patch keys whose value differs from the contact row.
    const diff: Record<string, any> = {}
    for (const f of EDITABLE_FIELDS) {
      const next = f.kind === 'number' ? (form[f.key] === '' ? null : Number(form[f.key])) : form[f.key]
      const cur = contact[f.key]
      const normalizedCur = cur ?? (f.kind === 'number' ? null : '')
      const normalizedNext = next ?? (f.kind === 'number' ? null : '')
      if (normalizedNext !== normalizedCur) diff[f.key] = next
    }
    // Client link change rides the same diff. Sentinel "" → null (unlink).
    if (pendingClientId !== null) {
      const cleaned = pendingClientId || null
      if (cleaned !== (contact.client_id || null)) diff.client_id = cleaned
    }
    if (Object.keys(diff).length === 0) {
      onExitEdit?.()
      return
    }
    setSaving(true)
    await patch(diff)
    setSaving(false)
    onExitEdit?.()
  }

  // Called when the operator picks (or clears) a client via the
  // ClientPicker below. Auto-hydrates empty form fields with the
  // picked client's values — same merge policy as NewLeadSheet's
  // handleClientChange. User-typed values are never clobbered.
  function handleClientLink(picked: any) {
    if (!picked) {
      setPendingClientId('') // sentinel for explicit unlink
      setLinkedClient(null)
      return
    }
    setPendingClientId(picked.id)
    setLinkedClient(picked)
    setForm((prev) => ({
      ...prev,
      name:    prev.name?.trim()    ? prev.name    : picked.name    || '',
      phone:   prev.phone?.trim()   ? prev.phone   : picked.phone   || '',
      email:   prev.email?.trim()   ? prev.email   : picked.email   || '',
      address: prev.address?.trim() ? prev.address : picked.address || ''
    }))
  }

  return (
    <div style={{
      padding: '18px 18px 16px',
      borderRadius: 16,
      background: 'var(--v3-surface)',
      border: '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
      display: 'flex', flexDirection: 'column', gap: 14
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Eyebrow as="div" tone="gold">
          <Pencil size={12} aria-hidden="true" />
          Editing {recordNoun} fields
        </Eyebrow>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {fieldsToFill.length > 0 && (
            <button
              type="button"
              onClick={hydrateFromClient}
              disabled={hydrating}
              title={`Fill ${fieldsToFill.length} empty field${fieldsToFill.length === 1 ? '' : 's'} from the linked client (${linkedClient?.name || 'client'})`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '6px 11px', borderRadius: 8,
                background: 'color-mix(in srgb, var(--v3-primary) 14%, transparent)',
                border: '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)',
                color: 'var(--v3-primary-bright)',
                fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
                letterSpacing: '0.04em', cursor: 'pointer'
              }}
            >
              {hydrating ? 'Filling…' : `Use client info · ${fieldsToFill.length}`}
            </button>
          )}
          <button
            type="button"
            onClick={onExitEdit}
            aria-label="Cancel edit"
            style={{
              width: 32, height: 32, borderRadius: 9,
              background: 'transparent', border: '1px solid var(--v3-border)',
              color: 'var(--v3-text-muted)', cursor: 'pointer',
              display: 'grid', placeItems: 'center'
            }}
          >
            <XIcon size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* LINKED CLIENT — controlled ClientPicker. Picks auto-hydrate
          empty fields on the form (same merge policy as NewLeadSheet)
          and commit the new client_id alongside the regular field
          diff. Clearing the picker queues an unlink. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Eyebrow>Linked client</Eyebrow>
        <ClientPicker
          userId={userId}
          value={linkedClient || (contact?.client_id ? { id: contact.client_id, name: '' } : null)}
          onChange={handleClientLink}
        />
        <span style={{
          fontFamily: 'var(--font-body)', fontSize: 11,
          color: 'var(--v3-text-muted)', lineHeight: 1.4
        }}>
          Picking a client auto-fills any empty fields below. Your typed values are preserved.
        </span>
      </div>

      <div className="v3-edit-grid">
        {EDITABLE_FIELDS.map((f) => (
          <EditField
            key={f.key}
            label={f.key === 'job_title' && recordNoun !== 'job' ? 'Project / scope' : f.label}
            value={form[f.key]}
            onChange={(v: any) => set(f.key, v)}
            kind={f.kind}
            placeholder={f.placeholder}
            spanFull={f.kind === 'textarea' || f.key === 'address'}
          />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 8, marginTop: 4 }}>
        <button
          type="button"
          onClick={onExitEdit}
          style={{
            padding: '12px', borderRadius: 12,
            background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border)',
            color: 'var(--v3-text)', cursor: 'pointer',
            fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600
          }}
        >
          Cancel
        </button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          onClick={commit}
          disabled={saving}
          style={{
            padding: '12px', borderRadius: 12, border: 'none',
            background: 'var(--v3-primary)',
            color: 'var(--v3-on-primary)',
            cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1,
            fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
            letterSpacing: '0.04em',
            boxShadow: 'var(--v3-gold-glow)',
            WebkitTapHighlightColor: 'transparent'
          }}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </motion.button>
      </div>

      <style>{`
        .v3-edit-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
        }
        @media (min-width: 540px) {
          .v3-edit-grid {
            grid-template-columns: 1fr 1fr;
          }
          .v3-edit-grid > .v3-edit-field--full {
            grid-column: 1 / -1;
          }
        }
      `}</style>
    </div>
  )
}

function buildForm(contact: any) {
  const out: Record<string, any> = {}
  for (const f of EDITABLE_FIELDS) {
    const v = contact?.[f.key]
    out[f.key] = v == null ? '' : String(v)
  }
  return out
}

function EditField({ label, value, onChange, kind, placeholder, spanFull }: any) {
  const className = spanFull ? 'v3-edit-field--full' : ''
  const sharedInputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    padding: '11px 13px', borderRadius: 10,
    background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border)',
    color: 'var(--v3-text)',
    fontFamily: 'var(--font-body)', fontSize: 14,
    outline: 'none'
  }
  return (
    <label className={className} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Eyebrow>{label}</Eyebrow>
      {kind === 'textarea' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          style={{ ...sharedInputStyle, resize: 'vertical', minHeight: 64 }}
        />
      ) : (
        <input
          type={kind === 'number' ? 'number' : kind === 'tel' ? 'tel' : kind === 'email' ? 'email' : 'text'}
          inputMode={kind === 'number' ? 'decimal' : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={sharedInputStyle}
        />
      )}
    </label>
  )
}
