import { useMemo } from 'react'

/**
 * Job Health donut, circular progress with center number + tier label.
 *
 *   ╭───────╮
 *   │  ╱   ╲│
 *   │ │ 82 ││
 *   │ │Good││
 *   │  ╲   ╱│
 *   ╰───────╯
 *
 * Tiers (mockup-aligned):
 *   80–100 → "Good"      (success green)
 *   50–79  → "At risk"   (gold)
 *    0–49  → "Behind"    (danger red)
 *
 * @param {number} value 0..100
 */
type HealthDonutProps = {
  value?: number
  size?: number
  stroke?: number
  label?: import('react').ReactNode
}

export default function HealthDonut({ value = 0, size = 110, stroke = 9, label }: HealthDonutProps) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0))
  // `color` paints the ring; `ink` is the text safe shade of the same
  // tone for the number and the label under it.
  const tier = useMemo(() => {
    if (safe >= 80) return { name: 'Good',    color: 'var(--v3-success-bright)', ink: 'var(--v3-success-text)', soft: 'var(--v3-success-soft)' }
    if (safe >= 50) return { name: 'At risk', color: 'var(--v3-warn)',            ink: 'var(--v3-primary-text)', soft: 'var(--v3-warn-soft)' }
    return                  { name: 'Behind',  color: 'var(--v3-danger-bright)',  ink: 'var(--v3-danger-text)',  soft: 'var(--v3-danger-soft)' }
  }, [safe])
  // Screen readers hear the same word sighted users see: a caller's label
  // (Overview passes the computed health label) wins over the tier name.
  const shownLabel = label || tier.name
  const spokenLabel = typeof label === 'string' || typeof label === 'number' ? String(label) : tier.name

  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - (safe / 100) * circumference

  return (
    <div style={{
      padding: '16px 16px 16px',
      borderRadius: 10,
      background: 'var(--v3-surface)',
      border: '1px solid var(--v3-border)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: 12
    }}>
      <span style={{
        fontFamily: 'var(--font-body)',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0,
        color: 'var(--v3-text-muted)'
      }}>
        Job health
      </span>

      <div style={{
        position: 'relative',
        width: '100%',
        display: 'grid',
        placeItems: 'center'
      }}>
        <svg width={size} height={size} role="img" aria-label={`Job health ${Math.round(safe)} out of 100, ${spokenLabel}`}>
          {/* Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--v3-glass-tint-2)"
            strokeWidth={stroke}
          />
          {/* Progress */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={tier.color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(0.2, 0.8, 0.2, 1)' }}
          />
        </svg>
        {/* Visual only: the svg's label already says the score and word. */}
        <div aria-hidden="true" style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none'
        }}>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 24,
            color: tier.ink,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums'
          }}>
            {Math.round(safe)}
          </span>
          <span style={{
            marginTop: 4,
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 0,
            color: tier.ink
          }}>
            {shownLabel}
          </span>
        </div>
      </div>
    </div>
  )
}
