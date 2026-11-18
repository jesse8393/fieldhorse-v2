import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, newFakeDb, recordingFetch, type FakeDb, type Outbound } from './functionTestDb.ts'
import { moneyCents as appMoneyCents } from './format.ts'
import { moneyCents } from '../../netlify/functions/lib/money.js'

// Money the server writes into emails reads the way the app and the PDF
// print it: always dollars and cents (formats-6).

let db: FakeDb
let outbound: Outbound[] = []
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeSupabase(db) }))

const ORG = '0b0b0b0b-0000-4000-8000-000000000001'
const OWNER = 'user-owner'

beforeEach(() => {
  db = newFakeDb({
    organizations: [{ id: ORG, name: 'Parker Concrete' }],
    org_members: [{ id: 'm-owner', org_id: ORG, user_id: OWNER, role: 'owner', joined_at: '2026-01-01T00:00:00Z', revoked_at: null }],
    profiles: [{ user_id: OWNER, org_id: ORG, company_name: 'Parker Concrete', company_email: 'office@parker.example.test' }],
    fh_clients: [{ id: 'client-1', org_id: ORG, user_id: OWNER, name: 'Dana Smith', company_name: null, email: 'dana@example.test' }],
    fh_contacts: [], fh_invoices: [], fh_change_orders: [], fh_notes: []
  })
  db.users = { 'tok-owner': { id: OWNER, email: 'jesse@example.test' } }
  outbound = []
  vi.stubEnv('SUPABASE_URL', 'https://db.example.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service')
  vi.stubEnv('RESEND_API_KEY', 're_test')
  vi.stubEnv('SEND_EMAIL_FROM', 'notifications@mail.example.test')
  vi.stubGlobal('fetch', vi.fn(recordingFetch(outbound)))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('server money', () => {
  it('always prints dollars and cents, like the app', () => {
    expect(moneyCents(6400)).toBe('$6,400.00')
    expect(moneyCents(2949.75)).toBe('$2,949.75')
    expect(moneyCents(1000.5)).toBe('$1,000.50')
    expect(moneyCents(-1200)).toBe('-$1,200.00')
    expect(moneyCents('abc')).toBe('$0.00')
    for (const n of [0, 6400, 6400.5, 1234.567, -1200, '12345.5', null]) expect(moneyCents(n)).toBe(appMoneyCents(n))
  })

  it('the statement email names the total with cents', async () => {
    const send = (await import('../../netlify/functions/send-statement.js')).default
    const res = await send(new Request('https://app.example.test/api/send-statement', {
      method: 'POST', headers: { authorization: 'Bearer tok-owner', 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: 'client-1', sender_user_id: OWNER, recipient_email: 'dana@example.test', storage_path: `${OWNER}/client-1/s.pdf`, total_due: 5000 })
    }))
    expect(res.status).toBe(200)
    const mail = outbound.find((o) => o.host === 'api.resend.com')!.body
    expect(`${mail.subject} ${mail.text}`).toContain('$5,000.00')
    expect(`${mail.subject} ${mail.text}`).not.toMatch(/\$5,000(?!\.00)/)
  })
})
