import { Check } from 'lucide-react'
import { STAGES, STAGE_MAP } from '../../lib/stages.ts'

// Visual stage progression — collapses 6 raw stages to a 5-step linear
// timeline that matches the mockup. `lost` is rendered as a small inline
// banner above the timeline rather than a sixth dot, since it's a
// terminal failure state, not a position in the flow.
const TIMELINE_STAGES = ['lead', 'quote', 'job', 'invoice', 'closed']

/**
 * 5-dot stage timeline matching the Job Detail mockup.
 *
 *   ●━━━━●━━━━○━━━━○━━━━○
 *   Lead Quote Active Close Won
 *
 * - Completed dots filled with stage color, with thin connector line.
 * - Current dot enlarged + gold ring + label highlighted.
 * - Lost stage shows a danger banner instead of timeline progression.
 */
export default function StageTimeline({ currentStage }) {
  if (currentStage === 'lost') {
    return (
      <div style={{
        margin: '0 20px 16px',
        padding: '10px 14px',
        borderRadius: 12,
        background: 'rgba(192, 57, 43, 0.10)',
        border: '1px solid rgba(192, 57, 43, 0.32)',
        color: '#F47366',
        fontFamily: 'var(--font-body)',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        textAlign: 'center'
      }}>
        Lost — closed without conversion
      </div>
    )
  }

  const currentIdx = TIMELINE_STAGES.indexOf(currentStage)
  // unknown / unmapped → render as if we're at the very start, no dots filled
  const safeIdx = currentIdx === -1 ? -1 : currentIdx

  // Fraction of the rail that should be "filled" with the gold gradient.
  // Rail spans between dot 1 and dot N (TIMELINE_STAGES.length); each
  // step is 1 / (N-1). Current step gets a half-fill so the operator
  // sees in-progress motion.
  const totalSteps = TIMELINE_STAGES.length - 1
  const filledFrac = safeIdx <= 0
    ? 0
    : Math.min(1, (safeIdx - 0.5) / totalSteps)

  return (
    <div
      role="list"
      aria-label="Pipeline stage progress"
      style={{
        margin: '0 20px 18px',
        padding: '14px 8px 10px',
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border)',
        borderRadius: 12,
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between'
      }}
    >
      {/* Base rail — sits behind the dots at dot-center height (~28px from card top). */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 28,
          right: 28,
          top: 28,
          height: 1,
          background: 'var(--v3-border)',
          zIndex: 1
        }}
      />
      {/* Filled rail — gold gradient with glow, sized to current progress. */}
      {filledFrac > 0 && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 28,
            top: 27,
            height: 2,
            width: `calc((100% - 56px) * ${filledFrac})`,
            background: 'linear-gradient(90deg, color-mix(in srgb, var(--v3-primary) 70%, transparent), var(--v3-primary))',
            boxShadow: '0 0 8px rgba(228, 190, 111, 0.45)',
            borderRadius: 99,
            zIndex: 1
          }}
        />
      )}
      {TIMELINE_STAGES.map((stageId, i) => {
        const meta = STAGE_MAP[stageId]
        const isComplete = i < safeIdx
        const isCurrent = i === safeIdx
        const isFuture = i > safeIdx
        const labelColor = isCurrent
          ? 'var(--v3-primary)'
          : isComplete
            ? 'var(--v3-text)'
            : 'var(--v3-text-muted)'

        // Dot styling per the design's jd2-step__dot states:
        //   done    → soft gold fill + gold border + check glyph
        //   current → bright gold gradient + dark digit + gold glow
        //   future  → surface-2 fill + hairline border + muted digit
        const dotStyle = isCurrent ? {
          background: 'linear-gradient(180deg, var(--v3-primary-hot), var(--v3-primary))',
          border: '1px solid transparent',
          color: 'var(--v3-on-primary)',
          boxShadow: '0 0 0 4px color-mix(in srgb, var(--v3-primary) 18%, transparent), 0 0 14px rgba(228, 190, 111, 0.4)'
        } : isComplete ? {
          background: 'var(--v3-primary-soft)',
          border: '1px solid color-mix(in srgb, var(--v3-primary) 32%, transparent)',
          color: 'var(--v3-primary)',
          boxShadow: 'none'
        } : {
          background: 'var(--v3-surface-2)',
          border: '1px solid var(--v3-border)',
          color: 'var(--v3-text-muted)',
          boxShadow: 'none'
        }

        return (
          <div
            key={stageId}
            role="listitem"
            aria-current={isCurrent ? 'step' : undefined}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 7,
              position: 'relative',
              minWidth: 0,
              zIndex: 2
            }}
          >
            {/* Dot */}
            <span
              aria-hidden="true"
              style={{
                width: 28, height: 28, borderRadius: '50%',
                display: 'grid', placeItems: 'center',
                fontFamily: 'var(--font-display)',
                fontSize: 12,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                position: 'relative',
                transition: 'background 200ms ease, border-color 200ms ease, box-shadow 200ms ease',
                ...dotStyle
              }}
            >
              {isComplete ? <Check size={13} strokeWidth={2.6} aria-hidden="true" /> : (i + 1)}
            </span>
            {/* Label */}
            <span style={{
              fontFamily: 'var(--font-body)',
              fontSize: 9,
              fontWeight: isCurrent ? 700 : 600,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: labelColor,
              textAlign: 'center',
              lineHeight: 1.2,
              opacity: isFuture ? 0.7 : 1
            }}>
              {/* "Active" reads better than "Job" for the in-progress
                  stage; "Complete" matches contractor vocab better than
                  "Won" / "Closed" (the DB key stays 'closed'). */}
              {stageId === 'job' ? 'Active' : stageId === 'closed' ? 'Complete' : meta.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
