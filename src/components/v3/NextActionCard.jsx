import { motion } from 'framer-motion'
import { Calendar } from 'lucide-react'
import { hapticTap } from '../../lib/haptics.js'
import { dueStatus } from '../../lib/dueDate.js'

/**
 * Next Action card — the most important thing on the Job Detail Overview.
 *
 *   ┌────────────────────────────────────────────────┐
 *   │ NEXT ACTION                                    │
 *   │                                                │
 *   │ Schedule final walkthrough with client         │
 *   │  📅 Apr 30, 2026 at 10:00 AM                   │
 *   │                                                │
 *   │ ┌──────────────────────────────────────────┐   │
 *   │ │           Mark Complete                  │   │
 *   │ └──────────────────────────────────────────┘   │
 *   └────────────────────────────────────────────────┘
 *
 * Empty-state (no next action): renders an "Add next action" CTA so the
 * card never reads as dead. Aligns with the ruleset rule "no dead screens".
 */
export default function NextActionCard({
  title,
  date, // optional: ISO string or Date or formatted string (schedule entries)
  dueIso, // optional: ISO timestamptz from a todo's due_at — renders a
          // tone-aware chip via dueStatus(). Null/undefined hides it.
  cta = 'Mark Complete',
  onComplete,
  onSchedule,
  loading
}) {
  const hasAction = !!title
  const due = dueStatus(dueIso)

  return (
    <div style={{
      padding: '18px 18px 16px',
      borderRadius: 16,
      background: 'var(--v3-surface)',
      border: '1px solid var(--v3-border)',
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }}>
      <span style={{
        fontFamily: 'var(--font-body)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: 'var(--v3-text-muted)'
      }}>
        Next Action
      </span>

      {hasAction ? (
        <>
          <div style={{
            fontFamily: 'var(--font-body)',
            fontSize: 16,
            fontWeight: 600,
            lineHeight: 1.35,
            color: 'var(--v3-text)',
            letterSpacing: '-0.005em'
          }}>
            {title}
          </div>
          {date && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              color: 'var(--v3-text-muted)',
              fontVariantNumeric: 'tabular-nums'
            }}>
              <Calendar size={13} aria-hidden="true" />
              {formatDate(date)}
            </div>
          )}
          {due && <DueStatusChip status={due} />}
          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={() => { hapticTap(); onComplete?.() }}
            disabled={loading}
            style={{
              marginTop: 4,
              width: '100%',
              padding: '12px 16px',
              borderRadius: 12,
              background: 'var(--v3-primary)',
              color: 'var(--v3-on-primary)',
              border: 'none',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.04em',
              cursor: loading ? 'wait' : 'pointer',
              opacity: loading ? 0.7 : 1,
              boxShadow: '0 4px 14px rgba(212, 175, 55, 0.20)',
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            {loading ? 'Working…' : cta}
          </motion.button>
        </>
      ) : (
        <>
          <div style={{
            fontFamily: 'var(--font-body)',
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--v3-text-muted)',
            lineHeight: 1.4
          }}>
            Nothing scheduled. Add the next step to keep momentum.
          </div>
          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={() => { hapticTap(); onSchedule?.() }}
            style={{
              marginTop: 4,
              width: '100%',
              padding: '12px 16px',
              borderRadius: 12,
              background: 'var(--v3-surface-2)',
              color: 'var(--v3-primary)',
              border: '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            + Schedule next step
          </motion.button>
        </>
      )}
    </div>
  )
}

/**
 * DueStatusChip — same three-tone palette as the cockpit NextTodoDueChip
 * and the per-row DueChipButton. Keeps the chip vocabulary consistent
 * everywhere a due_at surfaces.
 */
function DueStatusChip({ status }) {
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
      alignSelf: 'flex-start',
      padding: '3px 9px',
      borderRadius: 999,
      background: palette.bg,
      border: `1px solid ${palette.border}`,
      color: palette.color,
      fontFamily: 'var(--font-body)',
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
      lineHeight: 1.4
    }}>
      {status.label}
    </span>
  )
}

function formatDate(d) {
  try {
    const date = d instanceof Date ? d : new Date(d)
    if (isNaN(date.getTime())) return String(d)
    return date.toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric'
    }) + ' at ' + date.toLocaleTimeString(undefined, {
      hour: 'numeric', minute: '2-digit'
    })
  } catch {
    return String(d)
  }
}
