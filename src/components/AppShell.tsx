import { Suspense, useEffect, useLayoutEffect, useRef } from 'react'
import { Navigate, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import AppHeader from './AppHeader.tsx'
import Dock from './fh/Dock.tsx'
import WorkspaceMenu from './WorkspaceMenu.tsx'
import { lazyWithRetry } from '../lib/lazyWithRetry.ts'
// Lazy + conditional, DesktopSidebar is hidden by CSS on mobile but
// still shipped + parsed. Gating on useIsDesktop saves the JS code
// + parse cost for phone users, who outnumber desktop usage.
const DesktopSidebar = lazyWithRetry(() => import('./DesktopSidebar.tsx'))
import CommandPalette from './CommandPalette.tsx'
import MobileSearchOverlay from './MobileSearchOverlay.tsx'
import CaptureFab from './CaptureFab.tsx'
import CaptureSheet from './CaptureSheet.tsx'
import InstallPrompt from './InstallPrompt.tsx'
import RouteErrorBoundary from './RouteErrorBoundary.tsx'
import { useIsDesktop } from '../lib/useMediaQuery.ts'
import { startOutboxSync } from '../lib/outbox.ts'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { layoutForPath } from '../lib/appLayout.ts'

// Route-loading skeleton, matches Onyx bg so split-chunk fetches don't
// flash a white screen. AppHeader and the dock stay mounted around it.
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

const MAX_RESTORE_FRAMES = 20

export default function AppShell() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const isDesktop = useIsDesktop()
  const { canViewRoute, role, loading: membershipLoading, error: membershipError } = useMembership()

  // Scroll position per history entry, so Back and Forward return to
  // where the user left a long list instead of its top. The browser's
  // own restore runs before React renders the page it belongs to, so
  // the shell takes it over while it is mounted.
  const scrollByEntry = useRef(new Map<string, number>())
  const lastPathname = useRef<string | null>(null)

  useLayoutEffect(() => {
    const { history } = window
    const previous = history.scrollRestoration
    try { history.scrollRestoration = 'manual' } catch { /* unsupported */ }
    return () => {
      try { history.scrollRestoration = previous } catch { /* unsupported */ }
    }
  }, [])

  // A layout effect, so the listener moves to the new entry before the
  // browser reports any scroll the page swap causes. While a sheet holds
  // the scroll lock (lib/documentScrollLock.ts pins the body), scrollY
  // reads 0, so those readings are skipped.
  useLayoutEffect(() => {
    const key = location.key
    const remember = () => {
      if (document.body.style.position === 'fixed') return
      scrollByEntry.current.set(key, window.scrollY)
    }
    window.addEventListener('scroll', remember, { passive: true })
    return () => window.removeEventListener('scroll', remember)
  }, [location.key])

  // A passive effect on purpose: sheets and drawers release their scroll
  // lock (which scrolls back to where the old page was) in effect
  // cleanups, and those run before this.
  useEffect(() => {
    const pathChanged = lastPathname.current !== location.pathname
    lastPathname.current = location.pathname
    const target = navigationType === 'POP' ? scrollByEntry.current.get(location.key) : undefined
    if (target == null) {
      // A new page starts at the top (tab or filter changes in the
      // query string keep their place).
      if (pathChanged) window.scrollTo({ top: 0, behavior: 'instant' })
      return
    }
    // Back or Forward: the list may still be filling in from the cache,
    // so retry for a few frames until the page is tall enough.
    let frames = 0
    let raf = 0
    const restore = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      window.scrollTo({ top: Math.min(target, Math.max(0, max)), behavior: 'instant' })
      if (max >= target || ++frames >= MAX_RESTORE_FRAMES) return
      raf = requestAnimationFrame(restore)
    }
    restore()
    return () => cancelAnimationFrame(raf)
  }, [location.key, location.pathname, navigationType])

  // Offline outbox: drain queued writes on app start, on regaining
  // network, and whenever the tab becomes visible. See lib/outbox.ts.
  useEffect(() => startOutboxSync(), [])

  // Role gate, decided while rendering so a screen this role may not
  // open never mounts (it would fire its queries, and the persisted
  // cache would keep the rows) before the redirect. A membership FETCH
  // ERROR (offline / transient) leaves role null, which is
  // indistinguishable from "confirmed not a member", don't hard-eject
  // an authenticated user to /sub-portal on a network blip. The
  // persisted cache covers reads until membership resolves.
  const route = permissionRouteForPath(location.pathname)
  const redirectTo =
    !membershipLoading &&
    !(membershipError && role === null) &&
    route !== '/sub-portal' &&
    !(role && canViewRoute(route))
      ? fallbackRouteForRole(role)
      : null

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
              {redirectTo ? <Navigate to={redirectTo} replace /> : <Outlet />}
            </RouteErrorBoundary>
          </Suspense>
        </div>
      </main>

      {/* Phone: the dock (its Capture coin is the phone's capture entry)
          and the workspace menu the header monogram opens. Desktop: the
          sidebar above, and the capture button. The sheet also answers
          Cmd/Ctrl+J and the `fh:open-capture` event everywhere. */}
      {isDesktop ? <CaptureFab /> : <Dock />}
      <WorkspaceMenu />
      <CaptureSheet />
      <CommandPalette />
      <MobileSearchOverlay />
      <InstallPrompt />
      {/* Toasts: one Sonner Toaster at the app root (components/AppToaster.tsx). */}
    </div>
  )
}
