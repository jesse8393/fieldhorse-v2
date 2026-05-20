import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Pencil, X as XIcon, ShieldCheck } from 'lucide-react'
import { supabase } from '../../../lib/supabase.js'
import { useConfirm } from '../../../components/ConfirmSheet.jsx'
import {
  startQuote, approveQuote, markComplete, reopen
} from '../../../lib/pipeline.js'
import { toastSuccess, toastError } from '../../../lib/toast.js'
import { hapticTap, hapticStageChange } from '../../../lib/haptics.js'
import {
  NextActionCard,
  HealthDonut,
  ProgressMeter,
  FeedRow,
  SectionHeader,
  PostedByChip
} from '../../../components/v3'
import TimeClockCard from '../../../components/TimeClockCard.jsx'
import { computeJobHealth } from '../lib/jobHealth.js'
import ActivityLog from '../sections/ActivityLog.jsx'
import { resolveNextAction } from '../lib/jobNextAction.js'
import ClientPicker from '../../../components/ClientPicker.jsx'
import { money } from '../lib/format.js'

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
 * per screen"). Its CTA dispatches by `kind` resolved from jobNextAction.js:
 *   - milestone → patch contact.milestones[i].done = true
 *   - todo      → fh_job_todos UPDATE done=true
 *   - schedule  → open AddEventSheet via onOpenAddEvent (parent owns sheet)
 *   - stage     → call pipelineFn from pipeline.js (markComplete/etc)
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
  onOpenMarkComplete
}) {
  const [actionLoading, setActionLoading] = useState(false)
  const confirm = useConfirm()

  // Delete a logged payment row. Used by the trash icon on payment
  // rows in the Recent Activity list. We confirm because payments are
  // financial records and an accidental delete here would silently
  // change the job's paid/balance numbers.
  async function deletePayment(paymentId, amount) {
    if (!paymentId || !userId) return
    const ok = await confirm({
      title: 'Delete this payment?',
      body: `Removes a ${fmtMoney(amount)} payment from this job. This can't be undone — re-log it if you delete by mistake.`,
      destructive: true,
      confirmLabel: 'Delete payment'
    })
    if (!ok) return
    const { error } = await supabase
      .from('fh_payments')
      .delete()
      .eq('id', paymentId)
      .eq('user_id', userId)
    if (error) {
      toastError("Couldn't delete payment", error.message)
      return
    }
    toastSuccess('Payment deleted', `${fmtMoney(amount)} removed`)
    await fetchAll?.()
  }

  const health = useMemo(
    () => computeJobHealth({ contact, payments, scheduleItems }),
    [contact, payments, scheduleItems]
  )

  const nextAction = useMemo(
    () => resolveNextAction({ contact, scheduleItems, todos }),
    [contact, scheduleItems, todos]
  )

  const milestones = useMemo(
    () => Array.isArray(contact?.milestones) ? contact.milestones : [],
    [contact?.milestones]
  )
  const milestonePct = milestones.length
    ? Math.round((milestones.filter((m) => m.done).length / milestones.length) * 100)
    : 0

  const activityRows = useMemo(
    () => buildActivityRows({ notes, payments, scheduleItems }).slice(0, 6),
    [notes, payments, scheduleItems]
  )

  async function handleNextActionComplete() {
    if (actionLoading) return
    setActionLoading(true)
    try {
      switch (nextAction.kind) {
        case 'milestone': {
          const next = milestones.map((m, i) =>
            i === nextAction.sourceId ? { ...m, done: true } : m
          )
          await patch({ milestones: next })
          break
        }
        case 'todo': {
          const { error } = await supabase
            .from('fh_job_todos')
            .update({ done: true, completed_at: new Date().toISOString() })
            .eq('id', nextAction.sourceId)
            .eq('user_id', userId)
          if (error) {
            toastError("Couldn't mark to-do done", error.message)
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
            await markComplete(contact)
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
          const fn = STAGE_FN_MAP[nextAction.pipelineFn]
          if (fn) {
            // Heavier haptic on stage boundary — matches haptics.js convention
            // that lead→quote→job→invoice transitions get hapticStageChange.
            // pipeline.js fires its own commit haptic; this one announces the
            // boundary BEFORE the network call.
            hapticStageChange()
            await fn(contact)
            await fetchAll()
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
    } catch (e) {
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
  const showCockpit = contractValue > 0 && (contact?.stage === 'job' || contact?.stage === 'invoice' || contact?.stage === 'closed')

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

      {/* PRIMARY ROW — NextAction + HealthDonut. Stacks on mobile, side-by-side ≥768px. */}
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

      {/* PROGRESS — milestone completion */}
      <ProgressMeter
        label="Job Progress"
        value={milestonePct}
        caption={milestones.length
          ? `${milestones.filter((m) => m.done).length} of ${milestones.length} milestones complete`
          : 'No milestones added yet'
        }
      />

      {/* RECENT ACTIVITY */}
      <div className="v3-section">
        <SectionHeader title="Recent Activity" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          {activityRows.length === 0 ? (
            <div className="v3-empty">
              Nothing logged yet. Crew check-ins, payments, and schedule changes appear here.
            </div>
          ) : (
            activityRows.map((row) => (
              <div key={row.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <FeedRow
                  type={row.type}
                  title={row.title}
                  detail={row.detail}
                  timestamp={row.timestamp}
                  pillTone={row.pillTone}
                  pillLabel={row.pillLabel}
                  onDelete={row.paymentId ? () => deletePayment(row.paymentId, row.paymentAmount) : undefined}
                  deleteLabel="Delete payment"
                />
                {row.userId && (
                  <PostedByChip
                    userId={row.userId}
                    verb={row.verb || 'posted'}
                    style={{ paddingLeft: 14 }}
                  />
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* TIME CLOCK — preserved from legacy. Only shows when stage in {job, invoice}.
          TimeClockCard internally gates on stage; we mount it always and let it
          decide whether to render. */}
      {(contact?.stage === 'job' || contact?.stage === 'invoice') && (
        <TimeClockCard
          contact={contact}
          userId={userId}
          onLogged={fetchAll}
        />
      )}

      {/* QUICK ACTIONS row — secondary actions. + Event opens AddEventSheet,
          Log Payment opens PaymentModal (only when stage allows it),
          Invite Partner opens InvitePartnerSheet. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <SecondaryAction
          icon={Plus}
          label="Schedule event"
          onClick={() => { hapticTap(); onOpenAddEvent?.() }}
        />
        {(contact?.stage === 'invoice' || contact?.stage === 'job' || contact?.stage === 'closed') && (
          <SecondaryAction
            icon={Plus}
            label="Log payment"
            onClick={() => { hapticTap(); onOpenLogPayment?.() }}
          />
        )}
        <SecondaryAction
          icon={Plus}
          label="Invite partner"
          onClick={() => { hapticTap(); onOpenInvitePartner?.() }}
        />
        {(contact?.stage === 'invoice' || contact?.stage === 'job' || contact?.stage === 'closed') && (
          <SecondaryAction
            icon={ShieldCheck}
            label={contact?.stage === 'closed' ? 'Closeout record' : 'Mark complete'}
            onClick={() => { hapticTap(); onOpenMarkComplete?.() }}
          />
        )}
      </div>

      {/* ACTIVITY LOG — chronological feed synthesized from existing
          arrays (notes, payments, schedule, change orders, contact
          metadata). Auto-hides on a brand-new job with no events. */}
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

const STAGE_FN_MAP = {
  startQuote,
  approveQuote,
  markComplete,
  reopen
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  })
}

/**
 * Merge notes + payments + scheduleItems into a unified activity stream
 * sorted by recency (newest first). Returns FeedRow-shaped objects.
 *
 * Each source maps to a FeedRow type for icon+color treatment:
 *   payment  → 'invoice'  (gold)
 *   note     → 'note'     (muted)
 *   schedule → 'crew-on-site' (green) — schedule entries are crew work
 */
function buildActivityRows({ notes = [], payments = [], scheduleItems = [] }) {
  const rows = []

  for (const p of payments) {
    rows.push({
      key: `pay-${p.id}`,
      type: 'invoice',
      title: `Payment received · ${fmtMoney(p.amount)}`,
      detail: p.method ? `via ${p.method}` : null,
      timestamp: p.paid_on || p.created_at,
      pillTone: 'success',
      pillLabel: 'PAID',
      userId: p.user_id || null,
      verb: 'posted',
      paymentId: p.id,
      paymentAmount: p.amount
    })
  }

  for (const n of notes) {
    rows.push({
      key: `note-${n.id}`,
      type: 'note',
      title: n.text || 'Note',
      detail: n.category && n.category !== 'note' ? n.category : null,
      timestamp: n.created_at,
      userId: n.user_id || null,
      verb: 'posted'
    })
  }

  for (const s of scheduleItems) {
    rows.push({
      key: `sch-${s.id}`,
      type: 'crew-on-site',
      title: s.title || 'Scheduled work',
      detail: s.description || null,
      timestamp: s.start_at,
      userId: s.user_id || null,
      verb: 'added'
    })
  }

  const sorted = rows.sort((a, b) => {
    const da = a.timestamp ? new Date(a.timestamp).getTime() : 0
    const db = b.timestamp ? new Date(b.timestamp).getTime() : 0
    return db - da
  })

  // 5/17 — collapse duplicate activity rows that come from the same
  // logical event written multiple times. The 5/13 audit flagged
  // "Roof-Deck-Chimney · Approved quote for Jeff Roy" appearing 4×
  // on the feed; root cause is upstream (approveQuote() in lib/stages.ts
  // and possibly fn_approve_quote_version trigger both insert into
  // fh_schedule on the same approval, doubling per re-approval). Fixing
  // the write path is invasive — a content-key dedupe at display time
  // is the safe fix that addresses the visible symptom.
  //
  // Dedupe key = (type | title | detail | day-bucket). Notes stay
  // unique because their `key` already encodes the unique row id and
  // we don't strip per-row; payments stay unique because each payment
  // amount/date combo is rarely identical. Only schedule rows with
  // truly-identical content on the same day collapse.
  const seen = new Set()
  return sorted.filter((r) => {
    const dayBucket = r.timestamp ? String(r.timestamp).slice(0, 10) : 'no-date'
    const content = `${r.type}|${(r.title || '').trim()}|${(r.detail || '').trim()}|${dayBucket}`
    if (seen.has(content)) return false
    seen.add(content)
    return true
  })
}

function SecondaryAction({ icon: Icon, label, onClick }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '9px 14px',
        borderRadius: 10,
        background: 'var(--v3-surface-2)',
        border: '1px solid var(--v3-border)',
        color: 'var(--v3-text)',
        fontFamily: 'var(--font-body)',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent'
      }}
    >
      <Icon size={13} aria-hidden="true" />
      {label}
    </motion.button>
  )
}

/* ============================================================
   EditFieldsCard — controlled form for the 9 editable fh_contacts
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
  { key: 'job_type',    label: 'Job type',    kind: 'text',     placeholder: 'e.g. Concrete',     col: 2 },
  { key: 'amount',      label: 'Amount',      kind: 'number',   placeholder: '0',                 col: 1 },
  { key: 'referred_by', label: 'Referred by', kind: 'text',     placeholder: 'Source',            col: 2 },
  { key: 'notes',       label: 'Notes',       kind: 'textarea', placeholder: 'Anything else…',    col: 1 }
]

function EditFieldsCard({ contact, patch, onExitEdit, userId }) {
  const [form, setForm] = useState(() => buildForm(contact))
  const [saving, setSaving] = useState(false)
  // Linked fh_clients row used for the "Pull from client" button. Loaded
  // only when contact has a client_id + caller is the owner (RLS on
  // fh_clients denies partner reads — owner-only by design).
  const [linkedClient, setLinkedClient] = useState(null)
  const [hydrating, setHydrating] = useState(false)
  // Pending client_id change tracked separately so the diff at commit()
  // time can include it without polluting the EDITABLE_FIELDS form
  // shape. null = no change, '' = explicit unlink, uuid = new link.
  const [pendingClientId, setPendingClientId] = useState(null)

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

  function set(key, value) {
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
    const diff = {}
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
  function handleClientLink(picked) {
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
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
          letterSpacing: '0.18em', textTransform: 'uppercase',
          color: 'var(--v3-primary)'
        }}>
          <Pencil size={12} aria-hidden="true" />
          Editing job fields
        </div>
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
        <span style={{
          fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700,
          letterSpacing: '0.14em', color: 'var(--v3-text-muted)',
          textTransform: 'uppercase'
        }}>
          Linked client
        </span>
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
            label={f.label}
            value={form[f.key]}
            onChange={(v) => set(f.key, v)}
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

function buildForm(contact) {
  const out = {}
  for (const f of EDITABLE_FIELDS) {
    const v = contact?.[f.key]
    out[f.key] = v == null ? '' : String(v)
  }
  return out
}

function EditField({ label, value, onChange, kind, placeholder, spanFull }) {
  const className = spanFull ? 'v3-edit-field--full' : ''
  const sharedInputStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '11px 13px', borderRadius: 10,
    background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border)',
    color: 'var(--v3-text)',
    fontFamily: 'var(--font-body)', fontSize: 14,
    outline: 'none'
  }
  return (
    <label className={className} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{
        fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
        letterSpacing: '0.16em', textTransform: 'uppercase',
        color: 'var(--v3-text-muted)'
      }}>
        {label}
      </span>
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
