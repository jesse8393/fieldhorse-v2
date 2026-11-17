import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, newFakeDb, recordingFetch, type FakeDb, type Outbound } from './functionTestDb.ts'

// The platform mailbox must not work as a relay (FN-02). Free recipients
// stay allowed: contractors do email a spouse or a property manager. What
// bounds it is a per account daily cap across every sender, a tighter one
// for send-message to an address that is not on the job's customer, and
// the shared short window limiter on team invites too.

let db: FakeDb
let outbound: Outbound[] = []
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeSupabase(db) }))

const ORG = '0b0b0b0b-0000-4000-8000-000000000001'
const OWNER = 'user-owner'

beforeEach(() => {
  db = newFakeDb({
    organizations: [{ id: ORG, name: 'Parker Concrete' }],
    org_members: [{ id: 'm-owner', org_id: ORG, user_id: OWNER, role: 'owner', joined_at: '2026-01-01T00:00:00Z', revoked_at: null }],
    profiles: [{ user_id: OWNER, org_id: ORG, company_name: 'Parker Concrete' }],
    fh_clients: [{ id: 'client-1', org_id: ORG, user_id: OWNER, name: 'Dana Smith', company_name: null, email: 'Dana.Office@Example.test' }],
    fh_contacts: [{ id: 'job-1', org_id: ORG, user_id: OWNER, client_id: 'client-1', name: 'Dana Smith', job_title: 'Smith driveway', amount: 20000, email: 'dana@example.test', stage: 'job', proposal_status: 'approved' }],
    fh_quotes: [{ id: 'q1', org_id: ORG, user_id: OWNER, client_id: 'client-1', title: 'Driveway', status: 'draft' }],
    fh_invoices: [{ id: 'inv-2', org_id: ORG, user_id: OWNER, contact_id: 'job-1', client_id: 'client-1', title: 'Draw 2', description: null, amount: 5000, status: 'draft', due_at: null, issued_at: null, sequence_number: 2, updated_at: '2026-11-10T00:00:00Z' }],
    fh_change_orders: [], fh_notes: [], fh_closeouts: [], org_invites: []
  })
  db.users = { 'tok-owner': { id: OWNER, email: 'jesse@example.test' } }
  outbound = []
  vi.stubEnv('SUPABASE_URL', 'https://db.example.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service')
  vi.stubEnv('SUPABASE_ANON_KEY', 'test-anon')
  vi.stubEnv('RESEND_API_KEY', 're_test')
  vi.stubEnv('SEND_EMAIL_FROM', 'notifications@mail.example.test')
  vi.stubEnv('URL', 'https://app.example.test')
  vi.stubGlobal('fetch', vi.fn(recordingFetch(outbound)))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const post = (path: string, body: unknown) => new Request(`https://app.example.test${path}`, {
  method: 'POST', headers: { authorization: 'Bearer tok-owner', 'content-type': 'application/json' }, body: JSON.stringify(body)
})
const pdf = `${OWNER}/job-1/a.pdf`
const senders: Record<string, Record<string, unknown>> = {
  'send-quote': { quote_id: 'q1', sender_user_id: OWNER, recipient_email: 'dana@example.test', storage_path: pdf },
  'send-invoice': { contact_id: 'job-1', invoice_id: 'inv-2', invoice_updated_at: '2026-11-10T00:00:00Z', sender_user_id: OWNER, recipient_email: 'dana@example.test', storage_path: pdf, amount_due: 5000 },
  'send-statement': { client_id: 'client-1', sender_user_id: OWNER, recipient_email: 'dana@example.test', storage_path: pdf },
  'send-certificate': { contact_id: 'job-1', sender_user_id: OWNER, recipient_email: 'dana@example.test', storage_path: pdf },
  'send-message': { contact_id: 'job-1', sender_user_id: OWNER, recipient_email: 'dana@example.test', subject: 'Arrival', body: 'West gate' },
  'org-invite-create': { email: 'new@example.test', role: 'crew', org_id: ORG }
}
const handler = async (name: string) => (await import(`../../netlify/functions/${name}.js`)).default
const limits = (scope: string) => db.log.filter((l) => l.op === 'rpc' && l.payload?.p_scope === scope).map((l) => l.payload)
const deny = (scope: string) => { db.rpc.fh_increment_rate_limit = (args: any) => [{ request_count: 999, allowed: args.p_scope !== scope }] }

describe('the daily cap on every sender', () => {
  for (const [name, body] of Object.entries(senders)) {
    it(`${name} counts the send against the account's 300 a day`, async () => {
      expect((await (await handler(name))(post(`/api/${name}`, body))).status).toBe(200)
      expect(limits('send-email-day')).toEqual([expect.objectContaining({ p_limit: 300, p_window_seconds: 86400 })])
    })

    it(`${name} answers a plain 429 and sends nothing once the day is used`, async () => {
      deny('send-email-day')
      const res = await (await handler(name))(post(`/api/${name}`, body))
      expect(res.status).toBe(429)
      const answer = await res.json()
      expect(answer.error).toBe('rate_limited')
      expect(answer.message).toMatch(/today/)
      expect(outbound.filter((o) => o.host === 'api.resend.com')).toHaveLength(0)
    })
  }
})

describe('team invites', () => {
  it('use the shared short window limiter', async () => {
    await (await handler('org-invite-create'))(post('/api/org-invite-create', senders['org-invite-create']))
    expect(limits('send-email')).toEqual([expect.objectContaining({ p_limit: 30, p_window_seconds: 600 })])
  })

  it('stop with a plain 429 and create no invite when the limiter says so', async () => {
    deny('send-email')
    const res = await (await handler('org-invite-create'))(post('/api/org-invite-create', senders['org-invite-create']))
    expect(res.status).toBe(429)
    expect((await res.json()).message).toMatch(/Try again/)
    expect(db.tables.org_invites).toHaveLength(0)
    expect(outbound).toHaveLength(0)
  })
})

describe('send-message to an address that is not the customer', () => {
  const message = (to: string) => ({ ...senders['send-message'], recipient_email: to })

  it('does not count the job\'s own email or its client\'s email against the tighter cap', async () => {
    const send = await handler('send-message')
    expect((await send(post('/api/send-message', message('DANA@example.test')))).status).toBe(200)
    expect((await send(post('/api/send-message', message('dana.office@example.test')))).status).toBe(200)
    expect(limits('send-message-other-day')).toHaveLength(0)
  })

  it('still mails a spouse or property manager, counted against 30 a day', async () => {
    const send = await handler('send-message')
    expect((await send(post('/api/send-message', message('manager@property.example.test')))).status).toBe(200)
    expect(limits('send-message-other-day')).toEqual([expect.objectContaining({ p_limit: 30, p_window_seconds: 86400 })])
    expect(outbound[0].body.to).toEqual(['manager@property.example.test'])
  })

  it('answers a plain 429 once those 30 are used, and still mails the customer', async () => {
    deny('send-message-other-day')
    const send = await handler('send-message')
    const res = await send(post('/api/send-message', message('stranger@victim.example.test')))
    expect(res.status).toBe(429)
    expect((await res.json()).message).toMatch(/not on this customer/)
    expect(outbound).toHaveLength(0)
    expect((await send(post('/api/send-message', message('dana@example.test')))).status).toBe(200)
  })
})
