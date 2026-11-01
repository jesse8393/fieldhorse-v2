import { describe, expect, it, vi } from 'vitest'
import { createAuthSessionBoundary } from './authSessionBoundary'
const session = (id: string) => ({ user: { id } })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
describe('browser account boundary', () => {
  it('holds the next account until local cleanup finishes, including a token event during cleanup', async () => {
    const cleanup = deferred<void>()
    const publish = vi.fn(); const hold = vi.fn(); const purge = vi.fn(() => cleanup.promise)
    const boundary = createAuthSessionBoundary({ publish, hold, purge })
    boundary.update('SIGNED_IN', session('a')); await boundary.flush()
    publish.mockClear()
    boundary.update('SIGNED_IN', session('b'))
    boundary.update('TOKEN_REFRESHED', session('b'))
    await Promise.resolve()
    expect(hold).toHaveBeenCalledOnce()
    expect(purge).toHaveBeenCalledOnce()
    expect(publish).not.toHaveBeenCalled()
    cleanup.resolve(); await boundary.flush()
    expect(publish).toHaveBeenCalledExactlyOnceWith(session('b'))
  })
  it('does not let a stale restore overwrite a newer sign-in', async () => {
    const initial = deferred<ReturnType<typeof session> | null>()
    const publish = vi.fn()
    const boundary = createAuthSessionBoundary({ publish, hold: vi.fn(), purge: vi.fn(async () => {}) })
    const restoring = boundary.restore(initial.promise)
    boundary.update('SIGNED_IN', session('new'))
    initial.resolve(session('old'))
    await restoring; await boundary.flush()
    expect(publish).toHaveBeenCalledExactlyOnceWith(session('new'))
  })
  it('keeps the same account cache through refresh but purges remote sign-out', async () => {
    const purge = vi.fn(async () => {})
    const boundary = createAuthSessionBoundary({ publish: vi.fn(), hold: vi.fn(), purge })
    boundary.update('SIGNED_IN', session('a')); await boundary.flush()
    boundary.update('TOKEN_REFRESHED', session('a')); await boundary.flush()
    expect(purge).not.toHaveBeenCalled()
    boundary.update('SIGNED_OUT', null); await boundary.flush()
    expect(purge).toHaveBeenCalledOnce()
  })
  it('does not publish an account after disposal', async () => {
    const publish = vi.fn()
    const boundary = createAuthSessionBoundary({ publish, hold: vi.fn(), purge: vi.fn(async () => {}) })
    boundary.update('SIGNED_IN', session('a')); boundary.dispose()
    await boundary.flush()
    expect(publish).not.toHaveBeenCalled()
  })
})
