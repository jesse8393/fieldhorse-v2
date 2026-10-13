// retryFocus, where keyboard focus goes when Try again is pressed.
//
// Try again reads again, and while it does the error it sits in gives way
// to a skeleton, so the button that was pressed goes away. Focus would fall
// back to the top of the page and a keyboard or screen reader user would
// start over at Skip to content (Phase 8 follow up A). So Try again first
// moves focus to what stays on screen while the read runs: the heading or
// the region that holds the error. A screen that was all error has nothing
// of its own that stays, so focus waits on the page's main region.

/** What focus can move to: a heading, a card or a region that stays on screen. */
export type RetryFocusTarget = Pick<HTMLElement, 'focus' | 'hasAttribute' | 'setAttribute' | 'isConnected'>

/** The id of the page's main region (AppShell). */
export const MAIN_ID = 'fh-main'

/**
 * Moves focus to `target`, or to the page's main region when there is no
 * target or it has left the page. Neither is a control, so either takes
 * tabindex -1 (focusable by script, not by Tab) when it has no tabindex.
 * The page does not scroll: the target holds the button that was pressed.
 */
export function keepFocusOnRetry(target?: RetryFocusTarget | null): void {
  if (typeof document === 'undefined') return
  const el: RetryFocusTarget | null = target && target.isConnected
    ? target
    : document.getElementById(MAIN_ID)
  if (!el) return
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
  el.focus({ preventScroll: true })
}
