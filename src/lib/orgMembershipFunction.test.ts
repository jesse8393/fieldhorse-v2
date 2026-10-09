import { describe, expect, it, vi } from 'vitest'
import {
  parseOrgId,
  pickDefaultMembership,
  resolveCallerMembership,
} from '../../netlify/functions/lib/membership.js'

const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '22222222-2222-4222-8222-222222222222'

describe('org_id in the request body', () => {
  it('reads a uuid and treats absent or empty as no choice', () => {
    expect(parseOrgId({ org_id: ORG_A })).toEqual({ orgId: ORG_A, invalid: false })
    expect(parseOrgId({ org_id: ` ${ORG_A.toUpperCase()} ` })).toEqual({ orgId: ORG_A, invalid: false })
    expect(parseOrgId({})).toEqual({ orgId: null, invalid: false })
    expect(parseOrgId({ org_id: '' })).toEqual({ orgId: null, invalid: false })
    expect(parseOrgId({ org_id: null })).toEqual({ orgId: null, invalid: false })
    expect(parseOrgId(null)).toEqual({ orgId: null, invalid: false })
  })

  it('flags anything that is not a uuid string', () => {
    expect(parseOrgId({ org_id: 'not-a-uuid' }).invalid).toBe(true)
    expect(parseOrgId({ org_id: 42 }).invalid).toBe(true)
    expect(parseOrgId({ org_id: { id: ORG_A } }).invalid).toBe(true)
  })
})

describe('default membership when no org is named', () => {
  it('prefers an owner membership over a newer one', () => {
    const rows = [
      { org_id: ORG_B, role: 'foreman', joined_at: '2026-09-01T00:00:00Z' },
      { org_id: ORG_A, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
    ]
    expect(pickDefaultMembership(rows)?.org_id).toBe(ORG_A)
  })

  it('falls back to the newest membership', () => {
    const rows = [
      { org_id: ORG_A, role: 'crew', joined_at: '2025-01-01T00:00:00Z' },
      { org_id: ORG_B, role: 'manager', joined_at: '2026-09-01T00:00:00Z' },
    ]
    expect(pickDefaultMembership(rows)?.org_id).toBe(ORG_B)
    expect(pickDefaultMembership([])).toBeNull()
    expect(pickDefaultMembership(null)).toBeNull()
  })
})

// Minimal thenable stand in for the supabase-js query builder.
function fakeAdmin(rows: any[], error: any = null) {
  const calls: Array<[string, ...any[]]> = []
  const from = (table: string) => {
    const filters: Array<(r: any) => boolean> = []
    const builder: any = {
      select: (...args: any[]) => { calls.push(['select', ...args]); return builder },
      eq: (col: string, v: any) => { calls.push(['eq', col, v]); filters.push((r) => r[col] === v); return builder },
      is: (col: string, v: any) => { calls.push(['is', col, v]); filters.push((r) => (r[col] ?? null) === v); return builder },
      order: (...args: any[]) => { calls.push(['order', ...args]); return builder },
      limit: (...args: any[]) => { calls.push(['limit', ...args]); return builder },
      then: (resolve: any, reject: any) => {
        const data = error ? null : rows.filter((r) => filters.every((f) => f(r)))
          .sort((a, b) => (a.joined_at < b.joined_at ? 1 : -1))
        return Promise.resolve({ data, error }).then(resolve, reject)
      },
    }
    calls.push(['from', table])
    return builder
  }
  return { client: { from } as any, calls }
}

describe('resolveCallerMembership', () => {
  const rows = [
    { user_id: 'u1', org_id: ORG_A, role: 'owner', joined_at: '2025-01-01T00:00:00Z', revoked_at: null },
    { user_id: 'u1', org_id: ORG_B, role: 'foreman', joined_at: '2026-09-01T00:00:00Z', revoked_at: null },
    { user_id: 'u2', org_id: ORG_B, role: 'admin', joined_at: '2026-01-01T00:00:00Z', revoked_at: '2026-05-01T00:00:00Z' },
  ]

  it('acts on the org the client names', async () => {
    const { client, calls } = fakeAdmin(rows)
    const res = await resolveCallerMembership(client, 'u1', { org_id: ORG_B })
    expect(res.membership?.org_id).toBe(ORG_B)
    expect(res.membership?.role).toBe('foreman')
    expect(calls).toContainEqual(['eq', 'org_id', ORG_B])
  })

  it('refuses an org the caller is not an active member of', async () => {
    const { client } = fakeAdmin(rows)
    const revoked = await resolveCallerMembership(client, 'u2', { org_id: ORG_B })
    const stranger = await resolveCallerMembership(client, 'u3', { org_id: ORG_A })
    expect(revoked.status).toBe(403)
    expect(revoked.error).toBe('no_membership')
    expect(stranger.status).toBe(403)
  })

  it('without org_id picks the owner membership, not the newest', async () => {
    const { client } = fakeAdmin(rows)
    const res = await resolveCallerMembership(client, 'u1', {})
    expect(res.membership?.org_id).toBe(ORG_A)
    expect(res.membership?.role).toBe('owner')
  })

  it('rejects a malformed org_id before querying', async () => {
    const { client, calls } = fakeAdmin(rows)
    const res = await resolveCallerMembership(client, 'u1', { org_id: 'abc' })
    expect(res.status).toBe(400)
    expect(res.error).toBe('invalid_org_id')
    expect(calls).toHaveLength(0)
  })

  it('logs a database error and returns a plain message', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = fakeAdmin(rows, { code: '42703', message: 'column org_members.secret does not exist' })
    const res = await resolveCallerMembership(client, 'u1', { org_id: ORG_A })
    expect(res.status).toBe(500)
    expect(res.error).toBe('membership_lookup_failed')
    expect(res.message).not.toMatch(/column|org_members/)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})
