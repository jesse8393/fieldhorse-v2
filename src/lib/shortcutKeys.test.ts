import { describe, expect, it } from 'vitest'
import { desktopShortcut, isMacLike } from './shortcutKeys.ts'

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
