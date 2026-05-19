// src/lib/useDrawerKeyboard.js
//
// Shared iOS keyboard handler for Vaul drawer-based sheets. Solves
// two real bugs we kept hitting:
//
//   1) Lifting the drawer with transform: translate3d(0, -kbd, 0)
//      worked when kbd was small, but on phones with a tall keyboard
//      it pushed the drawer header up INTO the iOS status bar /
//      Dynamic Island. "Add a client." rendered on top of the time.
//
//   2) Inputs below the visible portion of the drawer stayed buried
//      because iOS Safari does not auto-scroll-into-view inside a
//      position:fixed overflow container — the user had to manually
//      scroll the form or dismiss the keyboard to see what they
//      were typing.
//
// The hook returns:
//   - kbd: current keyboard height in px (0 when no keyboard).
//   - formRef: attach to the scrollable form element.
//   - drawerStyle: spread onto <DrawerContent>. Caps maxHeight to
//     safe-area-aware viewport so the drawer never extends past the
//     status bar.
//   - formStyle(extra): spread onto the form. Pads the bottom by the
//     keyboard height so the focused input has room to scroll above
//     the keyboard. Pass any additional inline style to merge.
//
// Focus-scroll is wired automatically: on every focusin inside the
// form, we scroll the focused field into view after a 280ms delay
// (enough for the iOS keyboard slide + visualViewport resize to
// settle).

import { useEffect, useRef, useState } from 'react'

export function useDrawerKeyboard(open) {
  const [kbd, setKbd] = useState(0)
  const formRef = useRef(null)

  // Track keyboard height via visualViewport. Floor at 40px so iOS
  // soft-button bars (notched phones) don't trip the offset.
  useEffect(() => {
    if (!open) return
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    function update() {
      const next = Math.max(0, window.innerHeight - vv.height - (vv.offsetTop || 0))
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

  // Focus-scroll inside the form.
  useEffect(() => {
    if (!open) return
    const form = formRef.current
    if (!form) return
    function onFocusIn(e) {
      const t = e.target
      if (!t || !t.matches?.('input, textarea, select')) return
      const inputType = (t.getAttribute?.('type') || '').toLowerCase()
      if (['checkbox', 'radio', 'button', 'submit'].includes(inputType)) return
      setTimeout(() => {
        try { t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) } catch {}
      }, 280)
    }
    form.addEventListener('focusin', onFocusIn)
    return () => form.removeEventListener('focusin', onFocusIn)
  }, [open])

  const drawerStyle = {
    maxWidth: '100%',
    overflowX: 'hidden',
    // Cap height so the drawer always fits between the iOS status
    // bar / Dynamic Island and whatever the keyboard is covering.
    // The previous version only subtracted safe-area, so when the
    // keyboard rose the drawer extended *behind* it and the focused
    // field disappeared.
    maxHeight: `calc(100vh - ${kbd}px - env(safe-area-inset-top) - 24px)`,
    // Anchor above the keyboard. Vaul's default position is
    // bottom:0; pinning bottom:kbd lifts the entire drawer up by
    // the keyboard height so the form never overlaps it. Doing
    // it via 'bottom' (not transform) keeps Vaul's slide-in/out
    // animation intact.
    bottom: kbd > 0 ? `${kbd}px` : undefined,
    transition: 'bottom 220ms cubic-bezier(0.16, 1, 0.3, 1), max-height 220ms cubic-bezier(0.16, 1, 0.3, 1)',
    display: 'flex',
    flexDirection: 'column'
  }

  function formStyle(extra = {}) {
    return {
      paddingTop: 6,
      paddingLeft: 20,
      paddingRight: 20,
      // No keyboard padding here anymore — the drawer itself moves
      // above the keyboard via the bottom:kbd offset above, so the
      // form just needs its normal bottom safe-area inset.
      paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      boxSizing: 'border-box',
      maxWidth: '100%',
      minWidth: 0,
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      flex: 1,
      minHeight: 0,
      ...extra
    }
  }

  return { kbd, formRef, drawerStyle, formStyle }
}
