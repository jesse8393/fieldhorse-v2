import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * useInfiniteRender — cap how many rows are mounted, grow on scroll.
 *
 * The list screens (Jobs / Leads / Clients / Invoices) fetch and then
 * render every row as a DOM node — thousands of framer-motion + swipe
 * cards at scale, which janks scroll and blows up memory. This mounts a
 * bounded window (default 40) and grows it by `step` whenever a sentinel
 * near the bottom scrolls into view, so the list feels infinite while the
 * DOM stays small. We only ever ADD rows below the fold, so there is no
 * scroll-position jump (unlike fixed-window virtualization).
 *
 * `resetKey` should change whenever the logical list changes (filter tab,
 * search text, sort) so the window collapses back to the top. It should
 * NOT be the array itself (a new reference every render would reset the
 * window constantly) — pass a stable primitive like `${filter}|${query}`.
 */
export function useInfiniteRender<T>(
  items: T[],
  resetKey: unknown,
  opts?: { initial?: number; step?: number }
) {
  const initial = opts?.initial ?? 40
  const step = opts?.step ?? 40
  const [count, setCount] = useState(initial)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // Collapse back to the first page when the logical list changes.
  useEffect(() => {
    setCount(initial)
  }, [resetKey, initial])

  const visible = useMemo(() => items.slice(0, count), [items, count])
  const hasMore = count < items.length

  useEffect(() => {
    if (!hasMore) return
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      // Environments without IO (SSR / very old) just render what they have;
      // a resize/scroll can't grow the window, so fall back to showing all.
      setCount(items.length)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setCount((c) => Math.min(c + step, items.length))
        }
      },
      // Prefetch a screenful ahead so the next rows are already mounted by
      // the time they reach the viewport — no visible pop-in.
      { rootMargin: '800px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, step, items.length])

  return { visible, sentinelRef, hasMore, shownCount: Math.min(count, items.length) }
}
