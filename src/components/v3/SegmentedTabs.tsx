import { useEffect, useId, useRef } from 'react'
import { motion } from 'framer-motion'
import { hapticTap } from '../../lib/haptics.ts'
import { handleTablistKeyDown, tabId, tabPanelId } from '../../lib/tabs.ts'

/**
 * v3 segmented tab bar.
 *
 * Two visual variants:
 *   - 'underline' (default): full-width row, gold underline + label color shift
 *     on active. Used for top-level tabs (OVERVIEW · DETAILS · FINANCIALS · FILES).
 *   - 'pill': scrollable pill row. Used for sub-tabs inside a v3 group.
 *
 * Keyboard: WAI-ARIA tabs with manual activation. Only the selected tab is
 * in the Tab order; Left/Right/Home/End move between tabs and Enter or
 * Space selects. Pass `idBase` and spread tabPanelProps(idBase, value)
 * from lib/tabs.ts on the content wrapper to link each tab to its panel.
 *
 * Both variants scroll sideways when the tabs do not fit (a job's eight
 * tabs on a phone), and keep the selected tab in view.
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
  // Shared with tabPanelProps() on the panel. Without it the tabs still
  // get ids, but no aria-controls, since there is no panel to point at.
  idBase?: string
}

export default function SegmentedTabs({ value, onChange, tabs, variant = 'underline', ariaLabel = 'Tabs', idBase }: SegmentedTabsProps) {
  const autoBase = useId()
  const base = idBase || `fh-tabs${autoBase}`
  // Roving tabIndex: the selected tab is the one Tab stop. If the value
  // matches no tab, the first tab takes it so the strip stays reachable.
  const selectedIndex = tabs.findIndex((t) => t.id === value)
  const stopIndex = selectedIndex >= 0 ? selectedIndex : 0
  const scrollRef = useRef<HTMLDivElement>(null)

  // Bring the selected tab into the strip's visible range, sideways only,
  // so a deep link to the last tab never opens on a clipped label.
  useEffect(() => {
    const strip = scrollRef.current
    if (!strip || strip.scrollWidth <= strip.clientWidth) return
    const tab = strip.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    if (!tab) return
    const stripBox = strip.getBoundingClientRect()
    const tabBox = tab.getBoundingClientRect()
    if (tabBox.left < stripBox.left) strip.scrollLeft -= stripBox.left - tabBox.left + 8
    else if (tabBox.right > stripBox.right) strip.scrollLeft += tabBox.right - stripBox.right + 8
  }, [value])
  const tabA11y = (t: Tab, i: number) => {
    const isActive = value === t.id
    return {
      id: tabId(base, t.id),
      role: 'tab' as const,
      'aria-selected': isActive,
      'aria-controls': idBase && isActive ? tabPanelId(idBase, t.id) : undefined,
      tabIndex: i === stopIndex ? 0 : -1
    }
  }

  if (variant === 'pill') {
    return (
      <div ref={scrollRef} role="tablist" aria-label={ariaLabel} onKeyDown={handleTablistKeyDown} className="fh-scrollbar-hidden" style={{
        display: 'flex',
        gap: 8,
        padding: '0 24px 12px',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        // Desktop drew a full native scrollbar (arrow buttons and all)
        // under the strip even when all tabs fit (UI audit #25).
        scrollbarWidth: 'none'
      }}>
        {tabs.map((t, i) => {
          const isActive = value === t.id
          return (
            <button
              key={t.id}
              type="button"
              {...tabA11y(t, i)}
              onClick={() => { hapticTap(); onChange(t.id) }}
              style={{
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 10,
                border: isActive
                  ? '1px solid color-mix(in srgb, var(--v3-primary) 45%, transparent)'
                  : '1px solid var(--v3-border)',
                background: isActive ? 'var(--v3-primary-soft)' : 'transparent',
                color: isActive ? 'var(--v3-primary-text)' : 'var(--v3-text-muted)',
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 0,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                transition: 'background-color 160ms ease, border-color 160ms ease, color 160ms ease'
              }}
            >
              {t.label}
              {typeof t.count === 'number' && (
                <span style={{ fontSize: 12, opacity: 0.85, fontVariantNumeric: 'tabular-nums' }}>
                  {t.count}
                </span>
              )}
            </button>
          )
        })}
      </div>
    )
  }

  // 'underline', top-level, full-width segmented control matching mockup.
  // Tabs share the width equally when they fit; otherwise each keeps its
  // label on one line and the strip scrolls sideways.
  return (
    <div
      ref={scrollRef}
      className="fh-scrollbar-hidden"
      style={{
        margin: '0 20px',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none'
      }}
    >
      <div
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={handleTablistKeyDown}
        style={{
          display: 'flex',
          minWidth: '100%',
          width: 'max-content',
          borderBottom: '1px solid var(--v3-border)',
          position: 'relative'
        }}
      >
        {tabs.map((t, i) => {
          const isActive = value === t.id
          return (
            <button
              key={t.id}
              type="button"
              {...tabA11y(t, i)}
              onClick={() => { hapticTap(); onChange(t.id) }}
              style={{
                flex: '1 1 0',
                minWidth: 'max-content',
                whiteSpace: 'nowrap',
                position: 'relative',
                padding: '12px 4px',
                // Draw the keyboard focus ring inside the tab: the
                // scrolling strip would clip a ring drawn outside it.
                outlineOffset: -2,
                background: 'transparent',
                border: 'none',
                color: isActive ? 'var(--v3-primary-text)' : 'var(--v3-text-muted)',
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 0,
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
                    background: 'var(--v3-primary-text)',
                    borderRadius: 10
                  }}
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
