import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'
import App from './App.tsx'
import AppErrorBoundary from './components/AppErrorBoundary.tsx'
import AppToaster from './components/AppToaster.tsx'
import ThemeLocationSync from './components/ThemeLocationSync.tsx'
import { ConfirmProvider } from './components/ConfirmSheet.tsx'
import { AuthProvider } from './contexts/AuthContext.tsx'
import { ProfileProvider } from './contexts/ProfileContext.tsx'
import { MembershipProvider } from './contexts/MembershipContext.tsx'
import { ThemeProvider } from './contexts/ThemeContext.tsx'
import { queryClient } from './lib/queryClient.ts'
import { isChunkLoadError, reloadOnceForStaleChunk } from './lib/lazyWithRetry.ts'
// Self hosted fonts (latin subset), so the installed app has its type
// offline. Barlow for the interface, Barlow Condensed for titles and big
// numbers, Bebas Neue for the FIELDHORSE wordmark only.
import '@fontsource/barlow/latin-400.css'
import '@fontsource/barlow/latin-500.css'
import '@fontsource/barlow/latin-600.css'
import '@fontsource/barlow-condensed/latin-500.css'
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/bebas-neue/latin-400.css'
import './styles/tokens.css'
import './styles/global.css'
import './styles/fixes-2026-07.css'
import './styles/v3.css'
// October 2026 redesign overrides for screens not yet rebuilt.
import './styles/redesign.css'
import './styles/fh-components.css'
import './styles/fh-shell.css'
// Loaded LAST so cascade-equal rules win. See file header for context.
import './styles/mobile-keyboard-fix.css'

// Build stamp, emits <meta name="fh-build" content="SHA · ISO"> on
// every load so a live audit can confirm which commit is deployed
// (audit L1). Defines come from vite.config.js. Falls back to "dev"
// when running outside the Vite build.
declare const __FH_BUILD_SHA__: string
declare const __FH_BUILD_AT__: string
if (typeof document !== 'undefined') {
  try {
    const sha = typeof __FH_BUILD_SHA__ === 'string' ? __FH_BUILD_SHA__ : 'dev'
    const at = typeof __FH_BUILD_AT__ === 'string' ? __FH_BUILD_AT__ : ''
    const meta = document.createElement('meta')
    meta.name = 'fh-build'
    meta.content = at ? `${sha} · ${at}` : sha
    document.head.appendChild(meta)
  } catch { /* non-fatal */ }
}

/*
 * ONE-TIME SERVICE WORKER KILL SWITCH (5/17)
 * ------------------------------------------------------
 * The previous VitePWA config did not set skipWaiting, so every shipped
 * update sat in the SW "waiting" state and never activated until every
 * tab closed. End result for the user: weeks of merged design work
 * never reached the browser.
 *
 * This block runs ONCE per browser. It unregisters any installed SW,
 * deletes every Cache Storage entry and sets a localStorage flag so it
 * never runs again. It reloads only when it actually removed something,
 * so a first visit (nothing installed yet) is not loaded twice. After
 * reload the new SW (now built with skipWaiting + clientsClaim)
 * installs cleanly.
 *
 * Safe because:
 *   - guarded by `fh-sw-killed-v2` flag, runs exactly once per browser
 *   - the reload is a one-shot, can't loop (flag is set BEFORE reload)
 *   - on browsers without serviceWorker (rare) it's a no-op
 *   - storage access can throw (blocked site data, some private modes);
 *     the whole block is skipped then instead of blanking the page
 *     before React mounts
 */
if (typeof window !== 'undefined') {
  try {
    const KILL_KEY = 'fh-sw-killed-v2'
    if ('serviceWorker' in navigator && !localStorage.getItem(KILL_KEY)) {
      localStorage.setItem(KILL_KEY, '1')
      Promise.all([
        navigator.serviceWorker.getRegistrations().then((regs) =>
          Promise.all(regs.map((r) => r.unregister())).then(() => regs.length)
        ),
        'caches' in window
          ? caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))).then(() => keys.length))
          : Promise.resolve(0)
      ])
        .then(([removedWorkers, removedCaches]) => {
          if (removedWorkers > 0 || removedCaches > 0) location.reload()
        })
        .catch(() => {})
    }
  } catch { /* storage or service worker access blocked: skip the cleanup */ }
}

// A deploy replaced the hashed chunks this page was built against, so a
// lazy screen or sheet failed to load. Reload once to pick up the new
// build (see lib/lazyWithRetry.ts); if that was already tried, let the
// error reach the error boundary instead.
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    if (isChunkLoadError((event as Event & { payload?: unknown }).payload) && reloadOnceForStaleChunk()) {
      event.preventDefault()
    }
  })
}

// Offline reads: persist the TanStack Query cache so a cold open with no
// signal still shows jobs / leads / schedule from the last sync instead
// of blank screens. The outbox (lib/outbox.ts) covers the write side.
// `buster` (QUERY_CACHE_VERSION) throws the persisted cache away when it
// changes, so a schema-shaped change never rehydrates stale rows into new
// code. It used to be the build SHA, which wiped the cache on every
// deploy: the first cold open after an update, often at a job site with
// no signal, had nothing to show.
//
// IndexedDB, not localStorage (scaling pass): localStorage caps at ~5MB
// and serializes the WHOLE cache synchronously on the main thread every
// write, visible jank once the book has thousands of rows. idb-keyval is
// async and effectively unbounded. One time cleanup drops the old
// localStorage blob so it stops eating the quota.
try { localStorage.removeItem('fh-query-cache') } catch { /* non-fatal */ }
// Bump only when the shape of persisted query data changes in a way that
// old rows would break the new code.
const QUERY_CACHE_VERSION = 'v1'
const queryPersister = createAsyncStoragePersister({
  storage: {
    getItem: (key: string) => idbGet(key).then((v) => v ?? null),
    setItem: (key: string, value: string) => idbSet(key, value),
    removeItem: (key: string) => idbDel(key)
  },
  key: 'fh-query-cache',
  // Coalesce rapid cache updates (realtime bursts, optimistic patches)
  // into one IDB write instead of one per update.
  throttleTime: 2000
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <BrowserRouter
        future={{
          // Opt in to v7 behavior now so the warnings stop and we don't
          // have to scramble when v7 ships.
          v7_startTransition: true,
          v7_relativeSplatPath: true
        }}
      >
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister: queryPersister,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            buster: QUERY_CACHE_VERSION,
            dehydrateOptions: {
              // Don't persist per-keystroke search results, every
              // ['jobSearch', pattern] entry carries up to 100 rows and
              // there's one per pattern typed; they'd bloat the blob and
              // are worthless offline (the cached list already covers
              // recent rows). Persist only settled, successful queries.
              shouldDehydrateQuery: (q) =>
                q.state.status === 'success' && q.queryKey[0] !== 'jobSearch'
            }
          }}
        >
          <ThemeProvider>
            <AuthProvider>
              <ProfileProvider>
                <MembershipProvider>
                  {/* Honor the OS Reduce Motion setting app wide: framer-motion
                      then skips transform and layout animations (slides,
                      springs) and keeps fades. */}
                  <MotionConfig reducedMotion="user">
                    <ConfirmProvider>
                      {/* Before App so it is listening before any screen's
                          mount effects fire a toast. */}
                      <AppToaster />
                      <ThemeLocationSync />
                      <App />
                    </ConfirmProvider>
                  </MotionConfig>
                </MembershipProvider>
              </ProfileProvider>
            </AuthProvider>
          </ThemeProvider>
        </PersistQueryClientProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  </React.StrictMode>
)
