import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, newFakeDb, recordingFetch, type FakeDb, type Outbound } from './functionTestDb.ts'

// Every email sender: a second tap after a lost response must not mail the
// customer twice, a slow or unreachable provider must come back as a plain
// JSON error, and a send must leave its record marked sent (FN-24).

let db: FakeDb
let outbound: Outbound[] = []
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeSupabase(db) }))

const ORG = '0b0b0b0b-0000-4000-8000-000000000001'
const OWNER = 'user-owner'

function seed() {
  db = newFakeDb({
    organizations: [{ id: ORG, name: 'Parker Concrete' }],
    org_members: [{ id: 'm-owner', org_id: ORG, user_id: OWNER, role: 'owner', joined_at: '2026-01-01T00:00:00Z', revoked_at: null }],
    profiles: [{ user_id: OWNER, org_id: ORG, company_name: 'Parker Concrete', company_email: 'office@parker.example.test' }],
    fh_clients: [{ id: 'client-1', org_id: ORG, user_id: OWNER, name: 'Dana Smith', company_name: null, email: 'dana@example.test' }],
    fh_contacts: [{ id: 'job-1', org_id: ORG, user_id: OWNER, client_id: 'client-1', name: 'Dana Smith', job_title: 'Smith driveway', amount: 20000, email: 'dana@example.test', stage: 'job', proposal_status: 'approved' }],
    fh_quotes: [{ id: 'q1', org_id: ORG, user_id: OWNER, client_id: 'client-1', title: 'Driveway', status: 'draft' }],
    fh_invoices: [{ id: 'inv-2', org_id: ORG, user_id: OWNER, contact_id: 'job-1', client_id: 'client-1', title: 'Draw 2', description: 'Draw 2, slab pour', amount: 5000, status: 'draft', due_at: null, issued_at: null, sequence_number: 2, updated_at: '2026-11-10T00:00:00Z' }],
    fh_change_orders: [], fh_notes: [], fh_closeouts: [], org_invites: []
  })
  db.users = { 'tok-owner': { id: OWNER, email: 'jesse@example.test' } }
}

beforeEach(() => {
  seed()
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

const path = (name: string) => `${OWNER}/job-1/${name}.pdf`
const senders: Record<string, { file: string; body: (pdf: string) => Record<string, unknown> }> = {
  'send-quote': { file: 'send-quote.js', body: (pdf) => ({ quote_id: 'q1', sender_user_id: OWNER, recipient_email: 'dana@example.test', storage_path: pdf }) },
  'send-invoice': { file: 'send-invoice.js', body: (pdf) => ({ contact_id: 'job-1', invoice_id: 'inv-2', invoice_updated_at: '2026-11-10T00:00:00Z', sender_user_id: OWNER, recipient_email: 'dana@example.test', storage_path: pdf, amount_due: 5000 }) },
  'send-statement': { file: 'send-statement.js', body: (pdf) => ({ client_id: 'client-1', sender_user_id: OWNER, recipient_email: 'dana@example.test', storage_path: pdf, total_due: 5000 }) },
  'send-certificate': { file: 'send-certificate.js', body: (pdf) => ({ contact_id: 'job-1', sender_user_id: OWNER, recipient_email: 'dana@example.test', storage_path: pdf }) },
  'send-message': { file: 'send-message.js', body: (pdf) => ({ contact_id: 'job-1', sender_user_id: OWNER, recipient_email: 'dana@example.test', subject: 'Arrival', body: `West gate ${pdf}` }) }
}

async function handler(file: string) {
  return (await import(`../../netlify/functions/${file}`)).default
}
const keyOf = (o: Outbound) => Object.entries(o.headers).find(([h]) => h.toLowerCase() === 'idempotency-key')?.[1]

describe('the email senders', () => {
  for (const [name, s] of Object.entries(senders)) {
    it(`${name} sends the same idempotency key for a repeated request and a new one for a new document`, async () => {
      const send = await handler(s.file)
      for (const pdf of [path('a'), path('a'), path('b')]) {
        seed()
        expect((await send(post(`/api/${name}`, s.body(pdf)))).status).toBe(200)
      }
      const mails = outbound.filter((o) => o.host === 'api.resend.com')
      expect(mails).toHaveLength(3)
      const keys = mails.map(keyOf)
      expect(keys[0]).toMatch(/^[\w./-]{8,256}$/)
      expect(keys[1]).toBe(keys[0])
      expect(keys[2]).not.toBe(keys[0])
    })

    it(`${name} answers a JSON error when the mail provider cannot be reached`, async () => {
      const send = await handler(s.file)
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
      const res = await send(post(`/api/${name}`, s.body(path('a'))))
      expect(res.status).toBe(502)
      expect(await res.json()).toMatchObject({ error: 'send_failed' })
    })

    it(`${name} gives the provider call a time limit`, async () => {
      const send = await handler(s.file)
      await send(post(`/api/${name}`, s.body(path('a'))))
      const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('api.resend.com'))!
      expect((call[1] as RequestInit).signal).toBeInstanceOf(AbortSignal)
    })
  }

  it('org-invite-create sends an idempotency key, a time limit, and survives an unreachable provider', async () => {
    const invite = await handler('org-invite-create.js')
    const res = await invite(post('/api/org-invite-create', { email: 'new@example.test', role: 'crew', org_id: ORG }))
    expect(res.status).toBe(200)
    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('api.resend.com'))!
    expect((call[1] as RequestInit).signal).toBeInstanceOf(AbortSignal)
    expect(keyOf(outbound[0])).toMatch(/^[\w./-]{8,256}$/)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const failed = await invite(post('/api/org-invite-create', { email: 'new2@example.test', role: 'crew', org_id: ORG }))
    expect(failed.status).toBe(200)
    expect((await failed.json()).email).toMatchObject({ sent: false })
  })
})

describe('the record is marked sent on the server', () => {
  it('send-invoice marks a draft invoice sent with its issue date', async () => {
    const send = await handler('send-invoice.js')
    expect((await send(post('/api/send-invoice', senders['send-invoice'].body(path('a'))))).status).toBe(200)
    expect(db.tables.fh_invoices[0].status).toBe('sent')
    expect(db.tables.fh_invoices[0].issued_at).toBeTruthy()
  })

  it('send-invoice keeps the first issue date and never demotes a paid invoice', async () => {
    const send = await handler('send-invoice.js')
    Object.assign(db.tables.fh_invoices[0], { status: 'paid', issued_at: '2026-11-01T00:00:00Z' })
    expect((await send(post('/api/send-invoice', senders['send-invoice'].body(path('a'))))).status).toBe(200)
    expect(db.tables.fh_invoices[0]).toMatchObject({ status: 'paid', issued_at: '2026-11-01T00:00:00Z' })
  })

  for (const [name, table] of [['send-invoice', 'fh_invoices'], ['send-quote', 'fh_quotes']] as const) {
    it(`${name} answers an error, not ok, when the sent status cannot be saved`, async () => {
      const send = await handler(senders[name].file)
      db.failWrites[table] = 'canceling statement due to statement timeout'
      const res = await send(post(`/api/${name}`, senders[name].body(path('a'))))
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body).toMatchObject({ error: 'status_not_saved', email_sent: true })
      expect(body.detail).toMatch(/was sent/)
    })
  }
})

describe('what the customer sees on a phone (PT-22)', () => {
  for (const [name, s] of Object.entries(senders)) {
    it(`${name} is fluid width with a viewport, so it fits a 390 px screen`, async () => {
      const send = await handler(s.file)
      await send(post(`/api/${name}`, s.body(path('a'))))
      const html = outbound.find((o) => o.host === 'api.resend.com')!.body.html as string
      expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">')
      expect(html).not.toMatch(/width="\d+"/)
    })
  }

  for (const [name, s] of Object.entries(senders).filter(([n]) => n !== 'send-message')) {
    it(`${name} greets a person by first name and a company neutrally`, async () => {
      const send = await handler(s.file)
      const greetingOf = async (recipient_name: string) => {
        outbound.length = 0
        seed()
        await send(post(`/api/${name}`, { ...s.body(path('a')), recipient_name }))
        return (outbound.find((o) => o.host === 'api.resend.com')!.body.text as string).split('\n')[0]
      }
      expect(await greetingOf('Marco Castellanos')).toBe('Hi Marco,')
      expect(await greetingOf('The Roof Doctor')).toBe('Hello,')
      expect(await greetingOf('MMC Properties')).toBe('Hello,')
    })
  }
})
