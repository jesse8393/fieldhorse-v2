import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, newFakeDb, recordingFetch, type FakeDb, type Outbound } from './functionTestDb.ts'

// Plain sentence case wording in the emails (FN-29, PT-20, PT-21).

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
    fh_clients: [{ id: 'client-1', org_id: ORG, user_id: OWNER, name: 'Dana Smith' }],
    fh_contacts: [{ id: 'job-1', org_id: ORG, user_id: OWNER, client_id: 'client-1', name: "Dana O'Brien", job_title: 'Back patio slab', amount: 20000, email: 'dana@example.test', stage: 'job', proposal_status: 'approved' }],
    fh_quotes: [{ id: 'q1', org_id: ORG, user_id: OWNER, client_id: 'client-1', title: 'Driveway', status: 'draft' }],
    fh_invoices: [{ id: 'inv-2', org_id: ORG, user_id: OWNER, contact_id: 'job-1', client_id: 'client-1', title: 'Draw 2', description: null, amount: 5000, status: 'draft', due_at: null, issued_at: null, sequence_number: 2, updated_at: '2026-11-10T00:00:00Z' }],
    fh_job_partners: [], fh_change_orders: [], fh_notes: [], fh_closeouts: [], fh_public_links: [], org_invites: []
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

async function mailFrom(name: string, body: Record<string, unknown>) {
  const handler = (await import(`../../netlify/functions/${name}.js`)).default
  const res = await handler(new Request(`https://app.example.test/api/${name}`, {
    method: 'POST', headers: { authorization: 'Bearer tok-owner', 'content-type': 'application/json' }, body: JSON.stringify(body)
  }))
  expect(res.status).toBe(200)
  return outbound.find((o) => o.host === 'api.resend.com')!.body
}

const pdf = `${OWNER}/job-1/a.pdf`
const all: Record<string, Record<string, unknown>> = {
  'send-quote': { quote_id: 'q1', sender_user_id: OWNER, recipient_email: 'dana@example.test', storage_path: pdf },
  'send-invoice': { contact_id: 'job-1', invoice_id: 'inv-2', invoice_updated_at: '2026-11-10T00:00:00Z', sender_user_id: OWNER, recipient_email: 'dana@example.test', storage_path: pdf, amount_due: 5000 },
  'send-certificate': { contact_id: 'job-1', sender_user_id: OWNER, recipient_email: 'dana@example.test', storage_path: pdf },
  'send-message': { contact_id: 'job-1', sender_user_id: OWNER, recipient_email: 'dana@example.test', body: 'West gate' },
  'org-invite-create': { email: 'new@example.test', role: 'admin', org_id: ORG },
  'partner-invite': { job_id: 'job-1', partner_email: 'sam@example.test', invited_by_user_id: OWNER, send_email: true, partner_name: 'Sam' }
}

describe('labels in sentence case', () => {
  for (const [name, body] of Object.entries(all)) {
    it(`${name} sets no label in capitals`, async () => {
      expect((await mailFrom(name, body)).html).not.toMatch(/text-transform:\s*uppercase/)
    })
  }
})

describe('team invite wording', () => {
  it('uses the right article and the company in the From header', async () => {
    const mail = await mailFrom('org-invite-create', all['org-invite-create'])
    expect(mail.text).toContain('as an admin.')
    expect(mail.html).toContain('as an <strong>admin</strong>')
    expect(mail.text).not.toContain('as a admin')
    expect(mail.from).toBe('"Parker Concrete" <notifications@mail.example.test>')
    expect(mail.reply_to).toBe('jesse@example.test')
  })
})

describe('partner invite wording', () => {
  it('names the job by its title, not the customer, and says Accept invite', async () => {
    const mail = await mailFrom('partner-invite', all['partner-invite'])
    expect(mail.subject).toBe("Sam, you're invited to co-manage Back patio slab")
    expect(mail.text).toContain('on Back patio slab.')
    expect(JSON.stringify(mail)).not.toContain("Dana O'Brien")
    expect(mail.html).toContain('>Accept invite</a>')
  })
})

// ai-copy-8: the certificate email names the document in sentence case.
describe('certificate email wording', () => {
  it('says Certificate of completion in the subject and the message', async () => {
    const mail = await mailFrom('send-certificate', all['send-certificate'])
    expect(mail.subject).toBe('Certificate of completion for Back patio slab')
    expect(mail.text).toContain('Attached is the certificate of completion for Back patio slab.')
    expect(JSON.stringify(mail)).not.toContain('Certificate of Completion')
  })
})
