import { describe, expect, it, vi } from 'vitest'
import { createAuthSessionBoundary } from './authSessionBoundary'
const session = (id: string) => ({ user: { id } })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
function ownerStore(initial: string | null) {
  const store = { saved: initial, read: () => store.saved, write: (id: string | null) => { store.saved = id } }
  return store
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
  it('keeps queued offline work when the session ends without the person choosing to sign out', async () => {
    const purge = vi.fn(async (_scope: { queuedWork: boolean }) => {})
    const boundary = createAuthSessionBoundary({ publish: vi.fn(), hold: vi.fn(), purge })
    boundary.update('SIGNED_IN', session('a')); await boundary.flush()
    // auth-js drops a session whose refresh token was refused (a 401).
    boundary.update('SIGNED_OUT', null); await boundary.flush()
    expect(purge).toHaveBeenLastCalledWith({ queuedWork: false })
    // Another account on the device keeps it too: queued work is tagged
    // with its owner and only ever drains for them.
    boundary.update('SIGNED_IN', session('a')); await boundary.flush()
    boundary.update('SIGNED_IN', session('b')); await boundary.flush()
    expect(purge).toHaveBeenLastCalledWith({ queuedWork: false })
  })
  it('clears queued offline work when the person signs out', async () => {
    const purge = vi.fn(async (_scope: { queuedWork: boolean }) => {})
    const boundary = createAuthSessionBoundary({ publish: vi.fn(), hold: vi.fn(), purge })
    boundary.update('SIGNED_IN', session('a')); await boundary.flush()
    const cancel = boundary.chosenSignOut()
    cancel() // the sign out request failed: still signed in
    boundary.update('SIGNED_OUT', null); await boundary.flush()
    expect(purge).toHaveBeenLastCalledWith({ queuedWork: false })
    boundary.update('SIGNED_IN', session('a')); await boundary.flush()
    boundary.chosenSignOut()
    boundary.update('SIGNED_OUT', null); await boundary.flush()
    expect(purge).toHaveBeenLastCalledWith({ queuedWork: true })
  })
  it("purges before publishing when a page load opens on another account's saved book", async () => {
    const cleanup = deferred<void>()
    const publish = vi.fn(); const hold = vi.fn(); const purge = vi.fn(() => cleanup.promise)
    const owner = ownerStore('a')
    const boundary = createAuthSessionBoundary({ publish, hold, purge, owner })
    // B's password reset or confirmation link: the first session of this
    // page load is B's, while the saved cache is still A's.
    boundary.update('INITIAL_SESSION', session('b'))
    await Promise.resolve()
    expect(hold).toHaveBeenCalledOnce()
    expect(purge).toHaveBeenCalledExactlyOnceWith({ queuedWork: false })
    expect(publish).not.toHaveBeenCalled()
    expect(owner.saved).toBe('a')
    cleanup.resolve(); await boundary.flush()
    expect(publish).toHaveBeenCalledExactlyOnceWith(session('b'))
    expect(owner.saved).toBe('b')
  })
  it("keeps the owner's saved book on a page load that opens on the same account or on no session", async () => {
    const purge = vi.fn(async () => {})
    const owner = ownerStore('a')
    const boundary = createAuthSessionBoundary({ publish: vi.fn(), hold: vi.fn(), purge, owner })
    // Offline with an expired token the first answer is no session at all.
    boundary.update('INITIAL_SESSION', null); await boundary.flush()
    boundary.update('TOKEN_REFRESHED', session('a')); await boundary.flush()
    expect(purge).not.toHaveBeenCalled()
    expect(owner.saved).toBe('a')
  })
  it('purges the saved book when another account signs in after a page load with no session', async () => {
    const purge = vi.fn(async () => {})
    const boundary = createAuthSessionBoundary({ publish: vi.fn(), hold: vi.fn(), purge, owner: ownerStore('a') })
    boundary.update('INITIAL_SESSION', null); await boundary.flush()
    boundary.update('SIGNED_IN', session('b')); await boundary.flush()
    expect(purge).toHaveBeenCalledOnce()
  })
  it('adopts the first account when no owner was recorded, and forgets it after a sign out purge', async () => {
    const purge = vi.fn(async () => {})
    const owner = ownerStore(null)
    const boundary = createAuthSessionBoundary({ publish: vi.fn(), hold: vi.fn(), purge, owner })
    boundary.update('INITIAL_SESSION', session('a')); await boundary.flush()
    expect(purge).not.toHaveBeenCalled()
    expect(owner.saved).toBe('a')
    boundary.update('SIGNED_OUT', null); await boundary.flush()
    expect(owner.saved).toBeNull()
    boundary.update('SIGNED_IN', session('b')); await boundary.flush()
    expect(purge).toHaveBeenCalledOnce()
    expect(owner.saved).toBe('b')
  })
  it('does not publish an account after disposal', async () => {
    const publish = vi.fn()
    const boundary = createAuthSessionBoundary({ publish, hold: vi.fn(), purge: vi.fn(async () => {}) })
    boundary.update('SIGNED_IN', session('a')); boundary.dispose()
    await boundary.flush()
    expect(publish).not.toHaveBeenCalled()
  })
})
