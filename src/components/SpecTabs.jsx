// Shared industrial tab/segment control.
// Reuses the same chip pattern as filter chips: 2px radius, mono uppercase,
// diagonal gold stripe on the active option, engraved feel.

import { haptic } from './ActionSheet.jsx'

export default function SpecTabs({
  options,
  value,
  onChange,
  ariaLabel = 'View',
  size = 'md'
}) {
  return (
    <div className={`fh-spectabs fh-spectabs--${size}`} role="tablist" aria-label={ariaLabel}>
      {options.map((opt) => {
        const on = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={on}
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
