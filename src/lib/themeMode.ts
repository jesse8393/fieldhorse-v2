// Theme modes for the redesign (spec section 10): Auto follows the sun
// at the company's location, Day and Night stay put.
//
// The pre paint script in index.html repeats resolveTheme's Auto rule
// against the cached windows, so the first frame is already right.
// themeMode.test.ts runs that script and checks the two agree; keep
// them in step (and update the script's CSP hash in netlify.toml).

import { sunWindow, isValidLocation } from './sunTimes.ts'

export type ThemeMode = 'auto' | 'day' | 'night'
export type ResolvedTheme = 'light' | 'dark'
/** A daylight span, [sunrise, sunset) in epoch ms. Empty when start equals end. */
export type DayWindow = [number, number]

export const MODE_KEY = 'fh:theme-mode'
export const SUN_KEY = 'fh:sun'
export const THEME_MODES: ThemeMode[] = ['auto', 'day', 'night']

/** Browser chrome and status bar color for each theme: plaster and night plaster. */
export const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#EDE8DF',
  dark: '#171611'
}

// Without a location, Auto treats 7 am to 7 pm as day.
const FALLBACK_SUNRISE_HOUR = 7
const FALLBACK_SUNSET_HOUR = 19
// How many days of windows to compute and cache, starting yesterday, so
// a phone that has not opened the app for a few days still paints the
// right theme first.
const CACHED_DAYS = 8

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'auto' || value === 'day' || value === 'night'
}

function localDayStart(base: Date, offsetDays: number) {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetDays)
}

/**
 * Daylight windows for yesterday through the next week, in the device's
 * calendar. With a location they come from the sun; without one they
 * are 7 am to 7 pm.
 */
export function dayWindows(now: Date, lat?: number | null, lon?: number | null): DayWindow[] {
  const located = isValidLocation(lat, lon)
  const windows: DayWindow[] = []
  for (let i = -1; i < CACHED_DAYS - 1; i++) {
    const start = localDayStart(now, i)
    if (!located) {
      const rise = new Date(start); rise.setHours(FALLBACK_SUNRISE_HOUR)
      const set = new Date(start); set.setHours(FALLBACK_SUNSET_HOUR)
      windows.push([rise.getTime(), set.getTime()])
      continue
    }
    const w = sunWindow(start.getFullYear(), start.getMonth() + 1, start.getDate(), lat as number, lon as number)
    if (w.kind === 'normal') windows.push([w.sunrise, w.sunset])
    else if (w.kind === 'polar-day') windows.push([start.getTime(), localDayStart(now, i + 1).getTime()])
    else windows.push([start.getTime(), start.getTime()])
  }
  return windows
}

/**
 * The theme for a mode at a moment, and when it next changes (null when
 * it never does on its own). Auto is light inside a daylight window and
 * dark outside every window.
 */
export function resolveTheme(mode: ThemeMode, now: number, windows: DayWindow[]): { theme: ResolvedTheme; nextChange: number | null } {
  if (mode === 'day') return { theme: 'light', nextChange: null }
  if (mode === 'night') return { theme: 'dark', nextChange: null }
  for (const [rise, set] of windows) {
    if (now >= rise && now < set) return { theme: 'light', nextChange: set }
  }
  const nextRise = windows.map(([rise, set]) => (rise < set ? rise : Infinity)).filter((t) => t > now).sort((a, b) => a - b)[0]
  return { theme: 'dark', nextChange: Number.isFinite(nextRise) ? nextRise : null }
}

type SunCache = { days: DayWindow[]; lat?: number; lon?: number }

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readMode(): ThemeMode {
  try {
    const value = storage()?.getItem(MODE_KEY)
    return isThemeMode(value) ? value : 'auto'
  } catch {
    return 'auto'
  }
}

export function writeMode(mode: ThemeMode) {
  try { storage()?.setItem(MODE_KEY, mode) } catch { /* private mode */ }
}

/** The last location Auto used, so a cold start uses it before the profile loads. */
export function readCachedLocation(): { lat: number; lon: number } | null {
  try {
    const raw = storage()?.getItem(SUN_KEY)
    if (!raw) return null
    const cache = JSON.parse(raw) as SunCache
    return isValidLocation(cache.lat, cache.lon) ? { lat: cache.lat as number, lon: cache.lon as number } : null
  } catch {
    return null
  }
}

export function writeSunCache(days: DayWindow[], lat?: number | null, lon?: number | null) {
  const cache: SunCache = { days }
  if (isValidLocation(lat, lon)) { cache.lat = lat as number; cache.lon = lon as number }
  try { storage()?.setItem(SUN_KEY, JSON.stringify(cache)) } catch { /* private mode */ }
}
