import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'

type Theme = 'dark' | 'light'

type ThemeContextValue = {
  theme: Theme
  setTheme: (t: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const STORAGE_KEY = 'fh:theme'

// PWA status-bar / browser-chrome color per theme. Matches --v3-bg.
const THEME_COLOR: Record<Theme, string> = {
  dark: '#0B0907',
  light: '#F8F5EE'
}

function initial(): Theme {
  if (typeof window === 'undefined') return 'dark'
  // Safari Private Mode on older iOS throws SecurityError on localStorage.
  // Default to dark on any failure.
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch { /* noop */ }
  return 'dark' // Fieldhorse ships dark-first
}

// Daylight is a field feature. The desktop build screens (fh-build) are
// still dark-by-literal, so ≥900px viewports pin to dark regardless of
// the stored preference until desktop parity lands. The preference is
// stored either way, so a phone picks it up immediately.
function useIsDesktopViewport() {
  const [is, setIs] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(min-width: 900px)').matches
      : false
  )
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(min-width: 900px)')
    const update = () => setIs(mql.matches)
    if (mql.addEventListener) mql.addEventListener('change', update)
    else if (mql.addListener) mql.addListener(update)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', update)
      else if (mql.removeListener) mql.removeListener(update)
    }
  }, [])
  return is
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initial)
  const isDesktop = useIsDesktopViewport()
  const effective: Theme = isDesktop ? 'dark' : theme

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', effective)
    // Keep the PWA status bar / browser chrome in step with the canvas.
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', THEME_COLOR[effective])
    try { localStorage.setItem(STORAGE_KEY, theme) } catch { /* private mode */ }
  }, [effective, theme])

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
