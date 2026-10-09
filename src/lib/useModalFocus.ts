// src/lib/useModalFocus.ts
//
// Focus management for modal dialogs (WAI-ARIA dialog pattern), shared by
// ActionSheet, the BottomNav More drawer and the mobile search overlay.
// Same behavior ConfirmSheet implements inline:
//   - on open, remember what had focus and move focus into the dialog
//     (the `initialFocus` element when given, otherwise the first
//     focusable element, otherwise the dialog itself if it is focusable);
//   - while open, Tab and Shift+Tab cycle inside the dialog;
//   - on close, hand focus back to the element that opened it.
// Escape stays with each dialog, which already closes on it.

import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => (
    el.getAttribute('aria-hidden') !== 'true' &&
    !el.closest('[inert]') &&
    // Skip anything not rendered (display: none, collapsed sections).
    el.getClientRects().length > 0
  ))
}

type ModalFocusOptions = {
  // Element to focus first instead of the first focusable one.
  initialFocus?: RefObject<HTMLElement | null>
  // Milliseconds to wait before moving focus in, for dialogs whose first
  // field should only take focus once an entry animation settles.
  delay?: number
}

export function useModalFocus(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  { initialFocus, delay = 0 }: ModalFocusOptions = {}
) {
  // Read the latest initialFocus without re-running the open effect, which
  // would otherwise capture an element inside the dialog as the restore
  // target.
  const initialRef = useRef(initialFocus)
  initialRef.current = initialFocus

  // Capture the opener while rendering the open state, before the dialog
  // mounts: a child with autoFocus takes focus during the commit, ahead of
  // any effect, and would otherwise be mistaken for the opener.
  const openerRef = useRef<HTMLElement | null>(null)
  const trackedOpen = useRef(false)
  if (open !== trackedOpen.current) {
    trackedOpen.current = open
    if (open && typeof document !== 'undefined') {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
  }

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const opener = openerRef.current

    function moveIn() {
      const root = ref.current
      if (!root || root.contains(document.activeElement)) return
      const target = initialRef.current?.current ?? focusableIn(root)[0] ?? root
      target.focus({ preventScroll: true })
    }
    const timer = delay > 0 ? window.setTimeout(moveIn, delay) : 0
    const frame = delay > 0 ? 0 : window.requestAnimationFrame(moveIn)

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || e.defaultPrevented) return
      const root = ref.current
      if (!root) return
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
      // A second modal stacked on top (a confirm sheet) owns Tab while open.
      const owner = active?.closest('[aria-modal="true"]')
      if (owner && owner !== root) return
      const items = focusableIn(root)
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (!active || !root.contains(active)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      if (timer) window.clearTimeout(timer)
      if (frame) window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      if (!opener || !opener.isConnected || opener === document.body) return
      // Return focus only while it is still in the closing dialog or was
      // dropped to the body; never pull it away from something the person
      // moved to on their own.
      const active = document.activeElement
      if (!active || active === document.body || ref.current?.contains(active)) {
        opener.focus({ preventScroll: true })
      }
    }
  }, [open, delay, ref])
}
