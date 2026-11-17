import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DRAFT_TTL_MS, clearDraft, clearDrafts, readDraft, readDraftEntry, sameDraft, setDraftOwner, startEdit, writeDraft } from './drafts.ts'

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
  setDraftOwner('user-a')
})
afterEach(() => {
  setDraftOwner(null)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('drafts kept on this device', () => {
  it('gives a draft back to the person who typed it', () => {
    writeDraft('quote', { title: 'Hughes driveway' })
    expect(readDraft('quote')).toEqual({ title: 'Hughes driveway' })
    expect(JSON.parse(store.getItem('fh:draft:quote')!).userId).toBe('user-a')
  })

  it('never gives one person a draft another person typed', () => {
    writeDraft('quote', { title: 'Hughes driveway' })
    setDraftOwner('user-b')
    expect(readDraft('quote')).toBeNull()
  })

  it('removes the other person\'s drafts when a new person signs in', () => {
    writeDraft('quote', { title: 'Hughes driveway' })
    writeDraft('edit:quote-terms:q1', { scope: 'Pour' }, { scope: '' })
    setDraftOwner('user-b')
    expect(store.keys()).toEqual([])
  })

  it('keeps the same person\'s drafts when they sign in again', () => {
    writeDraft('quote', { title: 'Hughes driveway' })
    setDraftOwner(null)
    setDraftOwner('user-a')
    expect(readDraft('quote')).toEqual({ title: 'Hughes driveway' })
  })

  it('adopts a draft saved before drafts carried a tag, once, for the person signing in', () => {
    store.setItem('fh:draft:job', JSON.stringify({ form: { title: 'Garage slab' }, savedAt: Date.now() }))
    setDraftOwner('user-a')
    expect(JSON.parse(store.getItem('fh:draft:job')!).userId).toBe('user-a')
    setDraftOwner('user-b')
    expect(store.getItem('fh:draft:job')).toBeNull()
  })

  it('writes nothing while nobody is signed in', () => {
    setDraftOwner(null)
    writeDraft('quote', { title: 'Hughes driveway' })
    expect(store.getItem('fh:draft:quote')).toBeNull()
  })

  it('forgets a draft with nothing typed in it', () => {
    writeDraft('quote', { title: 'Hughes driveway' })
    writeDraft('quote', { title: '  ' })
    expect(store.getItem('fh:draft:quote')).toBeNull()
  })

  it('reads nothing back after a day', () => {
    vi.useFakeTimers()
    writeDraft('quote', { title: 'Hughes driveway' })
    vi.setSystemTime(Date.now() + DRAFT_TTL_MS + 1000)
    expect(readDraft('quote')).toBeNull()
  })

  it('clearDraft removes one draft', () => {
    writeDraft('quote', { title: 'Hughes driveway' })
    clearDraft('quote')
    expect(readDraftEntry('quote')).toBeNull()
  })
})

describe('a session that ends', () => {
  it('on its own keeps every tagged draft and drops untagged ones', () => {
    writeDraft('quote', { title: 'Hughes driveway' })
    store.setItem('fh:draft:job', JSON.stringify({ form: { title: 'Nobody knows whose' }, savedAt: Date.now() }))
    store.setItem('fh:other', 'kept')
    clearDrafts({ keepOwned: true })
    expect(store.keys().sort()).toEqual(['fh:draft:quote', 'fh:other'])
    expect(readDraft('quote')).toEqual({ title: 'Hughes driveway' })
  })

  it('by a chosen Sign out clears every draft and writes no more until someone signs in', () => {
    writeDraft('quote', { title: 'Hughes driveway' })
    writeDraft('edit:invoice:inv1', { notes: 'Net 15' }, { notes: '' })
    clearDrafts({ keepOwned: false })
    expect(store.keys()).toEqual([])
    writeDraft('quote', { title: 'Typed after the sign out' })
    expect(store.keys()).toEqual([])
  })
})

describe('an edit draft', () => {
  it('comes back when the record still holds what the edit started from', () => {
    writeDraft('edit:quote-terms:q1', { scope: 'Pour 6 inch' }, { scope: '', terms: '' })
    expect(startEdit('edit:quote-terms:q1', { scope: '', terms: '' })).toEqual({ form: { scope: 'Pour 6 inch', terms: '' }, base: { scope: '', terms: '' } })
  })

  it('is dropped when the record was saved differently since', () => {
    writeDraft('edit:quote-terms:q1', { scope: 'Pour 6 inch' }, { scope: '' })
    expect(startEdit('edit:quote-terms:q1', { scope: 'Saved on another phone' })).toBeNull()
    expect(store.getItem('fh:draft:edit:quote-terms:q1')).toBeNull()
  })

  it('compares forms by value', () => {
    expect(sameDraft({ a: '1', b: [1, 2] }, { a: '1', b: [1, 2] })).toBe(true)
    expect(sameDraft({ a: '1' }, { a: '2' })).toBe(false)
  })
})
