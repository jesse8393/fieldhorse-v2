/**
 * Eyebrow — canonical small uppercase label.
 *
 * Replaces 50+ inline `<span style={{ fontSize: 10, fontWeight: 700,
 * letterSpacing: '0.18em', textTransform: 'uppercase', color: ... }}>`
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
const TONE_COLOR = {
  default: 'var(--v3-text-muted)',
  gold:    'var(--v3-primary)',
  alert:   'var(--v3-danger-bright)',
  success: 'var(--v3-success-bright)'
}

export default function Eyebrow({
  children,
  tone = 'default',
  as: Component = 'span',
  className,
  style,
  ...rest
}) {
  return (
    <Component
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'var(--font-body)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.10em',
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
