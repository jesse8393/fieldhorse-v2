/**
 * IconButton — canonical 36×36 surface-tile icon button.
 *
 * Replaces inline icon-button styles in AppHeader actions, ClientDetail
 * action row, BottomNav drawer close, etc. Matches the prototype's
 * `.icon-btn` pattern: square-rounded surface tile with hairline border.
 *
 * Variants:
 *   default → surface-1 + muted ink
 *   primary → gold gradient bg + on-primary ink (use sparingly — for
 *             the ONE gold action per screen, not the standard surface)
 *   ghost   → transparent + muted ink + no border
 *   danger  → muted at rest, red on hover (sign-out style)
 *
 * Sizes:
 *   sm → 32px
 *   md → 36px (default — matches prototype)
 *   lg → 44px (touch-friendly bottom-bar size)
 *
 * Optional `dot` prop renders a tiny gold notification dot in the
 * top-right of the tile.
 *
 * Usage:
 *   <IconButton ariaLabel="Search" onClick={openSearch}>
 *     <Search size={17} />
 *   </IconButton>
 *
 *   <IconButton ariaLabel="Notifications" dot>
 *     <Bell size={17} />
 *   </IconButton>
 *
 *   <IconButton ariaLabel="Sign out" variant="danger" onClick={signOut}>
 *     <LogOut size={15} />
 *   </IconButton>
 */
import { useState } from 'react'

const SIZE_PX = { sm: 32, md: 36, lg: 44 }

const VARIANT_BASE = {
  default: {
    background: 'var(--v3-surface)',
    border: '1px solid var(--v3-border-strong)',
    color: 'var(--v3-text-muted)'
  },
  primary: {
    background: 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
    border: '1px solid color-mix(in srgb, var(--v3-primary) 60%, transparent)',
    color: 'var(--v3-on-primary)'
  },
  ghost: {
    background: 'transparent',
    border: '1px solid transparent',
    color: 'var(--v3-text-muted)'
  },
  danger: {
    background: 'transparent',
    border: '1px solid var(--v3-border-strong)',
    color: 'var(--v3-text-muted)'
  }
}

export default function IconButton({
  children,
  onClick,
  ariaLabel,
  title,
  variant = 'default',
  size = 'md',
  dot = false,
  disabled = false,
  type = 'button',
  className,
  style,
  ...rest
}) {
  const [hover, setHover] = useState(false)
  const px = SIZE_PX[size] ?? SIZE_PX.md
  const base = VARIANT_BASE[variant] || VARIANT_BASE.default

  // Danger variant: red on hover. Default + ghost: subtle ink lift.
  const hoverColor =
    variant === 'danger' ? 'var(--v3-danger-bright)'
    : variant === 'ghost'   ? 'var(--v3-text)'
    : variant === 'default' ? 'var(--v3-text)'
    : base.color

  const hoverBorder =
    variant === 'danger'
      ? 'color-mix(in srgb, var(--v3-danger) 50%, transparent)'
      : variant === 'default'
      ? 'rgba(255, 240, 210, 0.30)'
      : base.border

  return (
    <button
      type={type}
      onClick={onClick}
      aria-label={ariaLabel}
      title={title || ariaLabel}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={className}
      style={{
        position: 'relative',
        flexShrink: 0,
        width: px,
        height: px,
        borderRadius: px === 32 ? 8 : 10,
        background: base.background,
        border: hover && !disabled ? `1px solid ${hoverBorder}` : base.border,
        color: hover && !disabled ? hoverColor : base.color,
        display: 'grid',
        placeItems: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        WebkitTapHighlightColor: 'transparent',
        transition: 'color 140ms ease, border-color 140ms ease, background 140ms ease',
        ...style
      }}
      {...rest}
    >
      {children}
      {dot && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--v3-primary-bright)',
            boxShadow: '0 0 6px rgba(228, 190, 111, 0.6)'
          }}
        />
      )}
    </button>
  )
}
