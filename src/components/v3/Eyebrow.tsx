import type { HTMLAttributes, ElementType } from 'react'

/**
 * Eyebrow, canonical small uppercase label.
 *
 * Replaces 50+ inline `<span style={{ fontSize: 12, fontWeight: 700,
 * letterSpacing: 0, textTransform: 'uppercase', color: ... }}>`
 * blocks scattered across screens.
 *
 * Tone variants:
 *   default → muted text
 *   gold    → primary gold
 *   alert   → danger
 *   success → success
 *
 * Usage:
 *   <Eyebrow>Section label</Eyebrow>
 *   <Eyebrow tone="gold">Today's Priorities</Eyebrow>
 *   <Eyebrow tone="alert">Needs attention today</Eyebrow>
 *   <Eyebrow as="div" tone="gold">Account</Eyebrow>
 */
type EyebrowTone = 'default' | 'gold' | 'alert' | 'success'

const TONE_COLOR: Record<EyebrowTone, string> = {
  default: 'var(--v3-text-muted)',
  gold:    'var(--v3-primary)',
  alert:   'var(--v3-danger-bright)',
  success: 'var(--v3-success-bright)'
}

type EyebrowProps = HTMLAttributes<HTMLElement> & {
  tone?: EyebrowTone
  as?: ElementType
}

export default function Eyebrow({
  children,
  tone = 'default',
  as: Component = 'span',
  className,
  style,
  ...rest
}: EyebrowProps) {
  return (
    <Component
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: 'var(--font-body)',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0,
        textTransform: 'uppercase',
        lineHeight: 1,
        color: TONE_COLOR[tone] || TONE_COLOR.default,
        ...style
      }}
      {...rest}
    >
      {children}
    </Component>
  )
}
