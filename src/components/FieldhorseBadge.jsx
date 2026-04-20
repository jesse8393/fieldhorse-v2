/**
 * Small "FH" wordmark — top-left of AppHeader.
 * Static visual mark only: no tap target, no navigation, no cursor
 * pointer. Exists solely to signal "this app is Fieldhorse" without
 * competing with the user's centered company logo.
 *
 * Bebas Neue, F in Field Gold, H in ink-strong. Transparent background,
 * no border, no circle.
 */
export default function FieldhorseBadge({ size = 15 }) {
  return (
    <span
      aria-label="Fieldhorse"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        lineHeight: 1,
        fontFamily: 'var(--font-display)',
        fontSize: size,
        letterSpacing: '0.06em',
        fontWeight: 400,
        userSelect: 'none',
        pointerEvents: 'none'
      }}
    >
      <span style={{ color: 'var(--field-gold)' }}>F</span>
      <span style={{ color: 'var(--ink-strong)' }}>H</span>
    </span>
  )
}
