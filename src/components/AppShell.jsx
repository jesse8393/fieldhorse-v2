import { Suspense, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Toaster as SonnerToaster } from 'sonner'
import AppHeader from './AppHeader.jsx'
import BottomNav from './BottomNav.jsx'
import DesktopSidebar from './DesktopSidebar.jsx'
import CommandPalette from './CommandPalette.jsx'
import Toaster from './Toaster.jsx'
import RouteErrorBoundary from './RouteErrorBoundary.jsx'

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

/**
 * Route → layout mode resolver. V3-SYSTEM-1A2 / Phase 1 desktop shell.
 *
 * Three modes are defined in global.css and applied via the
 * .fh-app--layout-{mode} class on the shell root. Both the content
 * column cap and the bottom-nav cap key off this single class so the
 * dock and the page always agree.
 *
 *   'mobile-frame'  centered ~440px premium mobile frame
 *   'prose'         centered 640px prose width (read-heavy detail screens)
 *   'responsive'    multi-column desktop canvas (1280px cap at >=900px,
 *                   collapses to centered 440px at 720-899px so iPad
 *                   doesn't see a stretched single column)
 *
 * Phase 1 of the Responsive Desktop Command Center promotes Home (`/`)
 * to 'responsive'. Jobs, Clients, Schedule, Job Detail follow in Phase
 * 2/3. Screens stay layout-agnostic — they don't read the mode, they
 * just render their mobile-first markup and the shell decides how much
 * canvas they get.
 */
function layoutForPath(pathname) {
  // Responsive Desktop Command Center.
  //   Phase 1: Home (`/`) — multi-column dashboard canvas.
  //   Phase 2: Jobs (`/jobs`) + Clients (`/clients`) — desktop command
  //            header + wide card grid.
  //   Phase 2.5 / 3: All remaining tool routes get the responsive
  //            workspace canvas at >=900px so they stop rendering as a
  //            440px phone column inside a giant desktop shell. Each
  //            screen author can layer dedicated desktop CSS on top of
  //            their `v3-screen` markup as time permits — until then the
  //            wider canvas + sensible gutters is the floor we ship.
  //   Phase 3 (still pending): Job Detail multi-column dashboard.
  //
  // Detail routes (`/jobs/:id`, `/clients/:id`) intentionally stay on
  // mobile-frame because their internal layouts (tab strips, full-bleed
  // photo grids) are still mobile-tuned; promoting them would stretch
  // those internals weirdly. Will be lifted once Phase 3 designs land.
  //
  // Below 900px the layout collapses to the mobile frame automatically
  // (the responsive max-width media queries only activate at >=900px),
  // so phones are unaffected by every promotion below.
  if (pathname === '/') return 'responsive'
  if (pathname === '/jobs') return 'responsive'
  if (pathname === '/clients') return 'responsive'
  if (pathname === '/schedule') return 'responsive'
  if (pathname === '/compose') return 'responsive'
  if (pathname === '/bid') return 'responsive'
  if (pathname === '/invoices') return 'responsive'
  if (pathname === '/analytics') return 'responsive'
  if (pathname === '/subs') return 'responsive'
  if (pathname === '/settings') return 'responsive'
  if (pathname === '/import') return 'responsive'
  if (pathname === '/pour-window') return 'responsive'
  if (pathname === '/notes') return 'responsive'
  // Job Detail + Client Detail still mobile-frame — their internal
  // layouts need bespoke desktop work in a follow-up phase.
  return 'mobile-frame'
}

export default function AppShell() {
  const location = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [location.pathname])

  const layoutMode = layoutForPath(location.pathname)

  return (
    <div
      className={`fh-app fh-app--layout-${layoutMode}`}
      data-layout={layoutMode}
      style={{ position: 'relative' }}
    >
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

      {/* Desktop-only persistent left rail. CSS hides this under 900px
          so phones / narrow tablets keep the BottomNav-driven mobile
          experience verbatim. */}
      <DesktopSidebar />

      <AppHeader />

      {/* Routed screen content.
          Previously wrapped in <AnimatePresence mode="wait"> + <motion.main>
          which caused a black-screen race on browser-Back: with mode="wait"
          the new motion.main couldn't mount until the old finished its
          exit animation, but the new one's lazy <Outlet /> chunk could
          suspend mid-cycle and leave the screen stuck at opacity:0
          (header + nav still mounted, page content invisible).
          Switched to a plain <main> + Suspense + RouteErrorBoundary so
          navigation always completes and any per-screen crash falls back
          to a v3 error card instead of a blank page.

          Phase 1 desktop shell: the inner wrapper carries the layout
          width cap. .fh-app__main absorbs the desktop sidebar offset
          (padding-left), and .fh-app__main-inner holds the centered
          content column (440 / 1280px depending on layout mode). This
          split lets the sidebar inset coexist with margin:auto centering. */}
      <main
        id="fh-main"
        className="fh-app__main"
        style={{ position: 'relative', zIndex: 1 }}
      >
        <div className="fh-app__main-inner">
          <Suspense fallback={<RouteFallback />}>
            <RouteErrorBoundary resetKey={location.key}>
              <Outlet />
            </RouteErrorBoundary>
          </Suspense>
        </div>
      </main>

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
