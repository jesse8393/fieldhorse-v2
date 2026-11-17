import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeClient, newState, type FakeState } from './teamAccountFakeSupabase'

// AUTO-11. A member removed from the company kept getting lock screen pushes
// with customer names: sendPushToUser sent to any user id with no membership
// check, and removing a member left their push subscriptions in place.

const webpush = vi.hoisted(() => ({ setVapidDetails: vi.fn(), sendNotification: vi.fn(async () => ({})) }))
vi.mock('web-push', () => ({ default: webpush }))

let state: FakeState
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeClient(state) }))

import { sendPushToUser } from '../../netlify/functions/lib/push.js'
import removeMember from '../../netlify/functions/org-member-remove.js'
import acceptPartner from '../../netlify/functions/partner-invite-accept.js'

const ORG = '0c0c0c0c-0000-4000-8000-000000000001'
const OTHER_ORG = '0c0c0c0c-0000-4000-8000-000000000002'
const OWNER = 'user-owner'
const CREW = 'user-crew'
const GONE = 'user-removed'

const sub = (id: string, userId: string) => ({ id, user_id: userId, endpoint: `https://push.example.test/${id}`, p256dh: 'p', auth: 'a' })
const sentTo = () => webpush.sendNotification.mock.calls.map((c: any[]) => c[0].endpoint)

beforeEach(() => {
  webpush.sendNotification.mockClear()
  state = newState({
    fh_app_config: [{ key: 'vapid_public_key', value: 'test-public' }, { key: 'vapid_private_key', value: 'test-private' }],
    org_members: [
      { id: 'm-owner', org_id: ORG, user_id: OWNER, role: 'owner', joined_at: '2026-01-01T00:00:00Z', revoked_at: null },
      { id: 'm-crew', org_id: ORG, user_id: CREW, role: 'crew', joined_at: '2026-02-01T00:00:00Z', revoked_at: null },
      { id: 'm-gone', org_id: ORG, user_id: GONE, role: 'manager', joined_at: '2026-02-01T00:00:00Z', revoked_at: '2026-06-01T00:00:00Z' },
    ],
    fh_push_subscriptions: [sub('owner-phone', OWNER), sub('crew-phone', CREW), sub('gone-phone', GONE)],
  })
  vi.stubEnv('SUPABASE_URL', 'https://db.example.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service')
  vi.stubEnv('SUPABASE_ANON_KEY', 'test-anon')
})
afterEach(() => { vi.unstubAllEnvs() })

const payload = { title: 'Quote approved', body: 'Pat Lee · $10,000', link: '/quotes/q1' }

describe('sendPushToUser checks the recipient is still in the company', () => {
  it('sends to an active member of the company', async () => {
    await sendPushToUser(fakeClient(state), CREW, payload, { orgId: ORG })
    expect(sentTo()).toEqual(['https://push.example.test/crew-phone'])
  })

  it('sends nothing to a member who was removed', async () => {
    await sendPushToUser(fakeClient(state), GONE, payload, { orgId: ORG })
    expect(sentTo()).toEqual([])
  })

  it('sends nothing to someone who was never in the company', async () => {
    await sendPushToUser(fakeClient(state), CREW, payload, { orgId: OTHER_ORG })
    expect(sentTo()).toEqual([])
  })

  it('with no company named, sends only to someone still in a company', async () => {
    await sendPushToUser(fakeClient(state), GONE, payload)
    expect(sentTo()).toEqual([])
    await sendPushToUser(fakeClient(state), OWNER, payload)
    expect(sentTo()).toEqual(['https://push.example.test/owner-phone'])
  })

  it('sends nothing when the membership lookup fails', async () => {
    state.failReads = { org_members: 'connection reset' }
    await sendPushToUser(fakeClient(state), CREW, payload, { orgId: ORG })
    expect(sentTo()).toEqual([])
  })
})

const post = (path: string, token: string, body: unknown) => new Request(`https://app.example.test${path}`, {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
})

describe('removing a member', () => {
  beforeEach(() => {
    state.users = { 'tok-owner': { id: OWNER, email: 'jesse@example.test' } }
  })

  it('deletes their push subscriptions when they are in no other company', async () => {
    const res = await removeMember(post('/api/org-member-remove', 'tok-owner', { member_user_id: CREW, org_id: ORG }))
    expect(res.status).toBe(200)
    expect(state.tables.fh_push_subscriptions.map((s) => s.id).sort()).toEqual(['gone-phone', 'owner-phone'])
  })

  it('keeps them when the person is still in another company', async () => {
    state.tables.org_members.push({ id: 'm-crew-2', org_id: OTHER_ORG, user_id: CREW, role: 'owner', joined_at: '2026-03-01T00:00:00Z', revoked_at: null })
    const res = await removeMember(post('/api/org-member-remove', 'tok-owner', { member_user_id: CREW, org_id: ORG }))
    expect(res.status).toBe(200)
    expect(state.tables.fh_push_subscriptions.map((s) => s.id)).toContain('crew-phone')
  })
})

describe('a partner accepting an invite', () => {
  it('does not push to an inviter who has left the company', async () => {
    state.users = { 'tok-partner': { id: 'user-partner', email: 'sub@example.test', email_confirmed_at: '2026-01-01T00:00:00Z' } }
    state.tables.fh_job_partners = [{ id: 'jp-1', job_id: 'job-1', org_id: ORG, partner_email: 'sub@example.test', status: 'pending', invited_by_user_id: GONE, invite_token: 'inv-1' }]
    const res = await acceptPartner(post('/api/partner-invite-accept', 'tok-partner', { token: 'inv-1' }))
    expect(res.status).toBe(200)
    expect(sentTo()).toEqual([])
  })
})
