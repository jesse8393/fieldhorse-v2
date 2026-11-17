import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeClient, newState, type FakeState } from './teamAccountFakeSupabase'

let state: FakeState
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeClient(state) }))

import role from '../../netlify/functions/org-member-role.js'
import del from '../../netlify/functions/delete-account.js'

const ORG = '0b0b0b0b-0000-4000-8000-000000000001'
const OWNER = 'user-owner'
const ADMIN = 'user-admin'
const CREW = 'user-crew'
const GONE = 'user-removed'

beforeEach(() => {
  state = newState({
    organizations: [{ id: ORG, name: 'Parker Concrete', created_by: OWNER }],
    org_members: [
      { id: 'm-owner', org_id: ORG, user_id: OWNER, role: 'owner', joined_at: '2026-01-01T00:00:00Z', revoked_at: null },
      { id: 'm-admin', org_id: ORG, user_id: ADMIN, role: 'admin', joined_at: '2026-02-01T00:00:00Z', revoked_at: null },
      { id: 'm-crew', org_id: ORG, user_id: CREW, role: 'crew', joined_at: '2026-03-01T00:00:00Z', revoked_at: null },
      { id: 'm-gone', org_id: ORG, user_id: GONE, role: 'admin', joined_at: '2026-03-01T00:00:00Z', revoked_at: '2026-06-01T00:00:00Z' },
    ],
  })
  state.users = {
    'tok-owner': { id: OWNER, email: 'jesse@example.test' },
    'tok-admin': { id: ADMIN, email: 'office@example.test' },
  }
  vi.stubEnv('SUPABASE_URL', 'https://db.example.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service')
  vi.stubEnv('SUPABASE_ANON_KEY', 'test-anon')
})
afterEach(() => { vi.unstubAllEnvs() })

const post = (path: string, token: string, body: unknown) => new Request(`https://app.example.test${path}`, {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
})
const setRole = (token: string, memberUserId: string, next: string) =>
  role(post('/api/org-member-role', token, { member_user_id: memberUserId, role: next, org_id: ORG }))
const roleOf = (userId: string) => state.tables.org_members.find((m) => m.user_id === userId)!.role

describe('handing over ownership', () => {
  it('an owner can make another active member an owner, and can then delete their own account', async () => {
    const blocked = await del(post('/api/delete-account', 'tok-owner', {}))
    expect(blocked.status).toBe(409)
    expect((await blocked.json()).error).toBe('transfer_ownership_required')

    const promote = await setRole('tok-owner', ADMIN, 'owner')
    expect(promote.status).toBe(200)
    expect(await promote.json()).toEqual({ ok: true, role: 'owner' })
    expect(roleOf(ADMIN)).toBe('owner')
    expect(roleOf(OWNER)).toBe('owner')

    const gone = await del(post('/api/delete-account', 'tok-owner', {}))
    expect(gone.status).toBe(200)
    expect(await gone.json()).toMatchObject({ ok: true, handed_off_orgs: 1, deleted_orgs: 0 })
    expect(state.deletedUsers).toEqual([OWNER])
    expect(state.tables.organizations[0].created_by).toBe(ADMIN)
  })

  it('an owner can promote a crew member straight to owner', async () => {
    expect((await setRole('tok-owner', CREW, 'owner')).status).toBe(200)
    expect(roleOf(CREW)).toBe('owner')
  })

  it('an admin still cannot create an owner or another admin', async () => {
    for (const next of ['owner', 'admin']) {
      const res = await setRole('tok-admin', CREW, next)
      expect(res.status).toBe(403)
      expect((await res.json()).error).toBe('role_exceeds_caller')
    }
    expect(roleOf(CREW)).toBe('crew')
  })

  it('an owner still cannot change another owner, and a removed member cannot be made owner', async () => {
    await setRole('tok-owner', ADMIN, 'owner')
    const demote = await setRole('tok-owner', ADMIN, 'admin')
    expect(demote.status).toBe(403)
    expect(roleOf(ADMIN)).toBe('owner')

    const removed = await setRole('tok-owner', GONE, 'owner')
    expect(removed.status).toBe(404)
    expect(roleOf(GONE)).toBe('admin')
  })
})
