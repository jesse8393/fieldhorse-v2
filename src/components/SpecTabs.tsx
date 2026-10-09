// Shared industrial tab/segment control.
// Reuses the same chip pattern as filter chips: 2px radius, mono uppercase,
// diagonal gold stripe on the active option, engraved feel.
//
// Keyboard: WAI-ARIA tabs with manual activation (see lib/tabs.ts). Only
// the selected tab is in the Tab order; Left/Right/Home/End move between
// options and Enter or Space selects.

import { haptic } from './ActionSheet.tsx'
import { handleTablistKeyDown } from '../lib/tabs.ts'

export default function SpecTabs({
  options,
  value,
  onChange,
  ariaLabel = 'View',
  size = 'md'
}: any) {
  const selectedIndex = options.findIndex((opt: any) => opt.value === value)
  const stopIndex = selectedIndex >= 0 ? selectedIndex : 0
  return (
    <div className={`fh-spectabs fh-spectabs--${size}`} role="tablist" aria-label={ariaLabel} onKeyDown={handleTablistKeyDown}>
      {options.map((opt: any, i: number) => {
        const on = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={i === stopIndex ? 0 : -1}
            className={`fh-spectab${on ? ' is-on' : ''}`}
            onClick={() => {
              if (!on) haptic(8)
              onChange?.(opt.value)
            }}
          >
            {opt.code && <span className="fh-spectab__code">{opt.code}</span>}
            <span className="fh-spectab__label">{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
