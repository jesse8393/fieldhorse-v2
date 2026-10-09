import { afterEach, describe, expect, it, vi } from 'vitest'
import { isChunkLoadError, reloadOnceForStaleChunk } from './lazyWithRetry.ts'

describe('isChunkLoadError', () => {
  it('recognizes a stale chunk in every browser', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://app.example/assets/Settings-a1b2.js'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: https://app.example/assets/Work-c3d4.js'))).toBe(true)
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/Bid-e5f6.css'))).toBe(true)
    expect(isChunkLoadError({ name: 'ChunkLoadError', message: 'Loading chunk 7 failed' })).toBe(true)
  })

  it('leaves ordinary errors alone', () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'name')"))).toBe(false)
    expect(isChunkLoadError(new Error('Failed to fetch'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
  })
})

describe('reloadOnceForStaleChunk', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubWindow(sessionStorage: unknown) {
    const reload = vi.fn()
    vi.stubGlobal('window', { sessionStorage, location: { reload } })
    return reload
  }

  it('reloads once per build, then leaves it to the error screen', () => {
    const store = new Map<string, string>()
    const reload = stubWindow({
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) }
    })
    expect(reloadOnceForStaleChunk()).toBe(true)
    expect(reloadOnceForStaleChunk()).toBe(false)
    expect(reloadOnceForStaleChunk()).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
    // Keyed by build, so the next deploy gets its own single attempt.
    expect([...store.keys()]).toEqual(['fh:chunk-reload:dev'])
  })

  it('never reloads when it cannot remember the attempt', () => {
    const blocked = () => { throw new Error('SecurityError') }
    const reload = stubWindow({ getItem: blocked, setItem: blocked })
    expect(reloadOnceForStaleChunk()).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('does nothing outside the browser', () => {
    expect(reloadOnceForStaleChunk()).toBe(false)
  })
})
