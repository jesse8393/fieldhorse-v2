// src/lib/useDrawerKeyboard.ts
//
// Shared iOS keyboard handler for Vaul drawer-based sheets.
//
// iOS Safari and its in-app variant (Safari View Controller, opened
// when a link click bounces into Mail/Messages/Slack preview) do NOT
// reliably shrink 100dvh when the soft keyboard opens. So we must
// measure the keyboard manually via visualViewport and lift the
// drawer up by that amount. Three layered defenses keep the drawer
// usable even when one signal fails:
//
//   1. visualViewport detection → set --kbd in px. Works in iOS
//      Safari proper.
//   2. maxHeight uses 100dvh - kbd as a belt-and-suspenders cap.
//      If dvh DOES shrink (most embedded browsers do), we don't
//      double-subtract because kbd will be 0.
//   3. scroll-padding-bottom on the form equals the kbd offset so
//      scrollIntoView treats the bottom-kbd zone as occluded and
//      lands the focused input ABOVE the keyboard, not behind it.

import { useEffect, useRef, useState, type CSSProperties } from 'react'

export function useDrawerKeyboard(open: boolean) {
  const [kbd, setKbd] = useState(0)
  const formRef = useRef<HTMLFormElement | null>(null)

  useEffect(() => {
    if (!open) return
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    function update() {
      const next = Math.max(0, window.innerHeight - vv!.height - (vv!.offsetTop || 0))
      setKbd(next > 40 ? next : 0)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      setKbd(0)
    }
  }, [open])

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
    maxHeight: `calc(100dvh - ${kbd}px - env(safe-area-inset-top) - 24px)`,
    bottom: kbd > 0 ? `${kbd}px` : undefined,
    transition: 'bottom 220ms cubic-bezier(0.16, 1, 0.3, 1), max-height 220ms cubic-bezier(0.16, 1, 0.3, 1)',
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
      // Treat the bottom-kbd strip as occluded so scrollIntoView lands
      // the focused input above the keyboard even when the drawer
      // itself didn't lift (visualViewport silent in in-app browsers).
      scrollPaddingBottom: kbd > 0 ? `${kbd + 40}px` : '40vh',
      flex: 1,
      minHeight: 0,
      ...extra
    }
  }

  return { kbd, formRef, drawerStyle, formStyle }
}
