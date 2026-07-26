import { motion } from 'framer-motion'
import { hapticTap } from '../../lib/haptics.ts'

/**
 * v3 segmented tab bar.
 *
 * Two visual variants:
 *   - 'underline' (default): full-width row, gold underline + label color shift
 *     on active. Used for top-level tabs (OVERVIEW · DETAILS · FINANCIALS · FILES).
 *   - 'pill': scrollable pill row. Used for sub-tabs inside a v3 group.
 *
 * @param {object} props
 * @param {string} props.value - current tab id
 * @param {(next: string) => void} props.onChange
 * @param {Array<{id: string, label: string, count?: number}>} props.tabs
 * @param {'underline' | 'pill'} [props.variant='underline']
 */
type Tab = { id: string; label: import('react').ReactNode; count?: number }

type SegmentedTabsProps = {
  value: string
  onChange: (next: string) => void
  tabs: Tab[]
  variant?: 'underline' | 'pill'
  ariaLabel?: string
}

export default function SegmentedTabs({ value, onChange, tabs, variant = 'underline', ariaLabel = 'Tabs' }: SegmentedTabsProps) {
  if (variant === 'pill') {
    return (
      <div role="tablist" aria-label={ariaLabel} className="fh-scrollbar-hidden" style={{
        display: 'flex',
        gap: 6,
        padding: '0 20px 12px',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        // Desktop drew a full native scrollbar (arrow buttons and all)
        // under the strip even when all tabs fit (UI audit #25).
        scrollbarWidth: 'none'
      }}>
        {tabs.map((t) => {
          const isActive = value === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => { hapticTap(); onChange(t.id) }}
              style={{
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 12px',
                borderRadius: 999,
                border: isActive
                  ? '1px solid color-mix(in srgb, var(--v3-primary) 45%, transparent)'
                  : '1px solid var(--v3-border)',
                background: isActive ? 'var(--v3-primary-soft)' : 'transparent',
                color: isActive ? 'var(--v3-primary)' : 'var(--v3-text-muted)',
                fontFamily: 'var(--font-body)',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.06em',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                transition: 'background-color 160ms ease, border-color 160ms ease, color 160ms ease'
              }}
            >
              {t.label}
              {typeof t.count === 'number' && (
                <span style={{ fontSize: 10, opacity: 0.85, fontVariantNumeric: 'tabular-nums' }}>
                  {t.count}
                </span>
              )}
            </button>
          )
        })}
      </div>
    )
  }

  // 'underline' — top-level, full-width segmented control matching mockup
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        display: 'flex',
        margin: '0 20px',
        borderBottom: '1px solid var(--v3-border)',
        position: 'relative'
      }}
    >
      {tabs.map((t) => {
        const isActive = value === t.id
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => { hapticTap(); onChange(t.id) }}
            style={{
              flex: 1,
              position: 'relative',
              padding: '14px 4px',
              background: 'transparent',
              border: 'none',
              color: isActive ? 'var(--v3-primary)' : 'var(--v3-text-muted)',
              fontFamily: 'var(--font-body)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
              transition: 'color 160ms ease'
            }}
          >
            {t.label}
            {isActive && (
              <motion.span
                layoutId="v3-segmented-underline"
                style={{
                  position: 'absolute',
                  left: 8,
                  right: 8,
                  bottom: -1,
                  height: 2,
                  background: 'var(--v3-primary)',
                  borderRadius: 2
                }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
