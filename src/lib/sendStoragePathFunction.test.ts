// Attachment paths on the send functions (send-quote, send-invoice,
// send-certificate, send-statement, docusign-send) and on sub-doc-confirm.
//
// Each of them takes a storage_path from the request body. The send
// functions read that path with the service role key and mail the bytes to
// an address the caller chose. The old guard only checked that the path
// began with the caller's id. The storage client appends the path to the
// URL as it is and fetch collapses dot segments, so a path such as
// "<caller id>/../../../../../rest/v1/fh_clients?select=*" passed the guard
// and made the service key read any table, which was then mailed out.
//
// Three layers:
//   1. isOwnedStoragePath, the shared rule.
//   2. Every handler with a stand in Supabase client. A bad path is refused
//      before any download, email or DocuSign call, and every path shape
//      the apps really send still goes through.
//   3. send-quote with the real supabase-js client against a local server
//      on 127.0.0.1, so the test sees the requests that would really leave.
//
// Nothing here reaches a live service: Resend and DocuSign are answered by
// the fetch stub and any other host throws.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { generateKeyPairSync } from 'node:crypto'

// The handlers build their own Supabase client. A test hands them a stand
// in through this slot. While the slot is empty they get the real
// supabase-js client, which layer 3 points at a local server.
const supabaseSlot = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/supabase-js')>()
  return {
    ...actual,
    createClient: (url: string, key: string, options?: any) => supabaseSlot.client ?? actual.createClient(url, key, options)
  }
})

import { isOwnedStoragePath } from '../../netlify/functions/lib/storagePath.js'
import sendQuote from '../../netlify/functions/send-quote.js'
import sendInvoice from '../../netlify/functions/send-invoice.js'
import sendCertificate from '../../netlify/functions/send-certificate.js'
import sendStatement from '../../netlify/functions/send-statement.js'
import docusignSend from '../../netlify/functions/docusign-send.js'
import subDocConfirm from '../../netlify/functions/sub-doc-confirm.js'
import subDocUploadUrl from '../../netlify/functions/sub-doc-upload-url.js'

const UID = 'aaaaaaaa-1111-4111-8111-111111111111' // the signed in caller
const OTHER = 'bbbbbbbb-2222-4222-8222-222222222222' // somebody else's account
const JOB = 'cccccccc-3333-4333-8333-333333333333'
const QUOTE = 'dddddddd-4444-4444-8444-444444444444'
const CLIENT = '99999999-7777-4777-8777-777777777777'
const INVOICE = '88888888-8888-4888-8888-888888888888' // bills the job
const CLIENT_INVOICE = 'eeeeeeee-5555-4555-8555-555555555555' // bills a client, no job
const ROW = 'ffffffff-6666-4666-8666-666666666666' // the uploaded file's own id

// Every path shape a real caller builds. The upload code is named beside each.
const REAL_PATHS = {
  // Quote.tsx, JobComplete.tsx, JobMoney.tsx, InvoiceDrawsSection.tsx and
  // src/lib/invoices.ts for an invoice that bills a job.
  job: `${UID}/${JOB}/${ROW}.pdf`,
  // src/screens/quotes/quoteDocument.ts
  quote: `${UID}/quotes/${QUOTE}/${ROW}.pdf`,
  // src/lib/invoices.ts for an invoice that bills a client with no job.
  invoice: `${UID}/invoices/${CLIENT_INVOICE}/${ROW}.pdf`,
  // src/lib/statement.ts
  statement: `${UID}/statements/${ROW}.pdf`,
  // mobile/lib/sendDocs.ts names the file with Date.now() and a random
  // suffix instead of a row id.
  mobile: `${UID}/${JOB}/1763337600000-k3j2h1g0.pdf`
}

// The path the audit probe used: out of the bucket and into the REST API.
const TRAVERSAL = `${UID}/../../../../../rest/v1/fh_clients?select=*`

const STORAGE_BASE = 'https://project.example.test/storage/v1/object/job-files/'

describe('isOwnedStoragePath', () => {
  const pdf = { extensions: ['pdf'] }
  const longPath = (length: number) => `${UID}/${'a'.repeat(length - UID.length - '/.pdf'.length)}.pdf`

  it.each(Object.entries(REAL_PATHS))('accepts the %s path the app really sends', (_name, path) => {
    expect(isOwnedStoragePath(path, UID, pdf)).toBe(true)
  })

  it.each([
    ['a parent folder segment', `${UID}/../x.pdf`],
    ['a climb out of the bucket into the REST API', TRAVERSAL],
    ['a climb in the middle of the path', `${UID}/a/../../b.pdf`],
    ['percent encoded dots', `${UID}/%2e%2e/x.pdf`],
    ['a query string', `${UID}/a/b.pdf?x=1`],
    ['a fragment', `${UID}/a/b.pdf#x`],
    ['an empty segment', `${UID}//b.pdf`],
    ['a backslash', `${UID}/a\\b.pdf`],
    ['a space', `${UID}/a b.pdf`],
    ["another user's id as the first segment", `${OTHER}/a/b.pdf`],
    ['an id that is only the start of the first segment', `${UID}x/a.pdf`],
    ['six segments', `${UID}/a/b/c/d/e.pdf`],
    ['a path of 301 characters', longPath(301)],
    ['an empty string', ''],
    ['a png when a pdf is required', `${UID}/a/b.png`],
    ['a segment made only of dots', `${UID}/.../x.pdf`],
    ['a single dot segment', `${UID}/./x.pdf`],
    ['an encoded slash', `${UID}/a%2Fb.pdf`],
    ['a tab', `${UID}/a\tb.pdf`],
    ['a line break at the end', `${UID}/a/b.pdf\n`],
    ['a NUL character', `${UID}/a\u0000b.pdf`],
    ['a leading slash', `/${UID}/a/b.pdf`],
    ['a trailing slash', `${UID}/a/b.pdf/`],
    ['the owner id with no file', UID],
    ['the owner folder with no file', `${UID}/`],
    ['the owner id in another letter case', `${UID.toUpperCase()}/a/b.pdf`],
    ['letters outside ASCII', `${UID}/caf\u00e9.pdf`],
    ['full width dots', `${UID}/\uff0e\uff0e/x.pdf`]
  ])('refuses %s', (_name, path) => {
    expect(isOwnedStoragePath(path, UID, pdf)).toBe(false)
  })

  it('refuses a path that is not a string, even one that would print as a good path', () => {
    const good = REAL_PATHS.job
    for (const path of [42, null, undefined, true, {}, [good], { toString: () => good }, new String(good)]) {
      expect(isOwnedStoragePath(path, UID, pdf)).toBe(false)
    }
  })

  it('refuses when the owner id is missing or not a string', () => {
    expect(isOwnedStoragePath('/a/b.pdf', '', pdf)).toBe(false)
    expect(isOwnedStoragePath('undefined/a/b.pdf', undefined, pdf)).toBe(false)
    expect(isOwnedStoragePath('null/a/b.pdf', null, pdf)).toBe(false)
    expect(isOwnedStoragePath('7/a/b.pdf', 7, pdf)).toBe(false)
  })

  it('allows two to five segments and at most 300 characters', () => {
    expect(isOwnedStoragePath(`${UID}/a.pdf`, UID, pdf)).toBe(true)
    expect(isOwnedStoragePath(`${UID}/a/b/c/d.pdf`, UID, pdf)).toBe(true)
    expect(longPath(300)).toHaveLength(300)
    expect(isOwnedStoragePath(longPath(300), UID, pdf)).toBe(true)
    expect(longPath(301)).toHaveLength(301)
  })

  it('compares the extension at the end of the file name, in any letter case', () => {
    const docs = { extensions: ['pdf', 'jpg', 'png'] }
    expect(isOwnedStoragePath(`${UID}/a/B.PDF`, UID, pdf)).toBe(true)
    expect(isOwnedStoragePath(`${UID}/a/b.pdf.exe`, UID, pdf)).toBe(false)
    expect(isOwnedStoragePath(`${UID}/a/bpdf`, UID, pdf)).toBe(false)
    expect(isOwnedStoragePath(`${UID}/a/b.jpg`, UID, docs)).toBe(true)
    expect(isOwnedStoragePath(`${UID}/a/b.gif`, UID, docs)).toBe(false)
    expect(isOwnedStoragePath(`${UID}/a/b.pdf`, UID, { extensions: [] })).toBe(false)
    // No extension rule unless one is asked for.
    expect(isOwnedStoragePath(`${UID}/a/b.png`, UID)).toBe(true)
  })

  it('holds the path inside a folder prefix when one is given', () => {
    const coi = { prefix: ['coi'] }
    expect(isOwnedStoragePath(`${UID}/coi/1763337600000-1a2b3c4d.pdf`, UID, coi)).toBe(true)
    expect(isOwnedStoragePath(`${UID}/w9/1763337600000-1a2b3c4d.pdf`, UID, coi)).toBe(false)
    // The prefix is matched segment by segment, never as a run of characters.
    expect(isOwnedStoragePath(`${UID}/coi-old/x.pdf`, UID, coi)).toBe(false)
    // The folder alone names no file.
    expect(isOwnedStoragePath(`${UID}/coi`, UID, coi)).toBe(false)
    expect(isOwnedStoragePath(`${UID}/coi/../w9/x.pdf`, UID, coi)).toBe(false)
    expect(isOwnedStoragePath(REAL_PATHS.quote, UID, { prefix: ['quotes', QUOTE] })).toBe(true)
    expect(isOwnedStoragePath(REAL_PATHS.quote, UID, { prefix: ['quotes', JOB] })).toBe(false)
    // A prefix that is not a list is a coding mistake and fails closed.
    expect(isOwnedStoragePath(`${UID}/coi/x.pdf`, UID, { prefix: 'coi' })).toBe(false)
  })

  // The property behind the rules: fetch parses the URL the storage client
  // builds, and whatever is accepted must be requested exactly where it
  // says, inside the caller's own folder.
  it('never accepts a path that URL parsing would move, cut short or point elsewhere', () => {
    const climbed = new URL(STORAGE_BASE + TRAVERSAL)
    expect(climbed.pathname + climbed.search).toBe('/rest/v1/fh_clients?select=*')

    const pieces = [
      '..', '.', '...', '%2e', '%2E%2e', '.%2e', '%2f', '%5c', '%00', '', ' ', '\t', '\n', '\\',
      '?', '#', ';', ':', '@', '&', '=', '+', '%', '~', '*', 'a', 'B', '0', 'b.pdf', 'a-b_c.d',
      UID, OTHER, 'rest', 'v1'
    ]
    let accepted = 0
    for (const a of pieces) for (const b of pieces) for (const c of pieces) {
      for (const path of [`${UID}/${a}/${b}/${c}`, `${UID}/${a}${b}${c}`, `${UID}${a}/${b}${c}`]) {
        if (!isOwnedStoragePath(path, UID)) continue
        accepted++
        expect(new URL(STORAGE_BASE + path).pathname).toBe(`/storage/v1/object/job-files/${path}`)
        expect(path.split('/')[0]).toBe(UID)
      }
    }
    expect(accepted).toBeGreaterThan(100)
  })
})

// Layers 2 and 3: the handlers.

type Row = Record<string, any>

const TOKEN = 'caller-access-token'
const SERVICE_KEY = 'test-service-role-key'
const UPDATED_AT = '2026-11-01T00:00:00+00:00'
const PDF_BYTES = '%PDF-1.4 the caller own document'
const FORBIDDEN_PATH = { error: 'forbidden_path', detail: 'storage_path is outside your namespace.' }
// docusign-send signs a JWT before it calls DocuSign, so it needs a real key.
const DOCUSIGN_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

// Rows with no company on them, so their creator alone may send.
function senderRows(): Record<string, Row[]> {
  return {
    fh_contacts: [{ id: JOB, user_id: UID, org_id: null, name: 'Pat Customer', job_title: 'Deck rebuild', stage: 'quote', proposal_status: 'draft', amount: 1200 }],
    fh_quotes: [{ id: QUOTE, user_id: UID, org_id: null, title: 'Deck rebuild', status: 'draft', client_id: CLIENT }],
    fh_clients: [{ id: CLIENT, user_id: UID, org_id: null, name: 'Pat Customer', company_name: null }],
    fh_invoices: [
      { id: INVOICE, user_id: UID, org_id: null, contact_id: JOB, client_id: CLIENT, title: 'Deposit', description: 'Deposit', amount: 600, status: 'sent', due_at: null, updated_at: UPDATED_AT },
      { id: CLIENT_INVOICE, user_id: UID, org_id: null, contact_id: null, client_id: CLIENT, title: 'Service call', description: 'Service call', amount: 150, status: 'sent', due_at: null, updated_at: UPDATED_AT }
    ],
    profiles: [{ user_id: UID, full_name: 'Sam Sender', company_name: 'Sender Concrete', company_email: 'office@sender.example.test' }]
  }
}

// In memory stand in for the supabase-js client: enough of the query
// builder, auth and storage for the handlers to run their real access
// checks against the rows a test seeds. Downloads and writes are recorded.
function fakeSupabase(tables: Record<string, Row[]>, user: Row) {
  const downloads: Array<{ bucket: string; path: unknown }> = []
  const writes: Array<{ table: string; op: 'insert' | 'update'; payload: Row }> = []
  const from = (table: string) => {
    const rows = (tables[table] ||= [])
    const filters: Array<(row: Row) => boolean> = []
    let write: { op: 'insert' | 'update'; payload: Row } | null = null
    const run = () => {
      const hit = rows.filter((row) => filters.every((test) => test(row)))
      if (write) {
        writes.push({ table, ...write })
        if (write.op === 'insert') rows.push({ ...write.payload })
        else for (const row of hit) Object.assign(row, write.payload)
      }
      return { data: hit.map((row) => ({ ...row })), error: null }
    }
    const query: any = {
      select: () => query,
      insert: (payload: Row) => { write = { op: 'insert', payload }; return query },
      update: (payload: Row) => { write = { op: 'update', payload }; return query },
      eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return query },
      is: (column: string, value: unknown) => { filters.push((row) => (row[column] ?? null) === value); return query },
      in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return query },
      order: () => query,
      limit: () => query,
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      then: (resolve: any, reject: any) => Promise.resolve().then(run).then(resolve, reject)
    }
    return query
  }
  const client = {
    from,
    rpc: async () => ({ data: [{ request_count: 1, allowed: true }], error: null }),
    auth: {
      getUser: async (token: string) => (token === TOKEN
        ? { data: { user }, error: null }
        : { data: { user: null }, error: { message: 'invalid JWT' } })
    },
    storage: {
      from: (bucket: string) => ({
        download: async (path: unknown) => {
          downloads.push({ bucket, path })
          return { data: new Blob([PDF_BYTES]), error: null }
        },
        createSignedUploadUrl: async (path: string) => ({ data: { signedUrl: `https://signed.example.test/${path}`, token: 'upload-token' }, error: null })
      })
    }
  }
  return { client, tables, downloads, writes }
}

function useFake(tables: Record<string, Row[]> = senderRows(), user: Row = { id: UID, email: 'sender@example.test' }) {
  const fake = fakeSupabase(tables, user)
  supabaseSlot.client = fake.client
  return fake
}

// What left the function: every URL handed to fetch, the Resend payloads
// and the DocuSign envelopes.
let fetched: string[] = []
let mail: any[] = []
let envelopes: any[] = []
// Origin of the local stand in for Supabase while layer 3 runs, else ''.
let localSupabase = ''
const realFetch = globalThis.fetch

beforeEach(() => {
  fetched = []
  mail = []
  envelopes = []
  vi.stubEnv('SUPABASE_URL', 'https://project.example.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY)
  vi.stubEnv('SUPABASE_ANON_KEY', 'test-anon-key')
  vi.stubEnv('RESEND_API_KEY', 'test-resend-key')
  vi.stubEnv('SEND_EMAIL_FROM', 'notifications@example.test')
  vi.stubEnv('DOCUSIGN_INTEGRATION_KEY', 'test-integration-key')
  vi.stubEnv('DOCUSIGN_USER_ID', 'test-docusign-user')
  vi.stubEnv('DOCUSIGN_ACCOUNT_ID', 'test-docusign-account')
  vi.stubEnv('DOCUSIGN_PRIVATE_KEY', DOCUSIGN_KEY)
  vi.stubEnv('DOCUSIGN_AUTH_BASE', 'account-d.docusign.com')
  vi.stubEnv('DOCUSIGN_API_BASE', 'https://demo.docusign.net')
  vi.stubGlobal('fetch', async (input: any, init?: any) => {
    const href = typeof input === 'string' ? input : input?.url || String(input)
    fetched.push(href)
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    const { host } = new URL(href)
    if (host === 'api.resend.com') {
      mail.push(JSON.parse(String(init?.body || '{}')))
      return reply(200, { id: 'email-1' })
    }
    if (host === 'account-d.docusign.com') return reply(200, { access_token: 'docusign-token' })
    if (host === 'demo.docusign.net') {
      envelopes.push(JSON.parse(String(init?.body || '{}')))
      return reply(201, { envelopeId: 'ENV-1' })
    }
    if (localSupabase && href.startsWith(`${localSupabase}/`)) return realFetch(input, init)
    throw new Error(`test refused a live call to ${host}`)
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  supabaseSlot.client = null
})

const post = (api: string, body: Row) => new Request(`https://app.example.test${api}`, {
  method: 'POST',
  headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
  body: JSON.stringify(body)
})

// One request each handler accepts, less the storage_path.
const SENDERS = {
  'send-quote': { handler: sendQuote, body: { contact_id: JOB } as Row },
  'send-invoice': { handler: sendInvoice, body: { contact_id: JOB, invoice_id: INVOICE, invoice_updated_at: UPDATED_AT, amount_due: 600 } as Row },
  'send-certificate': { handler: sendCertificate, body: { contact_id: JOB } as Row },
  'send-statement': { handler: sendStatement, body: { client_id: CLIENT, total_due: 750 } as Row },
  'docusign-send': { handler: docusignSend, body: { contact_id: JOB } as Row }
}
type Sender = keyof typeof SENDERS

function send(name: Sender, storage_path: unknown, body: Row = SENDERS[name].body): Promise<Response> {
  return SENDERS[name].handler(post(`/api/${name}`, {
    ...body, sender_user_id: UID, recipient_email: 'customer@example.test', storage_path
  }))
}

describe.each(Object.keys(SENDERS) as Sender[])('%s attachment path', (name) => {
  it.each([
    ['a climb out of the bucket into the REST API', TRAVERSAL],
    ["a climb into another account's folder", `${UID}/../${OTHER}/${JOB}/proposal.pdf`],
    ['percent encoded dot segments', `${UID}/%2e%2e/${OTHER}/${JOB}/proposal.pdf`],
    ['a query string', `${REAL_PATHS.job}?download=1`],
    ['a file that is not a PDF', `${UID}/${JOB}/${ROW}.png`],
    // The old guard already stopped this one. It must stay stopped.
    ["another account's folder named outright", `${OTHER}/${JOB}/${ROW}.pdf`]
  ])('refuses %s before any download, email or signing request', async (_label, storage_path) => {
    const fake = useFake()
    const response = await send(name, storage_path)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual(FORBIDDEN_PATH)
    expect(fake.downloads).toEqual([])
    expect(fetched).toEqual([])
    expect(mail).toEqual([])
    expect(envelopes).toEqual([])
    // Nothing is recorded as sent either.
    expect(fake.writes).toEqual([])
  })
})

describe('attachment paths the apps really send', () => {
  it.each<[Sender, string, string, Row | undefined]>([
    ['send-quote', 'a job proposal', REAL_PATHS.job, undefined],
    ['send-quote', 'a quote record', REAL_PATHS.quote, { quote_id: QUOTE }],
    ['send-quote', 'a proposal from the mobile app', REAL_PATHS.mobile, undefined],
    ['send-invoice', 'an invoice on a job', REAL_PATHS.job, undefined],
    ['send-invoice', 'an invoice for a client with no job', REAL_PATHS.invoice, { contact_id: null, invoice_id: CLIENT_INVOICE, invoice_updated_at: UPDATED_AT, amount_due: 150 }],
    ['send-certificate', 'a certificate of completion', REAL_PATHS.job, undefined],
    ['send-statement', 'a client statement', REAL_PATHS.statement, undefined],
    ['docusign-send', 'a job proposal', REAL_PATHS.job, undefined],
    ['docusign-send', 'a quote record', REAL_PATHS.quote, { quote_id: QUOTE }]
  ])('%s still downloads and sends %s', async (name, _label, path, body) => {
    const fake = useFake()
    const response = await send(name, path, body)
    expect(response.status).toBe(200)
    expect((await response.json()).ok).toBe(true)
    expect(fake.downloads).toEqual([{ bucket: 'job-files', path }])
    // The bytes that left are the bytes storage returned.
    const sent = name === 'docusign-send' ? envelopes[0].documents[0].documentBase64 : mail[0].attachments[0].content
    expect(Buffer.from(sent, 'base64').toString('utf8')).toBe(PDF_BYTES)
  })
})

// An array prints as a good path, which is all the old guard looked at.
// docusign-send already answers 400 for it (see docusignFunctions.test.ts).
describe('a storage_path that is not a string', () => {
  it.each<Sender>(['send-quote', 'send-invoice', 'send-certificate', 'send-statement'])('%s refuses it before any download or email', async (name) => {
    const fake = useFake()
    const response = await send(name, [REAL_PATHS.job])
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual(FORBIDDEN_PATH)
    expect(fake.downloads).toEqual([])
    expect(fetched).toEqual([])
    expect(fake.writes).toEqual([])
  })
})

describe('sub-doc-confirm storage path', () => {
  const ORG = 'org-contractor'
  const SUB = { id: UID, email: 'Sub.Person@Example.test' }
  const NOT_OWNED = { error: 'path_not_owned', detail: 'Storage path does not belong to this caller.' }
  const UPLOADED = '1763337600000-1a2b3c4d'
  // A sub who accepted a job invite from one contractor, with a vendor
  // profile there and no documents yet.
  const subRows = (): Record<string, Row[]> => ({
    fh_job_partners: [{ job_id: JOB, partner_user_id: UID, status: 'accepted', deleted_by_partner_at: null }],
    fh_contacts: [{ id: JOB, org_id: ORG }],
    fh_sub_profiles: [{ id: 'profile-1', org_id: ORG, email: 'sub.person@example.test', coi_path: null, w9_path: null, license_path: null }]
  })

  it.each([
    ['coi', 'application/pdf', 'pdf'],
    ['w9', 'image/jpeg', 'jpg'],
    ['license', 'image/png', 'png']
  ])('accepts the path the upload handler issues for a %s sent as %s', async (kind, content_type, ext) => {
    const fake = useFake(subRows(), SUB)
    const issued = await (await subDocUploadUrl(post('/api/sub-doc-upload-url', { kind, filename: `my ${kind}.${ext}`, content_type }))).json()
    expect(issued.ok).toBe(true)
    expect(issued.storage_path.startsWith(`${UID}/${kind}/`)).toBe(true)
    expect(issued.storage_path.endsWith(`.${ext}`)).toBe(true)

    const response = await subDocConfirm(post('/api/sub-doc-confirm', { kind, storage_path: issued.storage_path }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, updated_count: 1, column: `${kind}_path`, storage_path: issued.storage_path })
    expect(fake.tables.fh_sub_profiles[0][`${kind}_path`]).toBe(issued.storage_path)
  })

  it.each([
    ["a climb into another sub's folder", `${UID}/coi/../../${OTHER}/coi/${UPLOADED}.pdf`],
    ['a climb into another kind of document', `${UID}/coi/../w9/${UPLOADED}.pdf`],
    ['percent encoded dot segments', `${UID}/coi/%2e%2e/%2e%2e/${OTHER}/coi/${UPLOADED}.pdf`],
    ['a query string', `${UID}/coi/${UPLOADED}.pdf?download=1`],
    ['the folder with no file in it', `${UID}/coi/`],
    ['a file type the upload handler never issues', `${UID}/coi/${UPLOADED}.exe`],
    // The old guard already stopped these two. They must stay stopped.
    ['the folder of another kind of document', `${UID}/w9/${UPLOADED}.pdf`],
    ["another sub's folder named outright", `${OTHER}/coi/${UPLOADED}.pdf`]
  ])('refuses %s and saves nothing', async (_label, storage_path) => {
    const fake = useFake(subRows(), SUB)
    const response = await subDocConfirm(post('/api/sub-doc-confirm', { kind: 'coi', storage_path }))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual(NOT_OWNED)
    expect(fake.writes).toEqual([])
    expect(fake.tables.fh_sub_profiles[0].coi_path).toBeNull()
  })
})

// Layer 3. The audit probe, kept as a regression test: the real supabase-js
// client, and a local HTTP server standing in for the project so the test
// sees every request the service key would really make.
describe('send-quote with the real Supabase client', () => {
  const OTHER_COMPANY_ROWS = JSON.stringify([{ id: 'c-1', org_id: 'other-org', name: 'Other Customer', phone: '+15550001111', email: 'customer@other.example.test' }])
  const OTHER_COMPANY_PDF = '%PDF-1.4 another account proposal'
  // What send-quote asks Supabase for on its own before the download.
  const OWN_LOOKUPS = ['/auth/v1/user', '/rest/v1/rpc/fh_increment_rate_limit', '/rest/v1/fh_contacts', '/rest/v1/profiles']
  type Seen = { method: string; url: string; authorization: string }
  let seen: Seen[] = []
  let server: http.Server

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url || ''
      seen.push({ method: req.method || '', url, authorization: String(req.headers.authorization || '') })
      const answer = (status: number, body: string, type = 'application/json') => { res.writeHead(status, { 'content-type': type }); res.end(body) }
      req.resume()
      req.on('end', () => {
        if (url.startsWith('/auth/v1/user')) return answer(200, JSON.stringify({ id: UID, aud: 'authenticated', email: 'sender@example.test' }))
        if (url.startsWith('/rest/v1/rpc/fh_increment_rate_limit')) return answer(200, JSON.stringify([{ request_count: 1, allowed: true }]))
        if (url.startsWith('/rest/v1/fh_contacts') && req.method === 'GET') return answer(200, JSON.stringify(senderRows().fh_contacts))
        if (url.startsWith('/rest/v1/fh_contacts')) return answer(204, '')
        if (url.startsWith('/rest/v1/profiles')) return answer(200, JSON.stringify(senderRows().profiles))
        if (url.startsWith('/rest/v1/fh_notes')) return answer(201, '')
        // What a real project answers to the service role key on these paths.
        if (url === '/rest/v1/fh_clients?select=*') return answer(200, OTHER_COMPANY_ROWS)
        if (url === `/storage/v1/object/job-files/${OTHER}/${JOB}/proposal.pdf`) return answer(200, OTHER_COMPANY_PDF, 'application/pdf')
        if (url === `/storage/v1/object/job-files/${REAL_PATHS.job}`) return answer(200, PDF_BYTES, 'application/pdf')
        return answer(404, JSON.stringify({ message: 'not found', url }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    localSupabase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    localSupabase = ''
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  beforeEach(() => {
    seen = []
    vi.stubEnv('SUPABASE_URL', localSupabase)
  })

  const pathOf = (request: Seen) => new URL(request.url, localSupabase).pathname

  it('refuses the climb into the REST API, so the service key never reads the table', async () => {
    const response = await send('send-quote', TRAVERSAL)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual(FORBIDDEN_PATH)
    // The handler's own lookups left and nothing else did.
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.map(pathOf).filter((path) => !OWN_LOOKUPS.includes(path))).toEqual([])
    expect(seen.some((request) => request.url.startsWith('/rest/v1/fh_clients'))).toBe(false)
    expect(fetched.some((href) => href.includes('..'))).toBe(false)
    expect(mail).toEqual([])
  })

  it("refuses the climb into another account's folder and never asks storage for it", async () => {
    const response = await send('send-quote', `${UID}/../${OTHER}/${JOB}/proposal.pdf`)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual(FORBIDDEN_PATH)
    expect(seen.some((request) => request.url.startsWith('/storage/'))).toBe(false)
    expect(mail).toEqual([])
  })

  it('still downloads a real path from exactly that object and mails those bytes', async () => {
    const response = await send('send-quote', REAL_PATHS.job)
    expect(response.status).toBe(200)
    expect(seen.filter((request) => request.url.startsWith('/storage/'))).toEqual([
      { method: 'GET', url: `/storage/v1/object/job-files/${REAL_PATHS.job}`, authorization: `Bearer ${SERVICE_KEY}` }
    ])
    expect(mail).toHaveLength(1)
    expect(mail[0].to).toEqual(['customer@example.test'])
    expect(Buffer.from(mail[0].attachments[0].content, 'base64').toString('utf8')).toBe(PDF_BYTES)
  })
})
