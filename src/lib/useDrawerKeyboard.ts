// src/lib/useDrawerKeyboard.ts
//
// Layout helper for Vaul drawer-based sheets.
//
// Vaul's <Drawer.Root repositionInputs={true}> (the default) already
// handles iOS soft-keyboard repositioning under the hood: it tracks
// window.visualViewport, computes the keyboard height, and writes
// drawerRef.style.height + drawerRef.style.bottom directly to lift
// the drawer above the keyboard. We previously tried to do the same
// thing here via React's style prop, which silently overwrote Vaul's
// direct DOM writes on every re-render — the two handlers fought,
// the drawer ended up tiny with one input visible and a big dead
// zone below.
//
// Now the hook stays out of the keyboard's way and only provides:
//   - formRef: attach to the scrollable form so we can wire scroll
//     padding for focused inputs.
//   - drawerStyle: only the IMMUTABLE bits (maxWidth, overflow,
//     flex column for header + form layout). No height or bottom
//     overrides — Vaul owns those.
//   - formStyle: overflow + scroll-padding-bottom so when the
//     keyboard appears, scrollIntoView lands focused inputs in the
//     non-occluded area.

import { useEffect, useRef, type CSSProperties } from 'react'

export function useDrawerKeyboard(open: boolean) {
  const formRef = useRef<HTMLFormElement | null>(null)

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
    // Force the drawer to fill the available height. Using min-height
    // (not just maxHeight) so even a short form gets a tall sheet —
    // looks like a real sheet, not a squished strip at the bottom.
    // Vaul writes inline style.height during keyboard repositioning;
    // min/maxHeight don't conflict with that.
    minHeight: 'calc(100dvh - env(safe-area-inset-top) - 96px)',
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
      scrollPaddingBottom: '40vh',
      flex: 1,
      minHeight: 0,
      ...extra
    }
  }

  return { kbd: 0, formRef, drawerStyle, formStyle }
}
