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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initial)
  // The ≥900px dark pin is gone: the desktop build screens (fh-build)
  // were re-tokenized in the desktop-parity sweep, so daylight now
  // applies on every viewport.

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    // Keep the PWA status bar / browser chrome in step with the canvas.
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', THEME_COLOR[theme])
    try { localStorage.setItem(STORAGE_KEY, theme) } catch { /* private mode */ }
  }, [theme])

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
