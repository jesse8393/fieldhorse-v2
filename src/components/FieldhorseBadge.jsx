import { useNavigate } from 'react-router-dom'

/**
 * Small "FH" wordmark — top-left of AppHeader.
 * Matches the FIELDHORSE wordmark compressed to two letters:
 *   F in Field Gold, H in white, Bebas Neue, tight letter-spacing.
 * No circle, no border, transparent background.
 * Tap → /settings.
 */
export default function FieldhorseBadge({ size = 26 }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={() => navigate('/settings')}
      aria-label="Settings"
      title="Fieldhorse — open settings"
      style={{
        background: 'transparent',
        border: 'none',
        padding: 0,
        margin: 0,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        lineHeight: 1,
        fontFamily: 'var(--font-display)',
        fontSize: size,
        letterSpacing: '0.06em',
        fontWeight: 400,
        height: size
      }}
    >
      <span style={{ color: 'var(--field-gold)' }}>F</span>
      <span style={{ color: 'var(--ink-strong)' }}>H</span>
    </button>
  )
}
