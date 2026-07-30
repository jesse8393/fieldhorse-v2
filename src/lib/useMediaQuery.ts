import { useEffect, useState } from 'react'

/**
 * useMediaQuery, subscribe to a CSS media-query string.
 *
 * Returns true if the query currently matches. Updates whenever the
 * match state changes (window resize, device-pixel-ratio change, etc).
 *
 * SSR-safe: defaults to `false` when `window` is unavailable. The first
 * client render syncs to the real value via the layout effect so we
 * don't paint a mismatched tree.
 *
 * Used by responsive screens (Jobs, Clients, Schedule) to dispatch
 * between a desktop-first composition (>=900px) and the existing
 * mobile composition (<900px). Each screen owns its data fetching
 * and passes real data + handlers into both branches, the hook only
 * answers "which branch should render?".
 *
 * @param query - e.g. '(min-width: 900px)'
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    try { return window.matchMedia(query).matches } catch { return false }
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    let mql: MediaQueryList
    try { mql = window.matchMedia(query) } catch { return }
    const update = () => setMatches(mql.matches)
    update()
    if (mql.addEventListener) mql.addEventListener('change', update)
    else if (mql.addListener) mql.addListener(update)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', update)
      else if (mql.removeListener) mql.removeListener(update)
    }
  }, [query])

  return matches
}

/** Convenience: true when the viewport is >=900px (the desktop break). */
export function useIsDesktop() {
  return useMediaQuery('(min-width: 900px)')
}
