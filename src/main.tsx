import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'
import App from './App.tsx'
import AppErrorBoundary from './components/AppErrorBoundary.tsx'
import { ConfirmProvider } from './components/ConfirmSheet.tsx'
import { AuthProvider } from './contexts/AuthContext.tsx'
import { ProfileProvider } from './contexts/ProfileContext.tsx'
import { MembershipProvider } from './contexts/MembershipContext.tsx'
import { ThemeProvider } from './contexts/ThemeContext.tsx'
import { queryClient } from './lib/queryClient.ts'
import './styles/tokens.css'
import './styles/global.css'
import './styles/fixes-2026-07.css'
import './styles/v3.css'
// Loaded LAST so cascade-equal rules win. See file header for context.
import './styles/mobile-keyboard-fix.css'

// Build stamp — emits <meta name="fh-build" content="SHA · ISO"> on
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
 * deletes every Cache Storage entry, sets a localStorage flag so it
 * never runs again, then hard-reloads. After reload the new SW (now
 * built with skipWaiting + clientsClaim) installs cleanly.
 *
 * Safe because:
 *   - guarded by `fh-sw-killed-v2` flag, runs exactly once per browser
 *   - the reload is a one-shot, can't loop (flag is set BEFORE reload)
 *   - on browsers without serviceWorker (rare) it's a no-op
 */
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  const KILL_KEY = 'fh-sw-killed-v2'
  if (!localStorage.getItem(KILL_KEY)) {
    localStorage.setItem(KILL_KEY, '1')
    Promise.all([
      navigator.serviceWorker.getRegistrations().then((regs) =>
        Promise.all(regs.map((r) => r.unregister()))
      ),
      'caches' in window
        ? caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        : Promise.resolve()
    ])
      .catch(() => {})
      .finally(() => {
        location.reload()
      })
  }
}

// Offline reads: persist the TanStack Query cache so a cold open with no
// signal still shows jobs / leads / schedule from the last sync instead
// of blank screens. The outbox (lib/outbox.ts) covers the write side.
// `buster` ties the cache to the deployed build so a schema-shaped change
// never rehydrates stale rows into new code.
//
// IndexedDB, not localStorage (scaling pass): localStorage caps at ~5MB
// and serializes the WHOLE cache synchronously on the main thread every
// write — visible jank once the book has thousands of rows. idb-keyval is
// async and effectively unbounded. One-time cleanup drops the old
// localStorage blob so it stops eating the quota.
try { localStorage.removeItem('fh-query-cache') } catch { /* non-fatal */ }
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
            buster: typeof __FH_BUILD_SHA__ === 'string' ? __FH_BUILD_SHA__ : 'dev',
            dehydrateOptions: {
              // Don't persist per-keystroke search results — every
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
                  <ConfirmProvider>
                    <App />
                  </ConfirmProvider>
                </MembershipProvider>
              </ProfileProvider>
            </AuthProvider>
          </ThemeProvider>
        </PersistQueryClientProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  </React.StrictMode>
)
