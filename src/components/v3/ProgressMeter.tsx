/**
 * Labeled horizontal progress meter for the Job Detail Overview.
 *
 *   Job Progress                                 65%
 *   ████████████████████░░░░░░░░░░░░
 *   8 of 12 tasks completed              View Tasks ›
 *
 * Color follows tier: 0–49 danger, 50–79 gold, 80–100 success.
 */
type ProgressMeterProps = {
  label?: import('react').ReactNode
  value?: number          // 0..100
  caption?: import('react').ReactNode  // e.g. "8 of 12 tasks completed"
  trailing?: import('react').ReactNode // optional right-side element
  height?: number
}

export default function ProgressMeter({
  label,
  value = 0,
  caption,
  trailing,
  height = 8
}: ProgressMeterProps) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0))
  const color = safe >= 80
    ? 'var(--v3-success-bright)'
    : safe >= 50
      ? 'var(--v3-primary)'
      : 'var(--v3-danger-bright)'

  return (
    <div style={{
      padding: '16px 16px 16px',
      borderRadius: 10,
      background: 'var(--v3-surface)',
      border: '1px solid var(--v3-border)',
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 8
      }}>
        <span style={{
          fontFamily: 'var(--font-body)',
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--v3-text)'
        }}>
          {label}
        </span>
        <span style={{
          fontFamily: 'var(--font-body)',
          fontSize: 14,
          fontWeight: 700,
          color,
          fontVariantNumeric: 'tabular-nums'
        }}>
          {Math.round(safe)}%
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={Math.round(safe)}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          position: 'relative',
          height,
          borderRadius: 10,
          background: 'var(--v3-glass-tint-2)',
          overflow: 'hidden'
        }}
      >
        <span style={{
          position: 'absolute',
          inset: 0,
          width: `${safe}%`,
          background: color,
          borderRadius: 10,
          transition: 'width 500ms cubic-bezier(0.2, 0.8, 0.2, 1)'
        }} />
      </div>

      {(caption || trailing) && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8
        }}>
          {caption && (
            <span style={{
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              color: 'var(--v3-text-muted)',
              fontVariantNumeric: 'tabular-nums'
            }}>
              {caption}
            </span>
          )}
          {trailing}
        </div>
      )}
    </div>
  )
}
