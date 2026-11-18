import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LAST_JOB_TYPE_KEY, readLastJobType, writeLastJobType } from './jobTypes.ts'

class MemoryStorage {
  private items = new Map<string, string>()
  get length() { return this.items.size }
  key(i: number) { return [...this.items.keys()][i] ?? null }
  getItem(k: string) { return this.items.has(k) ? this.items.get(k)! : null }
  setItem(k: string, v: string) { this.items.set(k, String(v)) }
  removeItem(k: string) { this.items.delete(k) }
}

let store: MemoryStorage
beforeEach(() => {
  store = new MemoryStorage()
  vi.stubGlobal('localStorage', store)
})
afterEach(() => vi.unstubAllGlobals())

describe('the last job type picked on this device', () => {
  it('starts empty when nothing was picked yet', () => {
    expect(readLastJobType()).toBe('')
  })

  it('gives back the job type saved last', () => {
    writeLastJobType('Concrete')
    expect(readLastJobType()).toBe('Concrete')
    writeLastJobType('Roofing')
    expect(readLastJobType()).toBe('Roofing')
  })

  it('keeps the last real pick when a record is saved with no job type', () => {
    writeLastJobType('Concrete')
    writeLastJobType('')
    expect(readLastJobType()).toBe('Concrete')
  })

  it('ignores a value that is not a job type', () => {
    writeLastJobType('Plumbing')
    expect(store.getItem(LAST_JOB_TYPE_KEY)).toBeNull()
    store.setItem(LAST_JOB_TYPE_KEY, 'Plumbing')
    expect(readLastJobType()).toBe('')
  })

  it('moves the job type the old lead sheet kept under fh:lastJobType, once', () => {
    store.setItem('fh:lastJobType', 'Concrete')
    expect(readLastJobType()).toBe('Concrete')
    expect(store.getItem(LAST_JOB_TYPE_KEY)).toBe('Concrete')
    expect(store.getItem('fh:lastJobType')).toBeNull()
    expect(readLastJobType()).toBe('Concrete')
  })

  it('prefers the current key over the old one', () => {
    store.setItem('fh:lastJobType', 'Concrete')
    writeLastJobType('Kitchen')
    expect(readLastJobType()).toBe('Kitchen')
  })

  it('drops an old value that is no longer a job type', () => {
    store.setItem('fh:lastJobType', 'Siding')
    expect(readLastJobType()).toBe('')
    expect(store.getItem('fh:lastJobType')).toBeNull()
    expect(store.getItem(LAST_JOB_TYPE_KEY)).toBeNull()
  })

  it('reads as empty when storage is blocked', () => {
    vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } })
    expect(readLastJobType()).toBe('')
    expect(() => writeLastJobType('Concrete')).not.toThrow()
  })
})
