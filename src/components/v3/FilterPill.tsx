/**
 * FilterPill, canonical segmented filter chip with optional count.
 *
 * Replaces 4+ near-identical inline copies in Jobs, Subs, Bid,
 * Invoices. Active state uses the gold gradient + halo + on-primary
 * text pattern that's now consistent app-wide.
 *
 * Usage:
 *   <FilterPill
 *     active={filter === 'all'}
 *     count={11}
 *     onClick={() => setFilter('all')}
 *   >
 *     All
 *   </FilterPill>
 *
 * Notes:
 *   - Count chip is optional. Omit `count` for label-only pills.
 *   - The active state is intentionally bold (gold gradient + halo
 *     ring), this is THE primary affordance for "you are filtering".
 */
type FilterPillProps = import('react').ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean
  count?: number | null
  ariaLabel?: string
  size?: 'sm' | 'md'
  /**
   * ARIA role. Defaults to a standalone toggle button (role="button" +
   * aria-pressed), which is valid in ANY container. Pass `asTab` only
   * when the pill lives inside a role="tablist" (e.g. Work.tsx), then it
   * emits role="tab" + aria-selected. Invoices.tsx renders these pills in
   * a plain flex div, so the default keeps them from being orphaned
   * role="tab" nodes.
   */
  asTab?: boolean
}

export default function FilterPill({
  active = false,
  count,
  onClick,
  ariaLabel,
  children,
  size = 'md',
  asTab = false,
  className,
  style,
  ...rest
}: FilterPillProps) {
  const padY = size === 'sm' ? 7 : 9
  const padX = size === 'sm' ? 12 : 16
  const fontSize = size === 'sm' ? 11 : 12

  return (
    <button
      type="button"
      onClick={onClick}
      role={asTab ? 'tab' : 'button'}
      aria-selected={asTab ? active : undefined}
      aria-pressed={asTab ? undefined : active}
      aria-label={ariaLabel}
      className={className}
      style={{
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: `${padY}px ${padX}px`,
        borderRadius: 10,
        border: active
          ? '1px solid color-mix(in srgb, var(--v3-primary) 75%, transparent)'
          : '1px solid var(--v3-border-strong)',
        background: active
          ? 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)'
          : 'var(--v3-surface)',
        color: active ? 'var(--v3-on-primary)' : 'var(--v3-text)',
        fontFamily: 'var(--font-body)',
        fontSize,
        fontWeight: 700,
        letterSpacing: 0,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        boxShadow: active
          ? '0 0 0 3px rgba(201, 150, 58, 0.18), 0 6px 18px rgba(201, 150, 58, 0.32), 0 1px 0 rgba(242, 237, 228, 0.30) inset'
          : '0 1px 0 rgba(242, 237, 228, 0.04) inset, 0 2px 8px rgba(20, 20, 20, 0.20)',
        transition: 'background 160ms ease, border-color 160ms ease, color 160ms ease, box-shadow 200ms ease',
        ...style
      }}
      {...rest}
    >
      <span>{children}</span>
      {count != null && (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 18,
          height: 18,
          padding: '0 4px',
          borderRadius: 10,
          background: active
            ? 'rgba(20, 20, 20, 0.22)'
            : 'var(--v3-surface-2)',
          color: active ? 'var(--v3-on-primary)' : 'var(--v3-text-muted)',
          fontSize: 12,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1
        }}>
          {count}
        </span>
      )}
    </button>
  )
}
