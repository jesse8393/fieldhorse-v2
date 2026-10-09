import { describe, expect, it, vi } from 'vitest'
import { canActOnRow, loadAccessibleRow, brandingUserIdFor, SENDER_ROLES } from '../../netlify/functions/lib/orgAccess.js'

const ORG = 'org-1'

describe('send access rule', () => {
  it('lets the row creator act without a membership lookup', () => {
    expect(canActOnRow({ user_id: 'u1', org_id: ORG }, 'u1', null)).toBe(true)
  })

  it('lets owners, admins and managers of the row org act', () => {
    for (const role of ['owner', 'admin', 'manager']) {
      expect(canActOnRow({ user_id: 'creator', org_id: ORG }, 'teammate', { role })).toBe(true)
    }
  })

  it('refuses crew, foreman, outsiders and rows without an org', () => {
    expect(canActOnRow({ user_id: 'creator', org_id: ORG }, 'teammate', { role: 'crew' })).toBe(false)
    expect(canActOnRow({ user_id: 'creator', org_id: ORG }, 'teammate', { role: 'foreman' })).toBe(false)
    expect(canActOnRow({ user_id: 'creator', org_id: ORG }, 'stranger', null)).toBe(false)
    expect(canActOnRow({ user_id: 'creator', org_id: null }, 'teammate', { role: 'owner' })).toBe(false)
    expect(canActOnRow(null, 'teammate', { role: 'owner' })).toBe(false)
  })

  it('exposes the same sender roles the app treats as financial', () => {
    expect(SENDER_ROLES).toEqual(['owner', 'admin', 'manager'])
  })
})

// Minimal chainable stand in for the supabase-js query builder.
function fakeClient(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      const filters: Array<(r: any) => boolean> = []
      let ordered: { col: string; asc: boolean } | null = null
      const api: any = {
        select: () => api,
        eq: (col: string, v: any) => { filters.push((r) => r[col] === v); return api },
        is: (col: string, v: any) => { filters.push((r) => (r[col] ?? null) === v); return api },
        order: (col: string, o: any) => { ordered = { col, asc: o?.ascending !== false }; return api },
        limit: () => api,
        maybeSingle: async () => {
          let rows = (tables[table] || []).filter((r) => filters.every((f) => f(r)))
          if (ordered) {
            const { col, asc } = ordered
            rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : 1) * (asc ? 1 : -1))
          }
          return { data: rows[0] || null, error: null }
        }
      }
      return api
    }
  } as any
}

describe('loadAccessibleRow', () => {
  const tables = {
    fh_contacts: [{ id: 'job-1', user_id: 'creator', org_id: ORG, name: 'Kitchen' }],
    org_members: [
      { org_id: ORG, user_id: 'admin-1', role: 'admin', revoked_at: null, joined_at: '2025-02-01' },
      { org_id: ORG, user_id: 'crew-1', role: 'crew', revoked_at: null, joined_at: '2025-03-01' },
      { org_id: ORG, user_id: 'gone-1', role: 'manager', revoked_at: '2026-01-01', joined_at: '2025-01-01' },
      { org_id: ORG, user_id: 'owner-1', role: 'owner', revoked_at: null, joined_at: '2024-01-01' }
    ]
  }

  it('returns the row for an admin teammate', async () => {
    const res = await loadAccessibleRow(fakeClient(tables), { table: 'fh_contacts', id: 'job-1', callerId: 'admin-1', select: 'name' })
    expect(res.row?.name).toBe('Kitchen')
  })

  it('refuses crew and revoked members', async () => {
    const crew = await loadAccessibleRow(fakeClient(tables), { table: 'fh_contacts', id: 'job-1', callerId: 'crew-1', select: 'name' })
    const gone = await loadAccessibleRow(fakeClient(tables), { table: 'fh_contacts', id: 'job-1', callerId: 'gone-1', select: 'name' })
    expect(crew.error).toBe('forbidden_or_not_found')
    expect(gone.error).toBe('forbidden_or_not_found')
  })

  it('refuses a missing row', async () => {
    const res = await loadAccessibleRow(fakeClient(tables), { table: 'fh_contacts', id: 'nope', callerId: 'creator', select: 'name' })
    expect(res.error).toBe('forbidden_or_not_found')
  })

  it('brands documents with the earliest active owner', async () => {
    expect(await brandingUserIdFor(fakeClient(tables), tables.fh_contacts[0])).toBe('owner-1')
    expect(await brandingUserIdFor(fakeClient(tables), { user_id: 'solo', org_id: null })).toBe('solo')
  })
})
