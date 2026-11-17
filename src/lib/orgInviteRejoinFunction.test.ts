import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeClient, newState, type FakeState } from './teamAccountFakeSupabase'

let state: FakeState
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeClient(state) }))

import accept from '../../netlify/functions/org-invite-accept.js'

const ORG = '0b0b0b0b-0000-4000-8000-000000000001'
const OWNER = 'user-owner'
const CREW = 'user-crew'
const REMOVED_AT = '2026-10-01T00:00:00.000Z'
const inTwoWeeks = () => new Date(Date.now() + 14 * 86400000).toISOString()

beforeEach(() => {
  state = newState({
    org_members: [
      { id: 'm-owner', org_id: ORG, user_id: OWNER, role: 'owner', joined_at: '2026-01-01T00:00:00Z', revoked_at: null },
      { id: 'm-crew', org_id: ORG, user_id: CREW, role: 'crew', joined_at: '2026-03-01T00:00:00Z', revoked_at: REMOVED_AT, default_hourly_rate: 28 },
    ],
    org_invites: [],
    profiles: [],
  })
  state.users = { 'tok-crew': { id: CREW, email: 'dana@example.test', email_confirmed_at: '2026-01-01T00:00:00Z' } }
  vi.stubEnv('SUPABASE_URL', 'https://db.example.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service')
  vi.stubEnv('SUPABASE_ANON_KEY', 'test-anon')
})
afterEach(() => { vi.unstubAllEnvs() })

const post = (token: string) => new Request('https://app.example.test/api/org-invite-accept', {
  method: 'POST',
  headers: { authorization: 'Bearer tok-crew', 'content-type': 'application/json' },
  body: JSON.stringify({ token }),
})
const crewRow = () => state.tables.org_members.find((m) => m.user_id === CREW)!

describe('a removed teammate accepting an invite', () => {
  it('rejoins with the invite role when the invite was made after the removal', async () => {
    state.tables.org_invites.push({
      id: 'inv-new', org_id: ORG, email: 'dana@example.test', role: 'foreman', token: 'fresh-token',
      invited_by: OWNER, created_at: '2026-11-10T00:00:00.000Z', expires_at: inTwoWeeks(), accepted_at: null,
    })
    const res = await accept(post('fresh-token'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, org_id: ORG, role: 'foreman' })
    // The one membership row is reused: the table allows one per person per company.
    expect(state.tables.org_members.filter((m) => m.user_id === CREW)).toHaveLength(1)
    expect(crewRow()).toMatchObject({ id: 'm-crew', revoked_at: null, role: 'foreman', invited_by: OWNER })
    expect(state.tables.org_invites[0]).toMatchObject({ accepted_at: expect.any(String), accepted_by: CREW })
  })

  it('is still refused when the invite is older than the removal', async () => {
    state.tables.org_invites.push({
      id: 'inv-old', org_id: ORG, email: 'dana@example.test', role: 'crew', token: 'stale-token',
      invited_by: OWNER, created_at: '2026-09-25T00:00:00.000Z', expires_at: inTwoWeeks(), accepted_at: null,
    })
    const res = await accept(post('stale-token'))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('membership_revoked')
    expect(crewRow().revoked_at).toBe(REMOVED_AT)
    expect(state.tables.org_invites[0].accepted_at).toBeNull()
  })

  it('is refused when the invite carries no creation time to compare', async () => {
    state.tables.org_invites.push({
      id: 'inv-undated', org_id: ORG, email: 'dana@example.test', role: 'crew', token: 'undated-token',
      invited_by: OWNER, created_at: null, expires_at: inTwoWeeks(), accepted_at: null,
    })
    const res = await accept(post('undated-token'))
    expect(res.status).toBe(403)
    expect(crewRow().revoked_at).toBe(REMOVED_AT)
  })
})
