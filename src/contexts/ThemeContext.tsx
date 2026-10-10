import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import {
  dayWindows,
  readCachedLocation,
  readMode,
  resolveTheme,
  THEME_COLOR,
  writeMode,
  writeSunCache,
  type ResolvedTheme,
  type ThemeMode
} from '../lib/themeMode.ts'
import { isValidLocation } from '../lib/sunTimes.ts'

// Day, Night and Auto (spec section 10). Auto follows sunrise and sunset
// at the company's location (profiles.location_lat and location_lon,
// passed in through ThemeLocationSync), or 7 am to 7 pm without one.
//
// The pre paint script in index.html applies the same rule before React
// renders, from the windows this provider caches in fh:sun, so the first
// frame and the status bar already match.

type Theme = ResolvedTheme

type ThemeContextValue = {
  /** The theme on screen right now: 'light' (Day) or 'dark' (Night). */
  theme: Theme
  /** What the person picked: auto, day or night. */
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  /** Pins Day ('light') or Night ('dark'). Kept for older callers. */
  setTheme: (t: Theme) => void
  /** Pins the opposite of what is on screen. Kept for older callers. */
  toggleTheme: () => void
  /** The company location Auto follows. */
  setLocation: (lat: number | null | undefined, lon: number | null | undefined) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

type Location = { lat: number; lon: number } | null

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readMode)
  const [location, setLocationState] = useState<Location>(readCachedLocation)
  // Bumped when Auto reaches a sunrise or sunset, or the app comes back
  // to the foreground, so the theme is worked out again.
  const [tick, setTick] = useState(0)

  const { theme, nextChange, windows } = useMemo(() => {
    const now = new Date()
    const windows = dayWindows(now, location?.lat, location?.lon)
    return { ...resolveTheme(mode, now.getTime(), windows), windows }
    // tick is a dependency on purpose: it stands in for the clock.
  }, [mode, location, tick])

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', THEME_COLOR[theme])
  }, [theme])

  useEffect(() => {
    writeSunCache(windows, location?.lat, location?.lon)
  }, [windows, location])

  // Wake up at the next sunrise or sunset, and re-check whenever the app
  // returns to the foreground (timers do not run while a phone sleeps).
  useEffect(() => {
    if (nextChange == null) return
    const delay = Math.max(1000, Math.min(nextChange - Date.now() + 1000, 6 * 60 * 60 * 1000))
    const id = window.setTimeout(() => setTick((n) => n + 1), delay)
    return () => window.clearTimeout(id)
  }, [nextChange])

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') setTick((n) => n + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const setMode = useCallback((next: ThemeMode) => {
    writeMode(next)
    setModeState(next)
  }, [])

  const setTheme = useCallback((t: Theme) => setMode(t === 'light' ? 'day' : 'night'), [setMode])

  const toggleTheme = useCallback(() => setMode(theme === 'light' ? 'night' : 'day'), [setMode, theme])

  const setLocation = useCallback((lat: number | null | undefined, lon: number | null | undefined) => {
    setLocationState((current) => {
      if (!isValidLocation(lat, lon)) return current
      if (current && current.lat === lat && current.lon === lon) return current
      return { lat: lat as number, lon: lon as number }
    })
  }, [])

  const value = useMemo(
    () => ({ theme, mode, setMode, setTheme, toggleTheme, setLocation }),
    [theme, mode, setMode, setTheme, toggleTheme, setLocation]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
