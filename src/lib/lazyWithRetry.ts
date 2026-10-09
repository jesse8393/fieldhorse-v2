// Recovery from stale chunks after a deploy.
//
// Route screens and sheets are split into hashed chunks. When a deploy
// lands while the app is open (or an installed PWA wakes on an old
// index.html), the old chunk names are gone: the request falls through
// to the SPA rewrite, comes back as HTML, and the dynamic import fails.
// React.lazy caches that failure, so the screen stays broken until a
// full reload. One reload fetches the new build and fixes it.
//
// The reload is one shot per build: a sessionStorage key that includes
// the build id records the attempt, so a chunk that is genuinely broken
// shows the error screen instead of reloading forever. Without storage
// there is no way to remember the attempt, so no automatic reload.

import { lazy, type ComponentType } from 'react'

declare const __FH_BUILD_SHA__: string

const RELOAD_KEY_PREFIX = 'fh:chunk-reload:'

const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i

export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false
  const name = (err as { name?: unknown }).name
  if (name === 'ChunkLoadError') return true
  const message = (err as { message?: unknown }).message
  return CHUNK_ERROR.test(typeof message === 'string' ? message : String(err))
}

function buildId(): string {
  return typeof __FH_BUILD_SHA__ === 'string' ? __FH_BUILD_SHA__ : 'dev'
}

/**
 * Reload the page to pick up the new build, at most once per build per
 * tab. Returns true when a reload was started.
 */
export function reloadOnceForStaleChunk(): boolean {
  if (typeof window === 'undefined') return false
  const key = `${RELOAD_KEY_PREFIX}${buildId()}`
  try {
    if (window.sessionStorage.getItem(key)) return false
    window.sessionStorage.setItem(key, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

// Stays pending: the page is about to reload, so keep showing the
// Suspense fallback instead of flashing an error card.
function untilReload<T>(): Promise<T> {
  return new Promise<T>(() => {})
}

/**
 * React.lazy with stale chunk recovery. A failed import triggers the one
 * shot reload; if that was already used, the error reaches the nearest
 * error boundary as before.
 */
export function lazyWithRetry<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(() =>
    factory().then(
      // Empty result: main.tsx's vite:preloadError handler swallowed the
      // failure because it already started the reload.
      (mod) => mod ?? untilReload<{ default: T }>(),
      (err) => {
        if (isChunkLoadError(err) && reloadOnceForStaleChunk()) return untilReload<{ default: T }>()
        throw err
      }
    )
  )
}
