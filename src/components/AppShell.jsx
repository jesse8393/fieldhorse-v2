import { Suspense, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Toaster as SonnerToaster } from 'sonner'
import AppHeader from './AppHeader.jsx'
import BottomNav from './BottomNav.jsx'
import CommandPalette from './CommandPalette.jsx'
import Toaster from './Toaster.jsx'
import Aurora from './fx/Aurora.jsx'
import GridPattern from './fx/GridPattern.jsx'

// Route-loading skeleton — matches Onyx bg so split-chunk fetches don't
// flash a white screen. AppHeader + BottomNav stay mounted around it.
function RouteFallback() {
  return (
    <div style={{ minHeight: '40dvh', display: 'grid', placeItems: 'center', padding: 40 }}>
      <span
        aria-label="Loading"
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          border: '2px solid rgba(201,150,58,0.18)',
          borderTopColor: 'var(--field-gold-bright)',
          animation: 'fh-spin 700ms linear infinite'
        }}
      />
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
      <Aurora />
      <GridPattern />

      <div className="fh-page-corners" aria-hidden="true">
        <span className="fh-corner fh-corner--tl" />
        <span className="fh-corner fh-corner--tr" />
        <span className="fh-corner fh-corner--bl" />
        <span className="fh-corner fh-corner--br" />
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
