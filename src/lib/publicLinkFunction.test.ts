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
const seedDb = (tables: Record<string, Row[]>) => { currentFake = fakeSupabase(tables); db.fake = currentFake; return currentFake }

const { default: approveHandler } = await import('../../netlify/functions/public-link-approve.js')
const { default: coApproveHandler } = await import('../../netlify/functions/public-co-approve.js')
const { default: docusignHandler } = await import('../../netlify/functions/docusign-webhook.js')
const {
  default: linkHandler,
  buildPublicLinkViewEvent,
  getPublicLinkClientIp,
  hashPublicLinkIp,
  viewedLabelFor
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

const post = async (handler: (req: Request) => Promise<Response>, body: Row) => {
  const res = await handler(new Request('https://x.test/api/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
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
    seedDb(baseTables({
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
    seedDb(baseTables({
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
    seedDb(baseTables({
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
    seedDb(baseTables({
      fh_public_links: [link({ token: 'inv-noprice', contact_id: 'job-1' })],
      fh_contacts: [job({ amount: null })],
      fh_invoices: [bill('inv-1', 1, 500, 'sent')]
    }))
    const { body } = await getLink('inv-noprice')
    expect(body.invoices[0].amount_due).toBe(500)
  })
})

describe('the statement link (FN-20, M-13, PT-06)', () => {
  const stmt = (extra: Record<string, Row[]> = {}) => baseTables({
    fh_public_links: [link({ token: 'stmt', kind: 'statement', client_id: 'cl-1' })],
    fh_contacts: [
      job({ id: 'j-drive', job_title: 'Driveway', amount: 12800 }),
      job({ id: 'j-garage', job_title: 'Garage slab', amount: 33100 }),
      job({ id: 'old-lead', job_title: 'Pool deck idea', stage: 'moved_lead', amount: 48000 }),
      job({ id: 'old-quote', job_title: 'Patio, never sent', stage: 'moved_quote', amount: 31500 }),
      job({ id: 'lost', job_title: 'Retaining wall', stage: 'lost', amount: 15000 })
    ],
    fh_invoices: [
      bill('i-1', 1, 6400, 'paid', { contact_id: 'j-drive' }),
      bill('i-2', 2, 6400, 'sent', { contact_id: 'j-drive' }),
      bill('i-x', 3, 999, 'draft', { contact_id: 'j-drive' }),
      bill('d-1', 1, 800, 'paid', { contact_id: null }),
      bill('d-2', 2, 500.25, 'overdue', { contact_id: null, title: 'Sealing' }),
      bill('lost-1', 1, 15000, 'sent', { contact_id: 'lost' })
    ],
    fh_payments: [
      { id: 'p1', org_id: ORG, contact_id: 'j-drive', invoice_id: 'i-1', amount: 6400 },
      { id: 'p2', org_id: ORG, contact_id: null, invoice_id: 'd-1', amount: 800 },
      { id: 'p3', org_id: ORG, contact_id: null, invoice_id: 'd-2', amount: 100 },
      { id: 'p4', org_id: ORG, contact_id: 'old-quote', invoice_id: null, amount: 31500 }
    ],
    ...extra
  })

  it('returns only billing stage jobs, never moved or lost rows and their amounts', async () => {
    seedDb(stmt())
    const { body } = await getLink('stmt')
    expect(body.jobs.map((j: Row) => j.id)).toEqual(['j-drive', 'j-garage'])
    expect(JSON.stringify(body)).not.toContain('48000')
    expect(JSON.stringify(body)).not.toContain('31500')
    expect(body.payments.map((p: Row) => p.id).sort()).toEqual(['p1', 'p2', 'p3'])
  })

  it('carries the issued invoices, direct ones included, each open one with what it still owes, and no drafts', async () => {
    seedDb(stmt())
    const { body } = await getLink('stmt')
    const rows = Object.fromEntries(body.invoices.map((i: Row) => [i.id, i.amount_due ?? null]))
    expect(rows).toEqual({ 'i-1': null, 'i-2': 6400, 'd-1': null, 'd-2': 400.25 })
  })
})

describe('a change order is approved only as the customer saw it (FN-04, M-07)', () => {
  const coTables = (co: Row = {}) => baseTables({
    fh_public_links: [link({ token: 'co', kind: 'change_order', contact_id: 'job-1', change_order_id: 'co-1' })],
    fh_contacts: [job({ amount: 20000 })],
    fh_change_orders: [{ id: 'co-1', org_id: ORG, user_id: OWNER, contact_id: 'job-1', sequence_number: 1, title: 'Extra footing', amount: 1200, status: 'sent', updated_at: '2026-11-10T15:00:00.000Z', ...co }]
  })
  const shown = { token: 'co', signature_name: 'Dana Smith', expected_amount: 1200, expected_updated_at: '2026-11-10T15:00:00.000Z' }

  it('the link carries what the page must post back', async () => {
    seedDb(coTables())
    const { body } = await getLink('co')
    expect(body.changeOrders[0]).toMatchObject({ amount: 1200, updated_at: '2026-11-10T15:00:00.000Z' })
  })

  it('approves the amount the customer saw', async () => {
    const db = seedDb(coTables())
    const res = await post(coApproveHandler, shown)
    expect(res.status).toBe(200)
    expect(db.tables.fh_change_orders[0]).toMatchObject({ status: 'approved', approved_by_name: 'Dana Smith', amount: 1200 })
  })

  it('refuses with 409 and a plain message when the amount changed after the page opened', async () => {
    const db = seedDb(coTables({ amount: 2100, updated_at: '2026-11-10T16:00:00.000Z' }))
    const res = await post(coApproveHandler, shown)
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('document_changed')
    expect(res.body.message).toMatch(/changed since you opened it/)
    expect(db.tables.fh_change_orders[0].status).toBe('sent')
    expect(db.tables.fh_notifications).toHaveLength(0)
  })

  it('refuses when the row was edited even with the same amount, and when the page posts nothing to compare', async () => {
    seedDb(coTables({ updated_at: '2026-11-10T16:00:00.000Z' }))
    expect((await post(coApproveHandler, shown)).status).toBe(409)
    const db = seedDb(coTables())
    expect((await post(coApproveHandler, { token: 'co', signature_name: 'Dana Smith' })).status).toBe(409)
    expect(db.tables.fh_change_orders[0].status).toBe('sent')
  })

  it('takes approval only while the change order is sent', async () => {
    for (const status of ['draft', 'rejected', 'void']) {
      const db = seedDb(coTables({ status }))
      const res = await post(coApproveHandler, shown)
      expect(res.status).toBeGreaterThanOrEqual(409)
      expect(db.tables.fh_change_orders[0].status).toBe(status)
    }
  })
})

describe('a proposal is approved only as the customer saw it (FN-18)', () => {
  const quoteTables = (quote: Row = {}, items?: Row[]) => baseTables({
    fh_public_links: [link({ token: 'q', kind: 'proposal', quote_id: 'quote-1' })],
    fh_quotes: [{ id: 'quote-1', org_id: ORG, user_id: OWNER, client_id: 'cl-1', title: 'Driveway', status: 'sent', amount: 10000, expires_at: null, job_id: null, created_at: '2026-10-20T00:00:00.000Z', sent_at: '2026-10-20T00:00:00.000Z', updated_at: '2026-10-20T00:00:00.000Z', ...quote }],
    fh_quote_items: items ?? [
      { id: 'it-1', quote_id: 'quote-1', contact_id: null, description: 'Slab', qty: 1, rate: 9999.5, amount: 9999.5, sort_order: 0 },
      { id: 'it-2', quote_id: 'quote-1', contact_id: null, description: 'Sealer', qty: 1, rate: 400, amount: 400, is_optional: true, sort_order: 1 }
    ]
  })
  const shown = { token: 'q', signature_name: 'Dana Smith', expected_total: 9999.5, expected_updated_at: '2026-10-20T00:00:00.000Z' }

  it('the link carries the version the page must post back', async () => {
    seedDb(quoteTables())
    const { body } = await getLink('q')
    expect(body.updated_at).toBe('2026-10-20T00:00:00.000Z')
  })

  it('approves the total the customer saw', async () => {
    const db = seedDb(quoteTables())
    expect((await post(approveHandler, shown)).status).toBe(200)
    expect(db.tables.fh_quote_versions[0].base_total).toBe(9999.5)
  })

  it('refuses with 409 when the lines changed after the page opened, and records nothing', async () => {
    const db = seedDb(quoteTables({}, [{ id: 'it-1', quote_id: 'quote-1', contact_id: null, description: 'Slab', qty: 1, rate: 14000, amount: 14000, sort_order: 0 }]))
    const res = await post(approveHandler, shown)
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('document_changed')
    expect(db.tables.fh_quote_versions).toHaveLength(0)
    expect(db.tables.fh_quotes[0].status).toBe('sent')
  })

  it('refuses when the quote was edited, or the page posts no total', async () => {
    seedDb(quoteTables({ updated_at: '2026-10-21T00:00:00.000Z' }))
    expect((await post(approveHandler, shown)).status).toBe(409)
    seedDb(quoteTables())
    expect((await post(approveHandler, { token: 'q', signature_name: 'Dana Smith' })).status).toBe(409)
  })

  it('a draft that was never sent, and a rejected quote, are not approvable', async () => {
    for (const status of ['draft', 'rejected']) {
      const db = seedDb(quoteTables({ status }))
      const res = await post(approveHandler, shown)
      expect(res.status).toBe(409)
      expect(res.body.error).toBe('not_approvable')
      expect(db.tables.fh_quotes[0].status).toBe(status)
    }
  })

  it('on a job proposal, a rejected or draft proposal is not approvable and a changed total is refused', async () => {
    const jobTables = (over: Row) => baseTables({
      fh_public_links: [link({ token: 'jp', kind: 'proposal', contact_id: 'job-1' })],
      fh_contacts: [job({ stage: 'quote', proposal_status: 'sent', email: 'dana@example.test', ...over })],
      fh_quote_items: [{ id: 'ji', quote_id: null, contact_id: 'job-1', description: 'Patio', qty: 1, rate: 20000, amount: 20000, sort_order: 0 }]
    })
    for (const proposal_status of ['draft', 'rejected']) {
      const db = seedDb(jobTables({ proposal_status }))
      expect((await post(approveHandler, { token: 'jp', signature_name: 'Dana', expected_total: 20000 })).status).toBe(409)
      expect(db.tables.fh_contacts[0].proposal_status).toBe(proposal_status)
    }
    seedDb(jobTables({}))
    expect((await post(approveHandler, { token: 'jp', signature_name: 'Dana', expected_total: 19000 })).status).toBe(409)
    const db = seedDb(jobTables({}))
    expect((await post(approveHandler, { token: 'jp', signature_name: 'Dana', expected_total: 20000 })).status).toBe(200)
    expect(db.tables.fh_contacts[0].proposal_status).toBe('approved')
  })
})

describe('a quote past its valid until date (M-21)', () => {
  const quoteTables = (expires_at: string) => baseTables({
    fh_public_links: [link({ token: 'q', kind: 'proposal', quote_id: 'quote-1' })],
    fh_quotes: [{ id: 'quote-1', org_id: ORG, user_id: OWNER, client_id: 'cl-1', title: 'Driveway', status: 'sent', amount: 100, expires_at, job_id: null, created_at: '2026-10-20T00:00:00.000Z', updated_at: 'u1' }],
    fh_quote_items: [{ id: 'it-1', quote_id: 'quote-1', contact_id: null, description: 'Slab', qty: 1, rate: 100, amount: 100, sort_order: 0 }]
  })
  const body = { token: 'q', signature_name: 'Dana', expected_total: 100, expected_updated_at: 'u1' }

  it('a quote stored as the end of a day that has passed is expired, with no extra day', async () => {
    seedDb(quoteTables(new Date(Date.now() - 60 * 60 * 1000).toISOString()))
    const res = await post(approveHandler, body)
    expect(res.status).toBe(410)
    expect(res.body.error).toBe('quote_expired')
  })

  it('a bare date is good through that whole day', async () => {
    const today = new Date().toISOString().slice(0, 10)
    seedDb(quoteTables(today))
    expect((await post(approveHandler, body)).status).toBe(200)
  })
})

describe('who hears about a customer on a link (FN-05, FN-06)', () => {
  const EX = 'user-ex-manager'
  const MANAGER = 'user-manager'
  const members = [
    { org_id: ORG, user_id: OWNER, role: 'owner', revoked_at: null, joined_at: '2026-01-01T00:00:00.000Z' },
    { org_id: ORG, user_id: MANAGER, role: 'manager', revoked_at: null, joined_at: '2026-02-01T00:00:00.000Z' },
    { org_id: ORG, user_id: EX, role: 'manager', revoked_at: '2026-11-01T00:00:00.000Z', joined_at: '2026-02-01T00:00:00.000Z' },
    { org_id: 'org-other', user_id: 'user-elsewhere', role: 'owner', revoked_at: null, joined_at: '2026-01-01T00:00:00.000Z' }
  ]
  const quoteDb = (creator: string) => baseTables({
    org_members: members,
    fh_public_links: [link({ token: 'q', kind: 'proposal', quote_id: 'quote-1', user_id: creator, last_viewed_at: null })],
    fh_quotes: [{ id: 'quote-1', org_id: ORG, user_id: creator, client_id: 'cl-1', title: 'Driveway', status: 'sent', amount: 100, expires_at: null, job_id: null, created_at: '2026-10-20T00:00:00.000Z', updated_at: 'u1' }],
    fh_quote_items: [{ id: 'it-1', quote_id: 'quote-1', contact_id: null, description: 'Slab', qty: 1, rate: 100, amount: 100, sort_order: 0 }]
  })
  const bell = (db: { tables: Record<string, Row[]> }, kind: string) => db.tables.fh_notifications
    .filter((n) => n.kind === kind).map((n) => `${n.user_id}:${n.org_id}`).sort()

  it('a removed teammate hears nothing; the company owners do', async () => {
    const db = seedDb(quoteDb(EX))
    await getLink('q')
    await post(approveHandler, { token: 'q', signature_name: 'Dana', expected_total: 100, expected_updated_at: 'u1' })
    expect(bell(db, 'public_link_viewed')).toEqual([`${OWNER}:${ORG}`])
    expect(bell(db, 'quote_approved')).toEqual([`${OWNER}:${ORG}`])
    expect(pushes.map((p) => p.userId)).toEqual([OWNER, OWNER])
  })

  it('the teammate who made the link hears while they are in the company, and so do the owners', async () => {
    const db = seedDb(quoteDb(MANAGER))
    await getLink('q')
    expect(bell(db, 'public_link_viewed')).toEqual([`${MANAGER}:${ORG}`, `${OWNER}:${ORG}`].sort())
    expect(pushes.map((p) => p.userId).sort()).toEqual([MANAGER, OWNER].sort())
  })

  it('a change order signature and a job proposal approval write rows the company can read', async () => {
    let db = seedDb(baseTables({
      fh_public_links: [link({ token: 'co', kind: 'change_order', contact_id: 'job-1', change_order_id: 'co-1' })],
      fh_contacts: [job()],
      fh_change_orders: [{ id: 'co-1', org_id: ORG, user_id: OWNER, contact_id: 'job-1', sequence_number: 1, title: 'Footing', amount: 1200, status: 'sent', updated_at: 'u1' }]
    }))
    expect((await post(coApproveHandler, { token: 'co', signature_name: 'Dana', expected_amount: 1200, expected_updated_at: 'u1' })).status).toBe(200)
    expect(bell(db, 'change_order_signed')).toEqual([`${OWNER}:${ORG}`])
    // dead-ends-6: the bell row and the push open the job's Change orders.
    expect(db.tables.fh_notifications.filter((n) => n.kind === 'change_order_signed').map((n) => n.link)).toEqual(['/jobs/job-1?tab=change_orders'])
    expect(pushes.map((p) => p.payload.link)).toEqual(['/jobs/job-1?tab=change_orders'])
    expect(viewedLabelFor({ kind: 'change_order', contact_id: 'job-1' })).toEqual({ kindLabel: 'change order', detailLink: '/jobs/job-1?tab=change_orders' })

    db = seedDb(baseTables({
      fh_public_links: [link({ token: 'jp', kind: 'proposal', contact_id: 'job-1' })],
      fh_contacts: [job({ stage: 'quote', proposal_status: 'sent' })],
      fh_quote_items: [{ id: 'ji', quote_id: null, contact_id: 'job-1', description: 'Patio', qty: 1, rate: 20000, amount: 20000, sort_order: 0 }]
    }))
    expect((await post(approveHandler, { token: 'jp', signature_name: 'Dana', expected_total: 20000 })).status).toBe(200)
    expect(bell(db, 'quote_approved')).toEqual([`${OWNER}:${ORG}`])
  })

  // ai-copy-7: a lock screen push reads like the bell row beside it, with
  // no emoji tacked on.
  it('sends push titles with no emoji', async () => {
    seedDb(quoteDb(OWNER))
    await getLink('q')
    await post(approveHandler, { token: 'q', signature_name: 'Dana', expected_total: 100, expected_updated_at: 'u1' })
    seedDb(baseTables({
      fh_public_links: [link({ token: 'co', kind: 'change_order', contact_id: 'job-1', change_order_id: 'co-1' })],
      fh_contacts: [job()],
      fh_change_orders: [{ id: 'co-1', org_id: ORG, user_id: OWNER, contact_id: 'job-1', sequence_number: 1, title: 'Footing', amount: 1200, status: 'sent', updated_at: 'u1' }]
    }))
    await post(coApproveHandler, { token: 'co', signature_name: 'Dana', expected_amount: 1200, expected_updated_at: 'u1' })
    const titles = pushes.map((p) => String(p.payload.title))
    expect(titles).toEqual(['Customer is viewing your proposal', 'Quote approved · $100.00', 'Change order signed · +$1,200.00'])
  })

  it('no server function writes an emoji into a message', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = join(process.cwd(), 'netlify', 'functions')
    const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.js'))
    expect(files).toContain('public-link.js')
    const hits = files.filter((f) => /\p{Extended_Pictographic}/u.test(readFileSync(join(dir, f), 'utf8')))
    expect(hits).toEqual([])
  })

  it('a DocuSign signature writes a readable bell row and sends a push', async () => {
    const { createHmac } = await import('node:crypto')
    vi.stubEnv('DOCUSIGN_CONNECT_HMAC_KEY', 'test-hmac')
    const db = seedDb({
      ...quoteDb(MANAGER),
      fh_esign_envelopes: [{ id: 'env-row', envelope_id: 'ENV-1', user_id: MANAGER, org_id: ORG, contact_id: null, quote_id: 'quote-1', recipient_name: 'Dana Smith', recipient_email: 'dana@example.test', status: 'sent', sent_at: '2026-11-10T00:00:00Z' }]
    })
    const raw = JSON.stringify({ event: 'envelope-completed', data: { envelopeId: 'ENV-1', envelopeSummary: { status: 'completed' } } })
    const sig = createHmac('sha256', 'test-hmac').update(raw, 'utf8').digest('base64')
    const res = await docusignHandler(new Request('https://x.test/api/docusign-webhook', { method: 'POST', headers: { 'x-docusign-signature-1': sig }, body: raw }))
    expect(res.status).toBe(200)
    expect(bell(db, 'quote_approved')).toEqual([`${MANAGER}:${ORG}`, `${OWNER}:${ORG}`].sort())
    expect(pushes.map((p) => p.userId).sort()).toEqual([MANAGER, OWNER].sort())
    expect(pushes[0].payload.title).toBe('Proposal signed')
  })
})

describe('photos on a customer link are signed only from the link job folder (FN-21)', () => {
  const photo = (id: string, storage_path: string) => ({ id, org_id: ORG, job_id: 'job-1', kind: 'photo', storage_path, caption: null, section_tag: null, uploaded_at: `2026-11-0${id.slice(-1)}` })

  it('signs a path under the job, and nothing pointing elsewhere or written to escape it', async () => {
    const db = seedDb(baseTables({
      fh_public_links: [link({ token: 'p', kind: 'proposal', contact_id: 'job-1' })],
      fh_contacts: [job({ stage: 'quote' })],
      fh_job_files: [
        photo('f1', `${OWNER}/job-1/site.jpg`),
        photo('f2', 'victim-owner/job-9/their-site.jpg'),
        photo('f3', `${OWNER}/job-1/../../victim-owner/job-9/x.jpg`),
        photo('f4', `${OWNER}/job-1/%2e%2e/x.jpg`),
        photo('f5', `${OWNER}/./job-1/x.jpg`),
        photo('f6', `${OWNER}//job-1/x.jpg`)
      ]
    }))
    const { body } = await getLink('p')
    expect(db.signed).toEqual([`${OWNER}/job-1/site.jpg`])
    expect(body.photos.map((p: Row) => p.url)).toEqual([`https://signed.example.test/${OWNER}/job-1/site.jpg`])
  })
})

describe('an approved quote shows what the customer approved (M-03, link half)', () => {
  it('serves the approved version snapshot and its total, not lines edited afterwards', async () => {
    seedDb(baseTables({
      fh_public_links: [link({ token: 'q', kind: 'proposal', quote_id: 'quote-1' })],
      fh_quotes: [{ id: 'quote-1', org_id: ORG, user_id: OWNER, client_id: 'cl-1', title: 'Driveway', status: 'approved', amount: 13500, scope_text: 'Edited scope', terms_text: 'Edited terms', approved_version_id: 'v-1', job_id: null, created_at: '2026-10-20T00:00:00.000Z' }],
      // Edited after approval.
      fh_quote_items: [
        { id: 'it-1', quote_id: 'quote-1', contact_id: null, description: 'Slab', qty: 1, rate: 12500, amount: 12500, sort_order: 0 },
        { id: 'it-2', quote_id: 'quote-1', contact_id: null, description: 'Pump', qty: 1, rate: 1000, amount: 1000, sort_order: 1 }
      ],
      fh_quote_versions: [{
        id: 'v-1', quote_id: 'quote-1', contact_id: null, version_number: 1, status: 'approved', base_total: 3000,
        approved_by_name: 'Dana Smith', approved_at: '2026-10-25T00:00:00.000Z',
        snapshot: {
          scope_text: 'Approved scope', terms_text: 'Approved terms', exclusions_text: null,
          items: [{ section: null, description: 'Slab', qty: 1, unit: null, rate: 3000, amount: 3000, notes: null, is_optional: false, is_excluded: false, sort_order: 0 }],
          totals: { base: 3000, optional: 0, excluded_count: 0 }
        }
      }]
    }))
    const { body } = await getLink('q')
    expect(body.items.map((i: Row) => [i.description, i.amount])).toEqual([['Slab', 3000]])
    expect(body.contact).toMatchObject({ amount: 3000, scope_text: 'Approved scope', terms_text: 'Approved terms', approved_by_name: 'Dana Smith' })
  })
})

describe('a refused or failed read says so (PT-15)', () => {
  it('a revoked or expired link names the contractor and their phone, and nothing else', async () => {
    for (const over of [{ revoked_at: '2026-11-01T00:00:00.000Z' }, { expires_at: '2026-01-01T00:00:00.000Z' }]) {
      seedDb(baseTables({
        profiles: [{ user_id: OWNER, company_name: 'Parker Concrete', company_phone: '615 555 0100', company_email: 'office@parker.example', logo_url: 'https://img.example/logo.png', payment_link: 'https://pay.example' }],
        fh_public_links: [link({ token: 'gone', kind: 'proposal', contact_id: 'job-1', ...over })],
        fh_contacts: [job()]
      }))
      const { status, body } = await getLink('gone')
      expect(status).toBe(404)
      expect(body.company).toEqual({ name: 'Parker Concrete', phone: '615 555 0100' })
      expect(JSON.stringify(body)).not.toContain('Dana')
      expect(JSON.stringify(body)).not.toContain('pay.example')
    }
  })

  it('an unknown token says nothing about any company', async () => {
    seedDb(baseTables())
    const { status, body } = await getLink('nope')
    expect(status).toBe(404)
    expect(body.company).toBeUndefined()
  })

  it('a database error is a failed read the page can retry, not a gone link', async () => {
    const db = seedDb(baseTables())
    const from = db.from
    ;(db as any).from = (table: string) => {
      if (table !== 'fh_public_links') return from(table)
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: { message: 'connection reset' } }) }
      return q
    }
    const { status, body } = await getLink('any')
    expect(status).toBe(503)
    expect(body.error).toBe('read_failed')
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

// formats-8: the alert the owner gets when a customer signs names the
// amount the customer signed, to the cent, not rounded to the dollar.
describe('approval alerts name the exact amount', () => {
  it('a quote approval alert prints dollars and cents', async () => {
    const db = seedDb(baseTables({
      fh_public_links: [link({ token: 'q', kind: 'proposal', quote_id: 'quote-1' })],
      fh_quotes: [{ id: 'quote-1', org_id: ORG, user_id: OWNER, client_id: 'cl-1', title: 'Driveway', status: 'sent', amount: 2949.75, expires_at: null, job_id: null, created_at: '2026-10-20T00:00:00.000Z', updated_at: 'u1' }],
      fh_quote_items: [{ id: 'it-1', quote_id: 'quote-1', contact_id: null, description: 'Slab', qty: 1, rate: 2949.75, amount: 2949.75, sort_order: 0 }]
    }))
    expect((await post(approveHandler, { token: 'q', signature_name: 'Dana', expected_total: 2949.75, expected_updated_at: 'u1' })).status).toBe(200)
    const row = db.tables.fh_notifications.find((n) => n.kind === 'quote_approved')!
    expect(row.title).toBe('Quote approved · $2,949.75')
    expect(String(pushes[0].payload.title)).toContain('$2,949.75')
  })

  it('a job proposal approval alert prints dollars and cents', async () => {
    const db = seedDb(baseTables({
      fh_public_links: [link({ token: 'jp', kind: 'proposal', contact_id: 'job-1' })],
      fh_contacts: [job({ stage: 'quote', proposal_status: 'sent' })],
      fh_quote_items: [{ id: 'ji', quote_id: null, contact_id: 'job-1', description: 'Patio', qty: 1, rate: 20000, amount: 20000, sort_order: 0 }]
    }))
    expect((await post(approveHandler, { token: 'jp', signature_name: 'Dana', expected_total: 20000 })).status).toBe(200)
    expect(db.tables.fh_notifications.find((n) => n.kind === 'quote_approved')!.title).toBe('Quote approved · $20,000.00')
  })

  it('a change order signature alert prints dollars and cents, credits included', async () => {
    const coDb = (amount: number) => seedDb(baseTables({
      fh_public_links: [link({ token: 'co', kind: 'change_order', contact_id: 'job-1', change_order_id: 'co-1' })],
      fh_contacts: [job()],
      fh_change_orders: [{ id: 'co-1', org_id: ORG, user_id: OWNER, contact_id: 'job-1', sequence_number: 1, title: 'Footing', amount, status: 'sent', updated_at: 'u1' }]
    }))
    let db = coDb(1235.5)
    expect((await post(coApproveHandler, { token: 'co', signature_name: 'Dana', expected_amount: 1235.5, expected_updated_at: 'u1' })).status).toBe(200)
    expect(db.tables.fh_notifications.find((n) => n.kind === 'change_order_signed')!.title).toBe('Change order signed · +$1,235.50')
    db = coDb(-400)
    expect((await post(coApproveHandler, { token: 'co', signature_name: 'Dana', expected_amount: -400, expected_updated_at: 'u1' })).status).toBe(200)
    expect(db.tables.fh_notifications.find((n) => n.kind === 'change_order_signed')!.title).toBe('Change order signed · −$400.00')
  })
})

// formats-2: the link carries the company's time zone, so the customer's
// phone prints the dates the company set, whatever zone it is in.
describe('the link carries the company time zone', () => {
  const invoiceTables = (extra: Record<string, Row[]> = {}) => baseTables({
    fh_public_links: [link({ token: 'tz', kind: 'invoice', contact_id: 'job-1' })],
    fh_contacts: [job()],
    fh_invoices: [bill('inv-tz', 1, 5000, 'sent')],
    ...extra
  })

  it('names the zone the company set', async () => {
    seedDb(invoiceTables({ fh_org_settings: [{ org_id: ORG, timezone: 'America/Denver' }] }))
    const { body } = await getLink('tz')
    expect(body.company.timezone).toBe('America/Denver')
  })

  it('uses Central time when the company has set none, as the server does', async () => {
    seedDb(invoiceTables())
    const { body } = await getLink('tz')
    expect(body.company.timezone).toBe('America/Chicago')
  })
})
