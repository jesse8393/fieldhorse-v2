import { useMemo } from 'react'

/**
 * Job Health donut — circular progress with center number + tier label.
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
 *   50–79  → "At Risk"   (gold)
 *    0–49  → "Behind"    (danger red)
 *
 * @param {number} value 0..100
 */
export default function HealthDonut({ value = 0, size = 110, stroke = 9, label }) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0))
  const tier = useMemo(() => {
    if (safe >= 80) return { name: 'Good', color: '#4ADE80', soft: 'rgba(46, 204, 113, 0.18)' }
    if (safe >= 50) return { name: 'At Risk', color: '#E8C25A', soft: 'rgba(212, 175, 55, 0.18)' }
    return { name: 'Behind', color: '#F47366', soft: 'rgba(192, 57, 43, 0.18)' }
  }, [safe])

  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - (safe / 100) * circumference

  return (
    <div style={{
      padding: '18px 18px 16px',
      borderRadius: 16,
      background: 'var(--v3-surface)',
      border: '1px solid var(--v3-border)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: 12
    }}>
      <span style={{
        fontFamily: 'var(--font-body)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: 'var(--v3-text-muted)'
      }}>
        Job Health
      </span>

      <div style={{
        position: 'relative',
        width: '100%',
        display: 'grid',
        placeItems: 'center'
      }}>
        <svg width={size} height={size} role="img" aria-label={`Job health ${safe} out of 100, ${tier.name}`}>
          {/* Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255, 255, 255, 0.06)"
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
        <div style={{
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
            fontSize: 30,
            color: tier.color,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums'
          }}>
            {Math.round(safe)}
          </span>
          <span style={{
            marginTop: 4,
            fontFamily: 'var(--font-body)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: tier.color
          }}>
            {label || tier.name}
          </span>
        </div>
      </div>
    </div>
  )
}
