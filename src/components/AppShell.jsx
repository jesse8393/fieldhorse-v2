import { Suspense, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Toaster as SonnerToaster } from 'sonner'
import AppHeader from './AppHeader.jsx'
import BottomNav from './BottomNav.jsx'
import CommandPalette from './CommandPalette.jsx'
import Toaster from './Toaster.jsx'

// Route-loading skeleton — matches Onyx bg so split-chunk fetches don't
// flash a white screen. AppHeader + BottomNav stay mounted around it.
//
// Audit found Client detail + Notes feeling broken because the chunk
// load + initial data fetch combined for ~2-3 s of mostly-empty
// screen. The fallback now renders a mini skeleton header + 3 row
// placeholders so the user sees structure instead of a spinner that
// reads as "broken".
function RouteFallback() {
  return (
    <div style={{ padding: '20px 20px 80px' }}>
      <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ width: 100, height: 11, borderRadius: 4, background: 'rgba(255,255,255,0.06)' }} />
        <span style={{ width: '60%', maxWidth: 280, height: 28, borderRadius: 6, background: 'rgba(255,255,255,0.07)', marginBottom: 6 }} />
        <span style={{ width: '100%', height: 64, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--rule)', opacity: 0.55 }} />
        <span style={{ width: '100%', height: 64, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--rule)', opacity: 0.4 }} />
        <span style={{ width: '100%', height: 64, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--rule)', opacity: 0.28 }} />
      </div>
      <span aria-label="Loading" style={{ position: 'absolute', clip: 'rect(0 0 0 0)' }} />
    </div>
  )
}

export default function AppShell() {
  const location = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [location.pathname])

  return (
    <div className="fh-app" style={{ position: 'relative' }}>
      {/* Skip-to-content link — only visible when keyboard-focused.
          Bumps a11y so keyboard users don't have to tab through every
          header + nav control to reach the screen body. */}
      <a href="#fh-main" className="fh-skip-link">Skip to content</a>
      {/* Removed for v3:
          - <Aurora />          three large gold radial blobs (atmosphere)
          - <GridPattern />     drifting 40px white grid (the "grid texture")
          - <div .fh-page-corners> four gold corner brackets — the
            bottom-left bracket was reading as a stray gold "+" once
            legacy gold tokens were aliased to the v3 (brighter) gold.
          v3 page atmosphere is provided by .v3-screen background only. */}

      {/* TEMP build marker — proves the browser is loading the latest
          source. Remove once the freshness check is done. */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: 'calc(env(safe-area-inset-top, 0px) + 6px)',
          right: 6,
          zIndex: 100000,
          padding: '4px 8px',
          borderRadius: 6,
          background: 'rgba(229, 193, 88, 0.92)',
          color: '#0B0B0D',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.04em',
          lineHeight: 1.2,
          boxShadow: '0 2px 6px rgba(0, 0, 0, 0.45)',
          pointerEvents: 'none',
          userSelect: 'none'
        }}
      >
        QA CURRENT
      </div>

      <AppHeader />

      <AnimatePresence mode="wait">
        <motion.main
          id="fh-main"
          key={location.pathname}
          className="fh-app__main"
          style={{ position: 'relative', zIndex: 1 }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </motion.main>
      </AnimatePresence>

      <BottomNav />
      <CommandPalette />

      {/* Existing custom toaster stays — Sonner runs alongside it */}
      <Toaster />
      <SonnerToaster
        position="top-center"
        theme="dark"
        richColors
        expand
        visibleToasts={3}
        mobileOffset={{ top: 'calc(env(safe-area-inset-top, 0px) + 16px)', left: '16px', right: '16px' }}
        toastOptions={{
          style: {
            width: '100%',
            maxWidth: 'calc(100vw - 32px)',
            background: 'rgba(20, 20, 20, 0.95)',
            color: 'var(--ink-strong)',
            border: '1px solid rgba(201, 150, 58, 0.35)',
            fontFamily: 'var(--font-body)',
            backdropFilter: 'blur(30px)'
          }
        }}
      />
    </div>
  )
}
