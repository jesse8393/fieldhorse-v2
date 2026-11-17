import { describe, expect, it } from 'vitest'
import { desktopShortcut, isMacLike, isTypingTarget } from './shortcutKeys.ts'

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0'

describe('isMacLike', () => {
  it('is true for a Mac and false elsewhere or when unknown', () => {
    expect(isMacLike({ userAgent: MAC })).toBe(true)
    expect(isMacLike({ userAgent: LINUX })).toBe(false)
    expect(isMacLike({ userAgent: WINDOWS })).toBe(false)
    expect(isMacLike()).toBe(false)
  })
})

describe('desktopShortcut', () => {
  it('prints Cmd J on a Mac and Ctrl J everywhere else, with a spoken form and the aria combo', () => {
    expect(desktopShortcut('J', { userAgent: MAC })).toEqual({ keys: '⌘J', spoken: 'Command J', combo: 'Meta+J' })
    expect(desktopShortcut('J', { userAgent: LINUX })).toEqual({ keys: 'Ctrl J', spoken: 'Control J', combo: 'Control+J' })
    expect(desktopShortcut('J', { userAgent: WINDOWS })).toEqual({ keys: 'Ctrl J', spoken: 'Control J', combo: 'Control+J' })
    expect(desktopShortcut('J')).toEqual({ keys: 'Ctrl J', spoken: 'Control J', combo: 'Control+J' })
  })

  it('upper cases the letter and serves the Search shortcut the same way', () => {
    expect(desktopShortcut('k', { userAgent: MAC })).toEqual({ keys: '⌘K', spoken: 'Command K', combo: 'Meta+K' })
    expect(desktopShortcut('k', { userAgent: LINUX }).keys).toBe('Ctrl K')
  })

  it('never prints a dash', () => {
    for (const ua of [MAC, LINUX]) {
      const s = desktopShortcut('J', { userAgent: ua })
      expect(`${s.keys} ${s.spoken}`).not.toMatch(/[-–—]/)
    }
  })
})

// D09: an app shortcut pressed while the person types in a field belongs to
// the field, so Control J or N never takes them off a half typed form.
describe('isTypingTarget', () => {
  const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra }) as unknown as EventTarget

  it('is true in a text input, a textarea, a select and editable text', () => {
    expect(isTypingTarget(el('INPUT', { type: 'text' }))).toBe(true)
    expect(isTypingTarget(el('INPUT', { type: 'search' }))).toBe(true)
    expect(isTypingTarget(el('INPUT', { type: 'email' }))).toBe(true)
    expect(isTypingTarget(el('INPUT', { type: 'date' }))).toBe(true)
    expect(isTypingTarget(el('INPUT', { type: '' }))).toBe(true)
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true)
    expect(isTypingTarget(el('SELECT'))).toBe(true)
    expect(isTypingTarget(el('DIV', { isContentEditable: true }))).toBe(true)
  })

  it('is false on buttons, links, check boxes and the page itself', () => {
    expect(isTypingTarget(el('BUTTON'))).toBe(false)
    expect(isTypingTarget(el('A'))).toBe(false)
    expect(isTypingTarget(el('INPUT', { type: 'checkbox' }))).toBe(false)
    expect(isTypingTarget(el('INPUT', { type: 'radio' }))).toBe(false)
    expect(isTypingTarget(el('INPUT', { type: 'submit' }))).toBe(false)
    expect(isTypingTarget(el('BODY', { isContentEditable: false }))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget({} as EventTarget)).toBe(false)
  })
})
