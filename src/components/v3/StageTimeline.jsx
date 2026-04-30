import { STAGES, STAGE_MAP } from '../../lib/stages.js'

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

  return (
    <div
      role="list"
      aria-label="Pipeline stage progress"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        margin: '0 20px 18px',
        padding: '14px 6px 0',
        position: 'relative'
      }}
    >
      {TIMELINE_STAGES.map((stageId, i) => {
        const meta = STAGE_MAP[stageId]
        const isComplete = i < safeIdx
        const isCurrent = i === safeIdx
        const isFuture = i > safeIdx
        const dotColor = isComplete || isCurrent ? meta.color : 'transparent'
        const ringColor = isCurrent
          ? 'var(--v3-primary)'
          : isComplete
            ? meta.color
            : 'rgba(255,255,255,0.12)'
        const labelColor = isCurrent
          ? 'var(--v3-text)'
          : isComplete
            ? 'var(--v3-text)'
            : 'var(--v3-text-muted)'

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
              gap: 6,
              position: 'relative',
              minWidth: 0
            }}
          >
            {/* Connector line to NEXT dot (skip for last) */}
            {i < TIMELINE_STAGES.length - 1 && (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  top: isCurrent ? 14 : 12,
                  left: '60%',
                  right: '-40%',
                  height: 1.5,
                  background: i < safeIdx
                    ? meta.color
                    : 'rgba(255, 255, 255, 0.08)',
                  zIndex: 0
                }}
              />
            )}
            {/* Dot */}
            <span
              aria-hidden="true"
              style={{
                width: isCurrent ? 28 : 24,
                height: isCurrent ? 28 : 24,
                borderRadius: '50%',
                background: dotColor,
                border: `2px solid ${ringColor}`,
                boxShadow: isCurrent
                  ? `0 0 0 4px color-mix(in srgb, var(--v3-primary) 18%, transparent)`
                  : 'none',
                display: 'grid',
                placeItems: 'center',
                fontFamily: 'var(--font-body)',
                fontSize: 11,
                fontWeight: 700,
                color: isComplete || isCurrent ? 'var(--v3-on-primary)' : 'var(--v3-text-muted)',
                fontVariantNumeric: 'tabular-nums',
                position: 'relative',
                zIndex: 1,
                transition: 'background 200ms ease, border-color 200ms ease, box-shadow 200ms ease'
              }}
            >
              {i + 1}
            </span>
            {/* Label */}
            <span style={{
              fontFamily: 'var(--font-body)',
              fontSize: 10,
              fontWeight: isCurrent ? 700 : 600,
              letterSpacing: '0.04em',
              color: labelColor,
              textAlign: 'center',
              lineHeight: 1.2,
              opacity: isFuture ? 0.55 : 1
            }}>
              {/* Mockup uses "Active" for the job stage, "Won" for closed */}
              {stageId === 'job' ? 'Active' : stageId === 'closed' ? 'Won' : meta.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
