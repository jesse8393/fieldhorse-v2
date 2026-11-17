import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type Row } from './publicLinkTestDb.ts'
import { invoiceAmountDue } from './invoices.ts'

// Hoisted with the mocks: invoices.ts (read for the app's own figure) makes
// its client when it loads.
const db = vi.hoisted(() => ({ fake: null as any, pushes: [] as Array<{ userId: string; payload: Record<string, any> }> }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => db.fake }))
vi.mock('../../netlify/functions/lib/push.js', () => ({
  sendPushToUser: async (_db: unknown, userId: string, payload: Record<string, any>) => { db.pushes.push({ userId, payload }) }
}))
const pushes = db.pushes
let currentFake: ReturnType<typeof fakeSupabase> | null = null
const useDb = (tables: Record<string, Row[]>) => { currentFake = fakeSupabase(tables); db.fake = currentFake; return currentFake }

const {
  default: linkHandler,
  buildPublicLinkViewEvent,
  getPublicLinkClientIp,
  hashPublicLinkIp
} = await import('../../netlify/functions/public-link.js')

beforeEach(() => {
  pushes.length = 0
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service')
})
afterEach(() => { vi.unstubAllEnvs(); currentFake = null; db.fake = null })

const getLink = async (token: string) => {
  const res = await linkHandler(new Request(`https://x.test/api/public-link?token=${token}`))
  return { status: res.status, body: await res.json() }
}

const ORG = 'org-1'
const OWNER = 'owner'

function baseTables(extra: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    fh_public_links: [],
    fh_contacts: [],
    fh_clients: [{ id: 'cl-1', org_id: ORG, user_id: OWNER, name: 'Dana Smith', email: 'dana@example.test', address: '1 Elm St', created_at: '2026-09-01T00:00:00.000Z' }],
    fh_quotes: [],
    fh_quote_items: [],
    fh_quote_versions: [],
    fh_payments: [],
    fh_change_orders: [],
    fh_invoices: [],
    fh_job_files: [],
    fh_insurance_claims: [],
    fh_notifications: [],
    fh_notes: [],
    profiles: [{ user_id: OWNER, company_name: 'Parker Concrete' }],
    org_members: [{ org_id: ORG, user_id: OWNER, role: 'owner', revoked_at: null, joined_at: '2026-01-01T00:00:00.000Z' }],
    ...extra
  }
}

const link = (over: Row): Row => ({
  id: `link-${over.token}`, kind: 'invoice', user_id: OWNER, org_id: ORG, contact_id: null, quote_id: null,
  client_id: null, change_order_id: null, revoked_at: null, expires_at: null,
  last_viewed_at: new Date().toISOString(), view_count: 0, ...over
})
const job = (over: Row = {}): Row => ({ id: 'job-1', org_id: ORG, user_id: OWNER, client_id: 'cl-1', name: 'Dana Smith', job_title: 'Garage slab', stage: 'job', amount: 10000, created_at: '2026-10-01T00:00:00.000Z', ...over })
const bill = (id: string, seq: number, amount: number, status: string, over: Row = {}): Row => ({
  id, org_id: ORG, user_id: OWNER, contact_id: 'job-1', client_id: 'cl-1', sequence_number: seq, title: `Draw ${seq}`,
  amount, status, issued_at: '2026-11-06T00:00:00.000Z', due_at: '2026-11-21', description: null, notes: null,
  created_at: `2026-11-0${seq}T00:00:00.000Z`, ...over
})

describe('the invoice link asks for what the invoice still owes (PT-01, PT-02, M-01, M-02)', () => {
  it('a client billed with no job: the open invoice owes all of itself, and only its own payments come back', async () => {
    useDb(baseTables({
      fh_public_links: [link({ token: 'inv-client', client_id: 'cl-1' })],
      fh_invoices: [bill('inv-1', 1, 500, 'paid', { contact_id: null }), bill('inv-2', 2, 1000, 'sent', { contact_id: null })],
      fh_payments: [{ id: 'p1', org_id: ORG, contact_id: null, invoice_id: 'inv-1', amount: 500, paid_on: '2026-10-07' }]
    }))
    const { status, body } = await getLink('inv-client')
    expect(status).toBe(200)
    const open = body.invoices.find((i: Row) => i.id === 'inv-2')
    expect(open.amount_due).toBe(1000)
    // The paid one owes nothing and is not asked about.
    expect(body.invoices.find((i: Row) => i.id === 'inv-1').amount_due).toBeUndefined()
    expect(body.contact.amount).toBe(1000)
  })

  it('a job: a part payment linked to the invoice comes off, matching the app and the PDF', async () => {
    const invoices = [bill('inv-1', 1, 5000, 'sent')]
    const payments = [{ id: 'p1', org_id: ORG, contact_id: 'job-1', invoice_id: 'inv-1', amount: 2000, paid_on: '2026-11-13' }]
    useDb(baseTables({
      fh_public_links: [link({ token: 'inv-job', contact_id: 'job-1' })],
      fh_contacts: [job()],
      fh_invoices: invoices,
      fh_payments: payments
    }))
    const { body } = await getLink('inv-job')
    expect(body.invoices[0].amount_due).toBe(3000)
    expect(body.invoices[0].amount_due).toBe(invoiceAmountDue({ invoice: invoices[0] as any, contact: job() as any, payments, invoices: invoices as any }))
  })

  it('a job: money logged against the job pays the unsent deposit draft first, as Money does, and the draft never leaves the server', async () => {
    useDb(baseTables({
      fh_public_links: [link({ token: 'inv-draft', contact_id: 'job-1' })],
      fh_contacts: [job()],
      fh_invoices: [bill('inv-1', 1, 2500, 'draft'), bill('inv-2', 2, 5000, 'sent')],
      fh_payments: [{ id: 'p1', org_id: ORG, contact_id: 'job-1', invoice_id: null, amount: 2500, paid_on: '2026-11-01' }]
    }))
    const { body } = await getLink('inv-draft')
    expect(body.invoices.map((i: Row) => i.id)).toEqual(['inv-2'])
    expect(body.invoices[0].amount_due).toBe(5000)
  })

  it('a job with no price: a sent invoice owes its amount', async () => {
    useDb(baseTables({
      fh_public_links: [link({ token: 'inv-noprice', contact_id: 'job-1' })],
      fh_contacts: [job({ amount: null })],
      fh_invoices: [bill('inv-1', 1, 500, 'sent')]
    }))
    const { body } = await getLink('inv-noprice')
    expect(body.invoices[0].amount_due).toBe(500)
  })
})

describe('public-link function audit helpers', () => {
  it('prefers the first forwarded client IP', () => {
    const req = new Request('https://fieldhorse.test/api/public-link?token=abc', {
      headers: {
        'x-forwarded-for': '203.0.113.10, 198.51.100.2',
        'x-real-ip': '198.51.100.3'
      }
    })

    expect(getPublicLinkClientIp(req)).toBe('203.0.113.10')
  })

  it('hashes IP addresses with a salt', () => {
    const hash = hashPublicLinkIp('203.0.113.10', 'test-salt')

    expect(hash).toHaveLength(64)
    expect(hash).toBe(hashPublicLinkIp('203.0.113.10', 'test-salt'))
    expect(hash).not.toBe(hashPublicLinkIp('203.0.113.10', 'other-salt'))
  })

  it('builds an RPC payload without raw IP addresses', () => {
    const req = new Request('https://fieldhorse.test/api/public-link?token=abc', {
      headers: {
        'user-agent': 'Mozilla/'.padEnd(700, 'x'),
        referer: 'https://client.example/proposal',
        'x-forwarded-for': '203.0.113.10',
        'x-nf-request-id': 'req_123'
      }
    })

    const event = buildPublicLinkViewEvent(
      req,
      {
        id: 'link-id',
        org_id: null,
        user_id: 'user-id',
        contact_id: 'contact-id',
        kind: 'proposal',
        change_order_id: null
      },
      { org_id: 'org-id' },
      'test-salt'
    )

    expect(event.p_public_link_id).toBe('link-id')
    expect(event.p_org_id).toBe('org-id')
    expect(event.p_user_agent).toHaveLength(500)
    expect(event.p_referer).toBe('https://client.example/proposal')
    expect(event.p_ip_hash).toHaveLength(64)
    expect(event.p_ip_hash).not.toContain('203.0.113.10')
    expect(event.p_metadata.request_id).toBe('req_123')
  })
})
