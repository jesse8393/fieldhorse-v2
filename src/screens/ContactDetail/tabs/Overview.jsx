import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import { supabase } from '../../../lib/supabase.js'
import {
  startQuote, approveQuote, markComplete, reopen
} from '../../../lib/pipeline.js'
import { toastSuccess, toastError } from '../../../lib/toast.js'
import { hapticTap } from '../../../lib/haptics.js'
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
  onOpenAddEvent,
  onOpenLogPayment,
  onOpenInvitePartner
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
          const fn = STAGE_FN_MAP[nextAction.pipelineFn]
          if (fn) {
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

      {/* PRIMARY ROW — NextAction + HealthDonut. Stacks on mobile, side-by-side ≥768px. */}
      <div className="v3-overview-grid">
        <NextActionCard
          title={nextAction.kind === 'idle' ? null : nextAction.title}
          date={nextAction.date}
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
      <div>
        <SectionHeader title="Recent Activity" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {activityRows.length === 0 ? (
            <div style={{
              padding: '20px 18px',
              borderRadius: 16,
              background: 'var(--v3-surface)',
              border: '1px dashed var(--v3-border-strong)',
              textAlign: 'center',
              color: 'var(--v3-text-muted)',
              fontFamily: 'var(--font-body)',
              fontSize: 13
            }}>
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
