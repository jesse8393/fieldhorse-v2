import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, newFakeDb, recordingFetch, type FakeDb, type Outbound } from './functionTestDb.ts'

// What the invoice email says the invoice is for. The owner's rule: the
// email carries the invoice's Description, wherever it was sent from.

let db: FakeDb
let outbound: Outbound[] = []
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeSupabase(db) }))

const ORG = '0b0b0b0b-0000-4000-8000-000000000001'
const OWNER = 'user-owner'
const LONG = 'Second draw for the driveway.\nCovers forming, rebar and the slab pour on the north side.\nBalance of the demolition allowance is credited once the old slab is hauled away.'

function seed(invoice: Record<string, unknown> = {}) {
  db = newFakeDb({
    org_members: [{ id: 'm-owner', org_id: ORG, user_id: OWNER, role: 'owner', joined_at: '2026-01-01T00:00:00Z', revoked_at: null }],
    profiles: [{ user_id: OWNER, org_id: ORG, company_name: 'Parker Concrete', company_email: 'office@parker.example.test' }],
    fh_contacts: [{ id: 'job-1', org_id: ORG, user_id: OWNER, name: 'Dana Smith', job_title: 'Smith driveway', amount: 20000 }],
    fh_invoices: [{ id: 'inv-2', org_id: ORG, user_id: OWNER, contact_id: 'job-1', client_id: 'client-1', title: 'Draw 2', description: 'Draw 2, slab pour', amount: 5000, status: 'sent', due_at: null, issued_at: '2026-11-09T00:00:00Z', sequence_number: 2, updated_at: '2026-11-10T00:00:00Z', ...invoice }],
    fh_change_orders: [], fh_notes: []
  })
  db.users = { 'tok-owner': { id: OWNER, email: 'jesse@example.test' } }
}

beforeEach(() => {
  seed()
  outbound = []
  vi.stubEnv('SUPABASE_URL', 'https://db.example.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service')
  vi.stubEnv('RESEND_API_KEY', 're_test')
  vi.stubEnv('SEND_EMAIL_FROM', 'notifications@mail.example.test')
  vi.stubGlobal('fetch', vi.fn(recordingFetch(outbound)))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

// The body the job's money tab and draws section post: no description.
async function send(extra: Record<string, unknown> = {}) {
  const handler = (await import('../../netlify/functions/send-invoice.js')).default
  const res = await handler(new Request('https://app.example.test/api/send-invoice', {
    method: 'POST', headers: { authorization: 'Bearer tok-owner', 'content-type': 'application/json' },
    body: JSON.stringify({
      contact_id: 'job-1', invoice_id: 'inv-2', invoice_updated_at: '2026-11-10T00:00:00Z', sender_user_id: OWNER,
      recipient_email: 'dana@example.test', recipient_name: 'Dana Smith', storage_path: `${OWNER}/job-1/x.pdf`, filename: 'invoice.pdf', amount_due: 5000, ...extra
    })
  }))
  expect(res.status).toBe(200)
  return outbound.find((o) => o.host === 'api.resend.com')!.body
}

describe('the invoice email carries the invoice Description', () => {
  it('prints the stored Description when the request sends none (job money tab)', async () => {
    const mail = await send()
    expect(mail.text).toContain('Draw 2, slab pour')
    expect(mail.html).toContain('Draw 2, slab pour')
  })

  it('prefers the stored Description over what the request says', async () => {
    const mail = await send({ description: 'Something the browser made up' })
    expect(mail.text).toContain('Draw 2, slab pour')
    expect(JSON.stringify(mail)).not.toContain('Something the browser made up')
  })

  it('falls back to the request when the invoice has no Description', async () => {
    seed({ description: null })
    const mail = await send({ description: 'Deposit for the shed slab' })
    expect(mail.text).toContain('Deposit for the shed slab')
  })
})

describe('the invoice email subject and body', () => {
  it('builds the subject from the invoice title and amount, never the Description', async () => {
    seed({ description: LONG, amount: 7383.4 })
    const mail = await send({ amount_due: 7383.4 })
    expect(mail.subject).toBe('Invoice: Draw 2 ($7,383.40)')
    expect(mail.subject).not.toMatch(/[\r\n]/)
  })

  it('names the invoice by its number when it has no title, then by the job', async () => {
    seed({ title: null })
    expect((await send()).subject).toBe('Invoice 2 for Smith driveway ($5,000.00)')
    seed({ title: '  ', sequence_number: null })
    outbound.length = 0
    expect((await send()).subject).toBe('Invoice for Smith driveway ($5,000.00)')
  })

  it('prints the whole Description as its own paragraph, line breaks kept and markup escaped', async () => {
    seed({ description: `${LONG}\n<b>5 > 3</b>` })
    const mail = await send()
    expect(mail.text).toContain('Your invoice for Smith driveway is attached. Amount due: $5,000.00.')
    expect(mail.text).toContain(`\n\n${LONG}\n<b>5 > 3</b>\n\n`)
    expect(mail.html).toContain('once the old slab is hauled away.<br>&lt;b&gt;5 &gt; 3&lt;/b&gt;</p>')
    expect(mail.html).toContain('Second draw for the driveway.<br>Covers forming')
    expect(mail.html).not.toContain('<b>5')
  })

  it('does not repeat a Description that only restates the title or the job', async () => {
    seed({ description: null })
    const mail = await send({ description: 'Smith driveway' })
    expect(mail.text.match(/Smith driveway/g)).toHaveLength(1)
  })
})
