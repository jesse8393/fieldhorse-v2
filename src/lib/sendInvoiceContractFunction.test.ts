import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, newFakeDb, recordingFetch, type FakeDb, type Outbound } from './functionTestDb.ts'

// The contract the invoice email checks a draft against before it goes
// out (M-14). It is the same rule the invoice page and the PDF use
// (knownContractTotal): a job saved with no price has no known contract,
// whatever its change orders, so an approved $500 change order is not a
// $500 cap on $2,000 of invoices.

let db: FakeDb
let outbound: Outbound[] = []
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeSupabase(db) }))

const ORG = '0b0b0b0b-0000-4000-8000-000000000001'
const OWNER = 'user-owner'

function seed({ jobAmount, draftAmount }: { jobAmount: number | null; draftAmount: number }) {
  const base = { org_id: ORG, user_id: OWNER, contact_id: 'job-1', client_id: 'client-1', description: null, due_at: null }
  db = newFakeDb({
    org_members: [{ id: 'm-owner', org_id: ORG, user_id: OWNER, role: 'owner', joined_at: '2026-01-01T00:00:00Z', revoked_at: null }],
    profiles: [{ user_id: OWNER, org_id: ORG, company_name: 'Parker Concrete', company_email: 'office@parker.example.test' }],
    fh_contacts: [{ id: 'job-1', org_id: ORG, user_id: OWNER, name: 'Dana Smith', job_title: 'Smith shed slab', amount: jobAmount }],
    fh_invoices: [
      { ...base, id: 'inv-1', title: 'Draw 1', amount: 1000, status: 'sent', sequence_number: 1, issued_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' },
      { ...base, id: 'inv-2', title: 'Draw 2', amount: draftAmount, status: 'draft', sequence_number: 2, issued_at: null, updated_at: '2026-11-10T00:00:00Z' }
    ],
    fh_change_orders: [
      { id: 'co-1', org_id: ORG, user_id: OWNER, contact_id: 'job-1', amount: 500, status: 'approved' },
      { id: 'co-2', org_id: ORG, user_id: OWNER, contact_id: 'job-1', amount: 900, status: 'sent' }
    ],
    fh_notes: []
  })
  db.users = { 'tok-owner': { id: OWNER, email: 'jesse@example.test' } }
}

beforeEach(() => {
  outbound = []
  vi.stubEnv('SUPABASE_URL', 'https://db.example.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service')
  vi.stubEnv('RESEND_API_KEY', 're_test')
  vi.stubEnv('SEND_EMAIL_FROM', 'notifications@mail.example.test')
  vi.stubGlobal('fetch', vi.fn(recordingFetch(outbound)))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

async function sendDraw2(amountDue: number) {
  const handler = (await import('../../netlify/functions/send-invoice.js')).default
  return handler(new Request('https://app.example.test/api/send-invoice', {
    method: 'POST', headers: { authorization: 'Bearer tok-owner', 'content-type': 'application/json' },
    body: JSON.stringify({
      contact_id: 'job-1', invoice_id: 'inv-2', invoice_updated_at: '2026-11-10T00:00:00Z', sender_user_id: OWNER,
      recipient_email: 'dana@example.test', recipient_name: 'Dana Smith', storage_path: `${OWNER}/job-1/x.pdf`, filename: 'invoice.pdf', amount_due: amountDue
    })
  }))
}

describe('the contract the invoice email checks a draft against', () => {
  it('a job with no price and an approved change order sends its second $1,000.00 draw', async () => {
    seed({ jobAmount: 0, draftAmount: 1000 })
    const res = await sendDraw2(1000)
    expect(await res.json()).toMatchObject({ ok: true })
    expect(res.status).toBe(200)
    expect(outbound.filter((o) => o.host === 'api.resend.com')).toHaveLength(1)
  })

  it('a job saved with a null price is treated the same way', async () => {
    seed({ jobAmount: null, draftAmount: 1000 })
    const res = await sendDraw2(1000)
    expect(res.status).toBe(200)
  })

  it('a job with a price still counts its approved change orders, and only those, in the cap', async () => {
    // $1,000.00 job plus a $500.00 approved change order is $1,500.00.
    seed({ jobAmount: 1000, draftAmount: 500 })
    expect((await sendDraw2(500)).status).toBe(200)

    outbound = []
    seed({ jobAmount: 1000, draftAmount: 500.01 })
    const over = await sendDraw2(500.01)
    expect(over.status).toBe(409)
    expect((await over.json()).error).toBe('contract_billing_exceeded')
    expect(outbound.filter((o) => o.host === 'api.resend.com')).toHaveLength(0)
  })
})
