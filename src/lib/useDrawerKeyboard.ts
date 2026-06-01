// src/lib/useDrawerKeyboard.ts
//
// Shared iOS keyboard handler for Vaul drawer-based sheets.
//
// Strategy: use 100dvh (dynamic viewport height) which iOS Safari
// auto-shrinks when the soft keyboard opens. The drawer's maxHeight
// then naturally fits above the keyboard without any JS measurement
// of visualViewport. Eliminates the previous bug where in-app
// browsers (Safari View Controller, Chrome iOS) reported viewport
// values that double-subtracted the keyboard, leaving the drawer
// stuck at a tiny height with one input visible and big empty
// voids below.
//
// The hook still:
//   - exposes formRef so callers can attach to their scrollable form
//   - exposes drawerStyle + formStyle helpers for consistent layout
//   - keeps a manual focus-scroll-into-view, but uses block:'center'
//     and only fires when the focused field is actually outside the
//     form's visible window (no more "pin focused field to top
//     edge" behavior)

import { useEffect, useRef, type CSSProperties } from 'react'

export function useDrawerKeyboard(open: boolean) {
  const formRef = useRef<HTMLFormElement | null>(null)

  // Focus-scroll inside the form. Only nudges the focused input into
  // view when it's actually outside the visible scrolling box. Uses
  // block:'center' so the field lands with breathing room, not
  // pinned to one edge.
  useEffect(() => {
    if (!open) return
    const form = formRef.current
    if (!form) return
    function onFocusIn(e: FocusEvent) {
      const t = e.target as HTMLElement | null
      if (!t || !t.matches?.('input, textarea, select')) return
      const inputType = (t.getAttribute?.('type') || '').toLowerCase()
      if (['checkbox', 'radio', 'button', 'submit'].includes(inputType)) return
      setTimeout(() => {
        try {
          const formEl = form
          if (!formEl) return
          const fRect = formEl.getBoundingClientRect()
          const tRect = t.getBoundingClientRect()
          const pad = 24
          const above = tRect.top < fRect.top + pad
          const below = tRect.bottom > fRect.bottom - pad
          if (above || below) {
            t.scrollIntoView({ block: 'center', behavior: 'smooth' })
          }
        } catch {}
      }, 320)
    }
    form.addEventListener('focusin', onFocusIn)
    return () => form.removeEventListener('focusin', onFocusIn)
  }, [open])

  const drawerStyle: CSSProperties = {
    maxWidth: '100%',
    overflowX: 'hidden',
    // 100dvh auto-shrinks when the iOS soft keyboard opens, so the
    // drawer fits above the keyboard without manual JS measurement.
    // The fallback 100vh kicks in on browsers that don't support
    // dvh (very old iOS); they get a slightly taller drawer but no
    // broken layout.
    maxHeight: 'calc(100dvh - env(safe-area-inset-top) - 24px)',
    display: 'flex',
    flexDirection: 'column'
  }

  function formStyle(extra: CSSProperties = {}): CSSProperties {
    return {
      paddingTop: 6,
      paddingLeft: 20,
      paddingRight: 20,
      paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      boxSizing: 'border-box',
      maxWidth: '100%',
      minWidth: 0,
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      overscrollBehavior: 'contain',
      flex: 1,
      minHeight: 0,
      ...extra
    }
  }

  // kbd is kept in the return tuple for API compatibility with any
  // callers that read it; always 0 now since dvh handles the lift.
  return { kbd: 0, formRef, drawerStyle, formStyle }
}
