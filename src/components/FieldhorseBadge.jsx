import { useNavigate } from 'react-router-dom'

/**
 * Small "FH" monogram badge — lives top-left in AppHeader.
 * Reads clean at 24px, Field Gold tint at ~70% opacity so it doesn't
 * compete with the user's centered company logo.
 * Tap → /settings.
 */
export default function FieldhorseBadge({ size = 26 }) {
  const navigate = useNavigate()
  const inner = Math.max(12, size - 4)
  return (
    <button
      type="button"
      onClick={() => navigate('/settings')}
      aria-label="Settings"
      title="Fieldhorse — open settings"
      style={{
        width: size,
        height: size,
        minWidth: size,
        padding: 0,
        borderRadius: '50%',
        background: 'rgba(201,150,58,0.08)',
        border: '1px solid rgba(201,150,58,0.35)',
        color: 'var(--field-gold-bright)',
        display: 'inline-grid',
        placeItems: 'center',
        cursor: 'pointer',
        opacity: 0.72,
        transition: 'opacity 160ms ease, transform 160ms ease'
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.72' }}
    >
      <span
        aria-hidden="true"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: Math.round(inner * 0.48),
          letterSpacing: '0.04em',
          lineHeight: 1,
          color: 'var(--field-gold-bright)'
        }}
      >
        FH
      </span>
    </button>
  )
}
