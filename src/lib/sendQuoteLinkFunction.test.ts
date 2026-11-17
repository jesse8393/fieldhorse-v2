import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, newFakeDb, recordingFetch, type FakeDb, type Outbound } from './functionTestDb.ts'

// The quote PDF tells the customer to approve "through the secure link this
// estimate was delivered with", so the email must carry that link (PT-08).

let db: FakeDb
let outbound: Outbound[] = []
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeSupabase(db) }))

const ORG = '0b0b0b0b-0000-4000-8000-000000000001'
const OWNER = 'user-owner'
const ADMIN = 'user-admin'

beforeEach(() => {
  db = newFakeDb({
    org_members: [
      { id: 'm-owner', org_id: ORG, user_id: OWNER, role: 'owner', joined_at: '2026-01-01T00:00:00Z', revoked_at: null },
      { id: 'm-admin', org_id: ORG, user_id: ADMIN, role: 'admin', joined_at: '2026-02-01T00:00:00Z', revoked_at: null }
    ],
    profiles: [{ user_id: OWNER, org_id: ORG, company_name: 'Parker Concrete' }],
    fh_clients: [{ id: 'client-1', org_id: ORG, user_id: OWNER, name: 'Dana Smith' }],
    fh_contacts: [{ id: 'job-1', org_id: ORG, user_id: OWNER, name: 'Dana Smith', job_title: 'Smith driveway', stage: 'lead', proposal_status: 'draft' }],
    fh_quotes: [{ id: 'q1', org_id: ORG, user_id: OWNER, client_id: 'client-1', title: 'Driveway', status: 'draft' }],
    fh_public_links: [], fh_notes: []
  })
  db.users = { 'tok-owner': { id: OWNER, email: 'jesse@example.test' }, 'tok-admin': { id: ADMIN, email: 'admin@example.test' } }
  outbound = []
  vi.stubEnv('SUPABASE_URL', 'https://db.example.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service')
  vi.stubEnv('RESEND_API_KEY', 're_test')
  vi.stubEnv('SEND_EMAIL_FROM', 'notifications@mail.example.test')
  vi.stubGlobal('fetch', vi.fn(recordingFetch(outbound)))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

async function send(body: Record<string, unknown> = {}, token = 'tok-owner', sender = OWNER) {
  const handler = (await import('../../netlify/functions/send-quote.js')).default
  const res = await handler(new Request('https://preview--fieldhorse.example.test/api/send-quote', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ quote_id: 'q1', sender_user_id: sender, recipient_email: 'dana@example.test', storage_path: `${sender}/quotes/q1/a.pdf`, ...body })
  }))
  expect(res.status).toBe(200)
  return outbound.find((o) => o.host === 'api.resend.com')!.body
}

describe('the quote email carries the customer link', () => {
  it('mints a proposal link for the quote on the request origin and puts it in both parts', async () => {
    const mail = await send()
    expect(db.tables.fh_public_links).toHaveLength(1)
    const link = db.tables.fh_public_links[0]
    expect(link).toMatchObject({ quote_id: 'q1', contact_id: null, kind: 'proposal', org_id: ORG, user_id: OWNER })
    expect(link.token).toMatch(/^[A-Za-z2-9]{24}$/)
    const url = `https://preview--fieldhorse.example.test/p/${link.token}`
    expect(mail.text).toContain(`View and approve: ${url}`)
    expect(mail.html).toContain(`href="${url}"`)
    expect(mail.html).toContain('>View and approve</a>')
    expect(mail.html).toContain(`>${url}</p>`)
  })

  it('reuses the newest active link instead of minting another', async () => {
    db.tables.fh_public_links.push(
      { id: 'l-old', quote_id: 'q1', kind: 'proposal', token: 'oldtokenoldtokenoldtoken', revoked_at: null, expires_at: null, created_at: '2026-10-01T00:00:00Z' },
      { id: 'l-revoked', quote_id: 'q1', kind: 'proposal', token: 'revokedrevokedrevokedrev', revoked_at: '2026-11-01T00:00:00Z', expires_at: null, created_at: '2026-11-02T00:00:00Z' },
      { id: 'l-expired', quote_id: 'q1', kind: 'proposal', token: 'expiredexpiredexpiredexp', revoked_at: null, expires_at: '2026-01-01T00:00:00Z', created_at: '2026-11-03T00:00:00Z' }
    )
    const mail = await send()
    expect(db.tables.fh_public_links).toHaveLength(3)
    expect(mail.text).toContain('/p/oldtokenoldtokenoldtoken')
  })

  it('mints for a job proposal by the job, under the company, when a teammate sends', async () => {
    const mail = await send({ quote_id: undefined, contact_id: 'job-1' }, 'tok-admin', ADMIN)
    expect(db.tables.fh_public_links[0]).toMatchObject({ contact_id: 'job-1', quote_id: null, org_id: ORG, user_id: ADMIN, kind: 'proposal' })
    expect(mail.text).toContain(`/p/${db.tables.fh_public_links[0].token}`)
  })

  it('still sends the email, without a link, when no link can be made', async () => {
    db.failWrites.fh_public_links = 'permission denied'
    const mail = await send()
    expect(mail.text).not.toContain('/p/')
    expect(mail.html).not.toContain('View and approve')
  })
})
