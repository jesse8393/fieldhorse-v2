import { afterEach, describe, expect, it, vi } from 'vitest'
import { CURRENT_ORG_KEY, pickActiveMembership, readStoredOrgId, writeStoredOrgId } from './activeOrg.ts'

const ownBusiness = { org_id: 'own', role: 'owner', joined_at: '2025-01-10T00:00:00Z' }
const gcCrew = { org_id: 'gc', role: 'crew', joined_at: '2026-03-01T00:00:00Z' }
const otherManager = { org_id: 'other', role: 'manager', joined_at: '2026-05-01T00:00:00Z' }

describe('pickActiveMembership', () => {
  it('returns null without memberships', () => {
    expect(pickActiveMembership([], 'own')).toBeNull()
  })

  it('keeps the stored choice while it is still an active membership', () => {
    expect(pickActiveMembership([ownBusiness, gcCrew], 'gc')).toBe(gcCrew)
  })

  it('ignores a stored choice the user no longer belongs to', () => {
    expect(pickActiveMembership([gcCrew, ownBusiness], 'removed-org')).toBe(ownBusiness)
  })

  it('prefers the business the user owns over a newer crew membership', () => {
    expect(pickActiveMembership([gcCrew, ownBusiness], null)).toBe(ownBusiness)
  })

  it('picks the newest owned business when there are several', () => {
    const olderOwn = { org_id: 'old', role: 'owner', joined_at: '2024-01-01T00:00:00Z' }
    expect(pickActiveMembership([olderOwn, gcCrew, ownBusiness], undefined)).toBe(ownBusiness)
  })

  it('falls back to the most recently joined membership whatever the input order', () => {
    expect(pickActiveMembership([gcCrew, otherManager], null)).toBe(otherManager)
    expect(pickActiveMembership([otherManager, gcCrew], null)).toBe(otherManager)
  })
})

describe('stored workspace choice', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('round trips through localStorage under fh:currentOrgId', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v) },
        removeItem: (k: string) => { store.delete(k) }
      }
    })
    writeStoredOrgId('gc')
    expect(store.get(CURRENT_ORG_KEY)).toBe('gc')
    expect(readStoredOrgId()).toBe('gc')
    writeStoredOrgId(null)
    expect(readStoredOrgId()).toBeNull()
  })

  it('never throws when storage is blocked', () => {
    const blocked = () => { throw new Error('SecurityError') }
    vi.stubGlobal('window', { localStorage: { getItem: blocked, setItem: blocked, removeItem: blocked } })
    expect(() => writeStoredOrgId('gc')).not.toThrow()
    expect(readStoredOrgId()).toBeNull()
  })

  it('reads nothing outside the browser', () => {
    expect(readStoredOrgId()).toBeNull()
  })
})
