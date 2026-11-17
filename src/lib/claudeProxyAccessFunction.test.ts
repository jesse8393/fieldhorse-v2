import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, newFakeDb, recordingFetch, type FakeDb, type Outbound } from './functionTestDb.ts'

// The AI proxy spends the shared Anthropic key. Only people in a company
// may use it, each call is sized to what the app itself asks for, and each
// company has a daily number of calls (FN-03).

let db: FakeDb
let outbound: Outbound[] = []
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeSupabase(db) }))

const ORG = '0b0b0b0b-0000-4000-8000-000000000001'

beforeEach(() => {
  db = newFakeDb({
    org_members: [
      { id: 'm-owner', org_id: ORG, user_id: 'user-owner', role: 'owner', joined_at: '2026-01-01T00:00:00Z', revoked_at: null },
      { id: 'm-crew', org_id: ORG, user_id: 'user-crew', role: 'crew', joined_at: '2026-02-01T00:00:00Z', revoked_at: null },
      { id: 'm-ex', org_id: ORG, user_id: 'user-ex', role: 'crew', joined_at: '2026-02-01T00:00:00Z', revoked_at: '2026-11-01T00:00:00Z' }
    ]
  })
  db.users = {
    'tok-owner': { id: 'user-owner' },
    'tok-crew': { id: 'user-crew' },
    'tok-ex': { id: 'user-ex' },
    'tok-newbie': { id: 'user-newbie' }
  }
  outbound = []
  vi.stubEnv('SUPABASE_URL', 'https://db.example.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service')
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
  vi.stubEnv('ANTHROPIC_MODEL', '')
  vi.stubGlobal('fetch', vi.fn(recordingFetch(outbound)))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

async function ask(token: string, body: Record<string, unknown> = {}) {
  const claude = (await import('../../netlify/functions/claude.js')).default
  return claude(new Request('https://app.example.test/api/claude', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Draft a follow up.' }], ...body })
  }))
}
const sent = () => outbound.find((o) => o.host === 'api.anthropic.com')?.body

describe('who may use the AI proxy', () => {
  it('refuses an account with no company, before any provider call', async () => {
    const res = await ask('tok-newbie')
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('no_membership')
    expect(outbound).toHaveLength(0)
  })

  it('refuses a removed teammate', async () => {
    expect((await ask('tok-ex')).status).toBe(403)
    expect(outbound).toHaveLength(0)
  })

  it('lets any active member through, crew included', async () => {
    expect((await ask('tok-crew')).status).toBe(200)
    expect((await ask('tok-owner')).status).toBe(200)
  })
})

describe('what one call may cost', () => {
  it('caps max_tokens at the largest the app asks for and pins effort low', async () => {
    await ask('tok-owner', { max_tokens: 100000, effort: 'high', model: 'claude-fable-5' })
    expect(sent().max_tokens).toBe(1500)
    expect(sent().output_config).toEqual({ effort: 'low' })
  })

  it('keeps the model ids and what the app sends today', async () => {
    await ask('tok-owner', { max_tokens: 1400, effort: 'low' })
    expect(sent().model).toBe('claude-fable-5')
    expect(sent().max_tokens).toBe(1400)
  })
})

describe('the company daily budget', () => {
  it('counts every call against the company, by day', async () => {
    await ask('tok-crew')
    const budget = db.log.filter((l) => l.op === 'rpc' && l.payload?.p_scope === 'claude-company-day')
    expect(budget).toHaveLength(1)
    expect(budget[0].payload).toMatchObject({ p_window_seconds: 86400, p_limit: 500 })
    expect(budget[0].payload.p_identifier).not.toContain(ORG)
  })

  it('answers a plain 429 once the company has used the day', async () => {
    db.rpc.fh_increment_rate_limit = (args: any) => [{ request_count: 501, allowed: args.p_scope !== 'claude-company-day' }]
    const res = await ask('tok-owner')
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toBe('rate_limited')
    expect(body.message).toMatch(/today/)
    expect(outbound).toHaveLength(0)
  })
})
