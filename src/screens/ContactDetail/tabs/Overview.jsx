import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Pencil, X as XIcon } from 'lucide-react'
import { supabase } from '../../../lib/supabase.js'
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
  SectionHeader
} from '../../../components/v3'
import TimeClockCard from '../../../components/TimeClockCard.jsx'
import { computeJobHealth } from '../lib/jobHealth.js'
import { resolveNextAction } from '../lib/jobNextAction.js'
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
  onOpenApproveQuote
}) {
  const [actionLoading, setActionLoading] = useState(false)

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
        />
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
              <FeedRow
                key={row.key}
                type={row.type}
                title={row.title}
                detail={row.detail}
                timestamp={row.timestamp}
                pillTone={row.pillTone}
                pillLabel={row.pillLabel}
              />
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
      </div>

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
      pillLabel: 'PAID'
    })
  }

  for (const n of notes) {
    rows.push({
      key: `note-${n.id}`,
      type: 'note',
      title: n.text || 'Note',
      detail: n.category && n.category !== 'note' ? n.category : null,
      timestamp: n.created_at
    })
  }

  for (const s of scheduleItems) {
    rows.push({
      key: `sch-${s.id}`,
      type: 'crew-on-site',
      title: s.title || 'Scheduled work',
      detail: s.description || null,
      timestamp: s.start_at
    })
  }

  return rows.sort((a, b) => {
    const da = a.timestamp ? new Date(a.timestamp).getTime() : 0
    const db = b.timestamp ? new Date(b.timestamp).getTime() : 0
    return db - da
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

function EditFieldsCard({ contact, patch, onExitEdit }) {
  const [form, setForm] = useState(() => buildForm(contact))
  const [saving, setSaving] = useState(false)

  // Reset form whenever the underlying contact changes (e.g. a partner edit
  // streams in via realtime mid-edit). Keeps the form authoritative for
  // changed fields while reflecting truth for untouched ones.
  useEffect(() => { setForm(buildForm(contact)) }, [contact?.id])

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

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
    if (Object.keys(diff).length === 0) {
      onExitEdit?.()
      return
    }
    setSaving(true)
    await patch(diff)
    setSaving(false)
    onExitEdit?.()
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
