// The clock a screen reads so its "today", "this week" and "this month"
// roll over while the app stays open (Phase 8, task 6). It ticks every
// minute and again when the tab comes back into view, because a phone
// left on Money on Saturday night must show Sunday's numbers on Sunday
// morning without a reload. Money reads it through Invoices.tsx, and the
// desktop Schedule board reads it for the now line and the past slots.

import { useEffect, useState } from 'react'

export const MINUTE_MS = 60_000

/** What watchClock needs from the document: a visibility state and its change event. */
export type VisibleDocument = {
  visibilityState: DocumentVisibilityState
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

/**
 * Calls `tick` every `intervalMs`, and whenever `doc` becomes visible
 * again. Returns the function that stops both. Plain wiring, so a unit
 * test can run it in node with a stand in for the document.
 */
export function watchClock(
  tick: () => void,
  intervalMs = MINUTE_MS,
  doc: VisibleDocument | null = typeof document === 'undefined' ? null : document
): () => void {
  const timer = setInterval(tick, intervalMs)
  const onVisible = () => {
    if (doc?.visibilityState === 'visible') tick()
  }
  doc?.addEventListener('visibilitychange', onVisible)
  return () => {
    clearInterval(timer)
    doc?.removeEventListener('visibilitychange', onVisible)
  }
}

/** The current time, refreshed every minute and when the tab comes back into view. */
export function useNow(intervalMs = MINUTE_MS): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => watchClock(() => setNow(new Date()), intervalMs), [intervalMs])
  return now
}
