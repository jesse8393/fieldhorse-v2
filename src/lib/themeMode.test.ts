import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { dayWindows, resolveTheme, isThemeMode, THEME_COLOR, type DayWindow, type ThemeMode } from './themeMode.ts'

const NASHVILLE = { lat: 36.1627, lon: -86.7816 }

describe('resolveTheme', () => {
  const windows: DayWindow[] = [[1000, 2000], [5000, 6000]]

  it('keeps Day and Night fixed', () => {
    expect(resolveTheme('day', 4000, windows)).toEqual({ theme: 'light', nextChange: null })
    expect(resolveTheme('night', 1500, windows)).toEqual({ theme: 'dark', nextChange: null })
  })

  it('follows the windows in Auto and says when it next changes', () => {
    expect(resolveTheme('auto', 500, windows)).toEqual({ theme: 'dark', nextChange: 1000 })
    expect(resolveTheme('auto', 1000, windows)).toEqual({ theme: 'light', nextChange: 2000 })
    expect(resolveTheme('auto', 2000, windows)).toEqual({ theme: 'dark', nextChange: 5000 })
    expect(resolveTheme('auto', 7000, windows)).toEqual({ theme: 'dark', nextChange: null })
  })

  it('skips empty windows from the polar night', () => {
    expect(resolveTheme('auto', 500, [[800, 800], [3000, 4000]])).toEqual({ theme: 'dark', nextChange: 3000 })
  })
})

describe('dayWindows', () => {
  it('uses the sun when there is a location', () => {
    const now = new Date(2026, 9, 10, 12, 0)
    const windows = dayWindows(now, NASHVILLE.lat, NASHVILLE.lon)
    expect(windows).toHaveLength(8)
    // Today is the second window (yesterday comes first).
    const [rise, set] = windows[1]
    expect(Math.abs(rise - Date.parse('2026-10-10T11:49Z'))).toBeLessThan(3 * 60_000)
    expect(Math.abs(set - Date.parse('2026-10-10T23:17Z'))).toBeLessThan(3 * 60_000)
  })

  it('falls back to 7 am and 7 pm without one', () => {
    const now = new Date(2026, 9, 10, 12, 0)
    const [rise, set] = dayWindows(now, null, null)[1]
    expect(new Date(rise).getHours()).toBe(7)
    expect(new Date(set).getHours()).toBe(19)
    expect(new Date(rise).getDate()).toBe(10)
  })

  it('makes Auto dark after sunset and light by day', () => {
    const noon = new Date(2026, 9, 10, 12, 0)
    const windows = dayWindows(noon, NASHVILLE.lat, NASHVILLE.lon)
    expect(resolveTheme('auto', windows[1][0] + 60_000, windows).theme).toBe('light')
    expect(resolveTheme('auto', windows[1][1] + 60_000, windows).theme).toBe('dark')
  })
})

describe('isThemeMode', () => {
  it('accepts only the three modes', () => {
    for (const mode of ['auto', 'day', 'night']) expect(isThemeMode(mode)).toBe(true)
    for (const value of ['light', 'dark', '', null, undefined]) expect(isThemeMode(value)).toBe(false)
  })
})

// The pre paint script in index.html must reach the same answer as
// resolveTheme, or the theme flips on the first React render.
describe('index.html pre paint script', () => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''

  function runScript(mode: ThemeMode | null, sun: string | null, now: number, hour: number) {
    const store: Record<string, string> = {}
    if (mode) store['fh:theme-mode'] = mode
    if (sun !== null) store['fh:sun'] = sun
    const attrs: Record<string, string> = {}
    const meta: Record<string, string> = {}
    class FakeDate {
      static now() { return now }
      getHours() { return hour }
    }
    runInNewContext(script, {
      localStorage: { getItem: (k: string) => (k in store ? store[k] : null) },
      document: {
        documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v } },
        querySelector: () => ({ setAttribute: (k: string, v: string) => { meta[k] = v } })
      },
      Date: FakeDate,
      JSON
    })
    return { theme: attrs['data-theme'], color: meta.content }
  }

  it('exists', () => {
    expect(script).toContain('fh:theme-mode')
  })

  it('agrees with resolveTheme across a cached week', () => {
    const noon = new Date(2026, 9, 10, 12, 0)
    const windows = dayWindows(noon, NASHVILLE.lat, NASHVILLE.lon)
    const sun = JSON.stringify({ days: windows, lat: NASHVILLE.lat, lon: NASHVILLE.lon })
    const first = windows[0][0]
    const last = windows[windows.length - 1][1]
    for (let t = first; t < last; t += 37 * 60_000) {
      for (const mode of ['auto', 'day', 'night'] as ThemeMode[]) {
        const expected = resolveTheme(mode, t, windows).theme
        const got = runScript(mode, sun, t, 12)
        expect(got.theme, `${mode} at ${new Date(t).toISOString()}`).toBe(expected)
        expect(got.color).toBe(THEME_COLOR[expected])
      }
    }
  })

  it('treats a missing mode as Auto and uses 7 am to 7 pm without a cache', () => {
    expect(runScript(null, null, Date.now(), 6).theme).toBe('dark')
    expect(runScript(null, null, Date.now(), 7).theme).toBe('light')
    expect(runScript(null, null, Date.now(), 18).theme).toBe('light')
    expect(runScript(null, null, Date.now(), 19).theme).toBe('dark')
  })

  it('survives a corrupt cache', () => {
    expect(runScript('auto', '{not json', Date.now(), 12).theme).toBe('light')
  })
})
