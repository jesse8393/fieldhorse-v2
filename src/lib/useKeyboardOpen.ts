import { useEffect, useState } from 'react'

// True while an on screen keyboard covers part of the page: a text
// field has focus and the visual viewport has shrunk well below the
// layout viewport. The dock hides then (spec 8.1), so it never rides up
// on top of the keyboard on iOS.

const KEYBOARD_MIN_PX = 120

function isTextEntry(el: Element | null) {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(el.type)
  }
  return (el as HTMLElement).isContentEditable === true
}

export function useKeyboardOpen() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const check = () => {
      const covered = window.innerHeight - vv.height > KEYBOARD_MIN_PX
      setOpen(covered && isTextEntry(document.activeElement))
    }
    vv.addEventListener('resize', check)
    window.addEventListener('focusin', check)
    window.addEventListener('focusout', check)
    return () => {
      vv.removeEventListener('resize', check)
      window.removeEventListener('focusin', check)
      window.removeEventListener('focusout', check)
    }
  }, [])
  return open
}
