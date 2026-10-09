import { describe, expect, it, vi } from 'vitest'

// The hook itself needs React; these tests cover the pure decision and
// the per user memory, so the context module is stubbed out.
vi.mock('../contexts/MembershipContext.tsx', () => ({
  useMembership: () => ({ loading: false, error: null, orgId: null }),
}))

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, String(value)) },
  removeItem: (key: string) => { storage.delete(key) },
})

const { resolveOrgScope, isSettledMembership, lastKnownOrg, rememberOrg } = await import('./orgScope.ts')

describe('resolveOrgScope', () => {
  it('waits (undefined) while membership loads and nothing is remembered', () => {
    expect(resolveOrgScope({ loading: true, error: null, orgId: null }, undefined)).toBeUndefined()
  })

  it('reuses the last known org while membership loads', () => {
    expect(resolveOrgScope({ loading: true, error: null, orgId: null }, 'org-1')).toBe('org-1')
  })

  it('uses the resolved org, or the user scope when there is none', () => {
    expect(resolveOrgScope({ loading: false, error: null, orgId: 'org-2' }, 'org-1')).toBe('org-2')
    expect(resolveOrgScope({ loading: false, error: null, orgId: null }, 'org-1')).toBeNull()
  })

  it('keeps the last known org when the membership fetch fails (offline cold open)', () => {
    expect(resolveOrgScope({ loading: false, error: 'Failed to fetch', orgId: null }, 'org-1')).toBe('org-1')
    expect(resolveOrgScope({ loading: false, error: 'Failed to fetch', orgId: null }, undefined)).toBeNull()
    // The org row read failed but the membership itself resolved.
    expect(resolveOrgScope({ loading: false, error: 'org read failed', orgId: 'org-2' }, 'org-1')).toBe('org-2')
  })
})

describe('isSettledMembership', () => {
  it('only treats a real answer as worth remembering', () => {
    expect(isSettledMembership({ loading: true, error: null, orgId: 'org-1' })).toBe(false)
    expect(isSettledMembership({ loading: false, error: 'Failed to fetch', orgId: null })).toBe(false)
    expect(isSettledMembership({ loading: false, error: null, orgId: null })).toBe(true)
    expect(isSettledMembership({ loading: false, error: 'org read failed', orgId: 'org-1' })).toBe(true)
  })
})

describe('remembered org per user', () => {
  it('persists the org per user and forgets it when the user has none', () => {
    expect(lastKnownOrg('user-a')).toBeUndefined()
    rememberOrg('user-a', 'org-1')
    expect(lastKnownOrg('user-a')).toBe('org-1')
    expect(storage.get('fh:orgScope:user-a')).toBe('org-1')
    expect(lastKnownOrg('user-b')).toBeUndefined()

    rememberOrg('user-a', null)
    expect(lastKnownOrg('user-a')).toBeUndefined()
    expect(storage.has('fh:orgScope:user-a')).toBe(false)
  })

  it('reads a value stored by an earlier session', () => {
    storage.set('fh:orgScope:user-c', 'org-9')
    expect(lastKnownOrg('user-c')).toBe('org-9')
  })
})
