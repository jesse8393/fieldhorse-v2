import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearTimeClock, setTimeClockOwner } from './timeClockStorage.ts'

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
afterEach(() => { vi.unstubAllGlobals() })

function clockOf(person: string) {
  setTimeClockOwner(person)
  store.setItem('fh:timeclock:hourlyRate', '85')
  store.setItem('fh:timeclock:job-1:start', '1700000000000')
}
const clockKeys = () => store.keys().filter((k) => k.startsWith('fh:timeclock:')).sort()

describe('time clock values on this device', () => {
  it('a session that ends on its own keeps the person clock and rate', () => {
    clockOf('user-a')
    clearTimeClock({ keepOwned: true })
    setTimeClockOwner('user-a')
    expect(store.getItem('fh:timeclock:hourlyRate')).toBe('85')
    expect(store.getItem('fh:timeclock:job-1:start')).toBe('1700000000000')
  })

  it('another person signing in on the device removes them', () => {
    clockOf('user-a')
    clearTimeClock({ keepOwned: true })
    setTimeClockOwner('user-b')
    expect(clockKeys()).toEqual([])
  })

  it('a chosen Sign out removes them', () => {
    clockOf('user-a')
    clearTimeClock({ keepOwned: false })
    expect(clockKeys()).toEqual([])
    setTimeClockOwner('user-a')
    expect(clockKeys()).toEqual([])
  })

  it('values kept before they had an owner are adopted by the person signed in', () => {
    store.setItem('fh:timeclock:hourlyRate', '70')
    setTimeClockOwner('user-a')
    clearTimeClock({ keepOwned: true })
    setTimeClockOwner('user-a')
    expect(store.getItem('fh:timeclock:hourlyRate')).toBe('70')
  })

  it('a purge drops values nobody owns, since nobody can say whose they are', () => {
    store.setItem('fh:timeclock:hourlyRate', '70')
    clearTimeClock({ keepOwned: true })
    expect(clockKeys()).toEqual([])
  })

  it('no session leaves the owner as it was', () => {
    clockOf('user-a')
    setTimeClockOwner(null)
    setTimeClockOwner('user-a')
    expect(store.getItem('fh:timeclock:hourlyRate')).toBe('85')
  })
})
