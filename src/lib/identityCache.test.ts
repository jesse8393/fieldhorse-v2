import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDENTITY_CACHE_PREFIX, readSavedIdentity, saveIdentity } from './identityCache.ts'

class MemoryStorage {
  private items = new Map<string, string>()
  get length() { return this.items.size }
  key(i: number) { return [...this.items.keys()][i] ?? null }
  getItem(k: string) { return this.items.has(k) ? this.items.get(k)! : null }
  setItem(k: string, v: string) { this.items.set(k, String(v)) }
  removeItem(k: string) { this.items.delete(k) }
  keys() { return [...this.items.keys()] }
}

let store: MemoryStorage
beforeEach(() => {
  store = new MemoryStorage()
  vi.stubGlobal('localStorage', store)
})
afterEach(() => vi.unstubAllGlobals())

describe('the profile and workspace saved on this device', () => {
  it('gives back what was saved for the same person', () => {
    saveIdentity('profile', 'user-a', { user_id: 'user-a', full_name: 'Jesse Parker' })
    expect(readSavedIdentity('profile', 'user-a')).toEqual({ user_id: 'user-a', full_name: 'Jesse Parker' })
  })

  it('never gives one person what was saved for another', () => {
    saveIdentity('membership', 'user-a', { rows: [{ org_id: 'org-1' }] })
    expect(readSavedIdentity('membership', 'user-b')).toBeNull()
  })

  it('keeps one person at a time: saving for a new person drops the last one', () => {
    saveIdentity('profile', 'user-a', { user_id: 'user-a' })
    saveIdentity('membership', 'user-a', { rows: [] })
    saveIdentity('profile', 'user-b', { user_id: 'user-b' })
    expect(readSavedIdentity('profile', 'user-a')).toBeNull()
    expect(readSavedIdentity('membership', 'user-a')).toBeNull()
    expect(store.keys().every((k) => k.startsWith(IDENTITY_CACHE_PREFIX) && k.endsWith(':user-b'))).toBe(true)
  })

  it('forgets a saved value when null is saved', () => {
    saveIdentity('profile', 'user-a', { user_id: 'user-a' })
    saveIdentity('profile', 'user-a', null)
    expect(readSavedIdentity('profile', 'user-a')).toBeNull()
  })

  it('reads a damaged entry as nothing saved', () => {
    store.setItem(`${IDENTITY_CACHE_PREFIX}profile:user-a`, '{not json')
    expect(readSavedIdentity('profile', 'user-a')).toBeNull()
  })

  it('keeps working when storage is blocked', () => {
    vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') }, key() { throw new Error('blocked') }, get length() { throw new Error('blocked') } })
    expect(() => saveIdentity('profile', 'user-a', { user_id: 'user-a' })).not.toThrow()
    expect(readSavedIdentity('profile', 'user-a')).toBeNull()
  })
})
