// src/lib/tabs.ts
//
// Keyboard and ARIA wiring for the custom tab strips (SegmentedTabs,
// SpecTabs, FilterPill asTab), following the WAI-ARIA tabs pattern with
// manual activation:
//   - Left and Right move focus to the previous or next tab, wrapping at
//     the ends; Home and End jump to the first or last tab;
//   - Enter or Space selects the focused tab through the button's own click;
//   - a roving tabIndex (0 on the selected tab, -1 on the rest) lets Tab
//     leave the strip for the panel in one press.

import type { KeyboardEvent } from 'react'

const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End'])

// Attach to the role="tablist" element, or to each tab when someone else
// renders the tablist (FilterPill asTab).
export function handleTablistKeyDown(e: KeyboardEvent<HTMLElement>) {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !KEYS.has(e.key)) return
  const tab = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]')
  const list = tab?.closest<HTMLElement>('[role="tablist"]')
  if (!tab || !list) return
  const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]')).filter((t) => (
    t.closest('[role="tablist"]') === list &&
    !t.hasAttribute('disabled') &&
    t.getAttribute('aria-disabled') !== 'true'
  ))
  const index = tabs.indexOf(tab)
  if (index < 0 || tabs.length < 2) return
  let next = index
  if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
  else if (e.key === 'ArrowRight') next = (index + 1) % tabs.length
  else if (e.key === 'Home') next = 0
  else next = tabs.length - 1
  e.preventDefault()
  tabs[next].focus()
  tabs[next].scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}

// Shared id scheme so a tab and its panel can point at each other. Pass
// the same idBase to the tab strip and spread tabPanelProps(idBase, id)
// on the element that renders the selected tab's content.
export function tabId(idBase: string, id: string) {
  return `${idBase}-tab-${id}`
}

export function tabPanelId(idBase: string, id: string) {
  return `${idBase}-panel-${id}`
}

export function tabPanelProps(idBase: string, id: string) {
  return {
    role: 'tabpanel' as const,
    id: tabPanelId(idBase, id),
    'aria-labelledby': tabId(idBase, id)
  }
}
