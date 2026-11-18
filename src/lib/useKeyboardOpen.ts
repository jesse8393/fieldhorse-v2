import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'

// True while an on screen keyboard covers part of the page: a text
// field has focus and the visual viewport has shrunk well below the
// layout viewport. The dock hides then (spec 8.1), so it never rides up
// on top of the keyboard on iOS.

export const KEYBOARD_MIN_PX = 120

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

/**
 * How far up from the bottom of the page's window the keyboard reaches
 * while it is open, in px, and 0 while it is closed. iOS and Android keep
 * the layout viewport the size it was and shrink only the visual one, so a
 * bar fixed or stuck to the bottom adds this to sit above the keyboard,
 * where the dock's height would leave it underneath. It follows the
 * visible part as the browser scrolls it to the field.
 */
export function useKeyboardInset() {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const check = () => {
      const open = window.innerHeight - vv.height > KEYBOARD_MIN_PX && isTextEntry(document.activeElement)
      setInset(open ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0)
    }
    vv.addEventListener('resize', check)
    vv.addEventListener('scroll', check)
    window.addEventListener('focusin', check)
    window.addEventListener('focusout', check)
    return () => {
      vv.removeEventListener('resize', check)
      vv.removeEventListener('scroll', check)
      window.removeEventListener('focusin', check)
      window.removeEventListener('focusout', check)
    }
  }, [])
  return inset
}

const NOT_ONE_LINE = ['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']

/**
 * Enter, or the keyboard's Go key, pressed in a one line field that no
 * form or control has handled already: the moment a screen with a Save
 * button saves, as a form would, so there is no need to close the
 * keyboard first.
 */
export function isEnterToSave(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Enter' || event.defaultPrevented || event.nativeEvent.isComposing) return false
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false
  const field = event.target
  return field instanceof HTMLInputElement && !field.form && !NOT_ONE_LINE.includes(field.type)
}
