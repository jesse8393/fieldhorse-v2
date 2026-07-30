import { lazy, Suspense, useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Toaster as SonnerToaster } from 'sonner'
import AppHeader from './AppHeader.tsx'
import BottomNav from './BottomNav.tsx'
// Lazy + conditional, DesktopSidebar is hidden by CSS on mobile but
// still shipped + parsed. Gating on useIsDesktop saves the JS code
// + parse cost for phone users, who outnumber desktop usage.
const DesktopSidebar = lazy(() => import('./DesktopSidebar.tsx'))
import CommandPalette from './CommandPalette.tsx'
import MobileSearchOverlay from './MobileSearchOverlay.tsx'
import CaptureFab from './CaptureFab.tsx'
import CaptureSheet from './CaptureSheet.tsx'
import InstallPrompt from './InstallPrompt.tsx'
import RouteErrorBoundary from './RouteErrorBoundary.tsx'
import { useIsDesktop } from '../lib/useMediaQuery.ts'
import { startOutboxSync } from '../lib/outbox.ts'
import { useMembership } from '../contexts/MembershipContext.tsx'

// Route-loading skeleton, matches Onyx bg so split-chunk fetches don't
// flash a white screen. AppHeader + BottomNav stay mounted around it.
//
// Audit found Client detail + Notes feeling broken because the chunk
// load + initial data fetch combined for ~2-3 s of mostly-empty
// screen. The fallback now renders a mini skeleton header + 3 row
// placeholders so the user sees structure instead of a spinner that
// reads as "broken".
function RouteFallback() {
  return (
    <div style={{ padding: '24px 24px 48px' }}>
      <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ width: 100, height: 11, borderRadius: 10, background: 'var(--v3-glass-tint-2)' }} />
        <span style={{ width: '60%', maxWidth: 280, height: 28, borderRadius: 10, background: 'var(--v3-glass-tint-2)', marginBottom: 6 }} />
        <span style={{ width: '100%', height: 64, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)', opacity: 0.55 }} />
        <span style={{ width: '100%', height: 64, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)', opacity: 0.4 }} />
        <span style={{ width: '100%', height: 64, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)', opacity: 0.28 }} />
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
 * 2/3. Screens stay layout-agnostic, they don't read the mode, they
 * just render their mobile-first markup and the shell decides how much
 * canvas they get.
 */
function layoutForPath(pathname: any) {
  // Responsive Desktop Command Center.
  //   Phase 1: Home (`/`), multi-column dashboard canvas.
  //   Phase 2: Jobs (`/jobs`) + Clients (`/clients`), desktop command
  //            header + wide card grid.
  //   Phase 2.5 / 3: All remaining tool routes get the responsive
  //            workspace canvas at >=900px so they stop rendering as a
  //            440px phone column inside a giant desktop shell. Each
  //            screen author can layer dedicated desktop CSS on top of
  //            their `v3-screen` markup as time permits, until then the
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
  if (pathname === '/work') return 'responsive'
  if (pathname === '/leads') return 'responsive'
  if (pathname === '/quotes') return 'responsive'
  if (pathname === '/pipeline') return 'responsive'
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
  if (pathname === '/activity') return 'responsive'
  // V3-CMD-CENTER-FIX (audit Jun 2026): Crew Home / Tasks / Team /
  // Timesheets were falling through to mobile-frame and rendering as
  // a 440px column floating in the desktop viewport. They use the same
  // Snow*Build chrome as Jobs/Clients/etc and need the wide canvas.
  if (pathname === '/crew') return 'responsive'
  if (pathname === '/tasks') return 'responsive'
  if (pathname === '/team') return 'responsive'
  if (pathname === '/timesheets') return 'responsive'
  // Phase 4: Job Detail (`/jobs/:id`) is the host of the Estimate
  // workspace (Quote tab) and gets the responsive canvas. Non-quote
  // tabs (Overview / Details / Financials / Files) inherit the wider
  // canvas but keep their existing per-section padding so they render
  // as wide rows rather than a 440px column floating in space. Quote
  // tab itself flips to a true 2-pane workspace via scoped CSS keyed
  // off the .v3-screen--quote-active modifier set in ContactDetail.
  if (pathname.startsWith('/leads/')) return 'responsive'
  if (pathname.startsWith('/quotes/')) return 'responsive'
  if (pathname.startsWith('/jobs/')) return 'responsive'
  // Client Detail renders the full-width SnowClientDetailBuild on desktop :
  // it needs the wide canvas too, or it renders crammed inside the 440px
  // mobile-frame cap (the worst of both). Give it the responsive canvas
  // like every other detail route.
  if (pathname.startsWith('/clients/')) return 'responsive'
  return 'mobile-frame'
}

function permissionRouteForPath(pathname: string) {
  if (pathname.startsWith('/leads/')) return '/leads'
  if (pathname.startsWith('/quotes/')) return '/quotes'
  if (pathname.startsWith('/jobs/')) return '/jobs'
  if (pathname.startsWith('/clients/')) return '/clients'
  if (pathname.startsWith('/subs/')) return '/subs'
  if (pathname.startsWith('/invoices/')) return '/invoices'
  return pathname
}

function fallbackRouteForRole(role: string | null) {
  if (!role) return '/sub-portal'
  if (role === 'crew' || role === 'foreman') return '/crew'
  return '/'
}

export default function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const isDesktop = useIsDesktop()
  const { canViewRoute, role, loading: membershipLoading, error: membershipError } = useMembership()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [location.pathname])

  // Offline outbox: drain queued writes on app start, on regaining
  // network, and whenever the tab becomes visible. See lib/outbox.ts.
  useEffect(() => startOutboxSync(), [])

  useEffect(() => {
    if (membershipLoading) return
    // A membership FETCH ERROR (offline / transient) leaves role null,
    // which is indistinguishable from "confirmed not a member", don't
    // hard-eject an authenticated user to /sub-portal on a network blip.
    // The persisted cache covers reads until membership resolves.
    if (membershipError && role === null) return
    const route = permissionRouteForPath(location.pathname)
    if (route === '/sub-portal') return
    const allowed = role ? canViewRoute(route) : false
    if (!allowed) {
      navigate(fallbackRouteForRole(role), { replace: true })
    }
  }, [canViewRoute, location.pathname, membershipLoading, membershipError, navigate, role])

  // Global navigation event so chrome buttons inside Build components
  // (bell, footer links, etc.) can navigate without each component
  // pulling in react-router. Dispatch from anywhere via:
  //   window.dispatchEvent(new CustomEvent('fh:navigate', { detail: { to: '/activity' } }))
  useEffect(() => {
    function onNav(e: any) {
      const to = e?.detail?.to
      if (typeof to === 'string' && to.length > 0) navigate(to)
    }
    window.addEventListener('fh:navigate', onNav as EventListener)
    return () => window.removeEventListener('fh:navigate', onNav as EventListener)
  }, [navigate])

  const layoutMode = layoutForPath(location.pathname)

  return (
    <div
      className={`fh-app fh-app--layout-${layoutMode}`}
      data-layout={layoutMode}
      style={{ position: 'relative' }}
    >
      {/* Skip-to-content link, only visible when keyboard-focused.
          Bumps a11y so keyboard users don't have to tab through every
          header + nav control to reach the screen body. */}
      <a href="#fh-main" className="fh-skip-link">Skip to content</a>
      {/* Removed for v3:
          - <Aurora />          three large gold radial blobs (atmosphere)
          - <GridPattern />     drifting 40px white grid (the "grid texture")
          - <div .fh-page-corners> four gold corner brackets, the
            bottom-left bracket was reading as a stray gold "+" once
            legacy gold tokens were aliased to the v3 (brighter) gold.
          v3 page atmosphere is provided by .v3-screen background only. */}

      {/* Desktop-only persistent left rail. CSS hides this under 900px
          so phones / narrow tablets keep the BottomNav-driven mobile
          experience verbatim. */}
      {isDesktop && (
        <Suspense fallback={null}>
          <DesktopSidebar />
        </Suspense>
      )}

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
      {/* Universal Capture, the global "say it / type it / snap it"
          entry point. FAB opens the sheet; the sheet also answers
          Cmd/Ctrl+J and the `fh:open-capture` event. */}
      <CaptureFab />
      <CaptureSheet />
      <CommandPalette />
      <MobileSearchOverlay />
      <InstallPrompt />

      {/* Single toast system: Sonner only. The legacy fh:toast banner
          rendered the SAME event a second time (top banner + bottom
          card for one action), which read as debris. lib/toast.ts still
          dispatches fh:toast for any listener, but nothing renders it.
          Desktop: compact bottom-right cards, offset left of the FAB
          column (FAB is fixed right:20 / 56px wide) so toasts never
          cover it. Mobile: full-width banner above the bottom nav. */}
      <SonnerToaster
        position="bottom-right"
        theme="dark"
        richColors
        visibleToasts={3}
        offset={{ bottom: '20px', right: '92px' }}
        mobileOffset={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)', left: '16px', right: '16px' }}
        toastOptions={{
          style: {
            maxWidth: 'min(380px, calc(100vw - 32px))',
            background: 'var(--v3-surface-glass)',
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
