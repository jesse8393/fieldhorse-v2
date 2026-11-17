import { readFileSync, readdirSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, newFakeDb, recordingFetch, type FakeDb, type Outbound } from './functionTestDb.ts'

// The phone app shows a function's detail (then its code) as it is, so
// what our Netlify functions answer must already be a plain sentence. The
// email provider's own words and our setup notes go to the function log,
// never into the answer (raw-errors-7).

let db: FakeDb
let outbound: Outbound[] = []
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeSupabase(db) }))

const ORG = '0b0b0b0b-0000-4000-8000-000000000001'
const OWNER = 'user-owner'
const DEV_WORDS = /Bearer|Netlify|\benv\b|https?:|_KEY|Supabase|ANTHROPIC|DOCUSIGN_|access_token/
const PROVIDER_REFUSAL = { statusCode: 403, message: 'The gmail.com domain is not verified. Please, add and verify your domain on https://resend.com/domains', name: 'validation_error' }

beforeEach(() => {
  db = newFakeDb({
    organizations: [{ id: ORG, name: 'Parker Concrete' }],
    org_members: [{ id: 'm-owner', org_id: ORG, user_id: OWNER, role: 'owner', joined_at: '2026-01-01T00:00:00Z', revoked_at: null }],
    profiles: [{ user_id: OWNER, org_id: ORG, company_name: 'Parker Concrete', company_email: 'office@parker.example.test' }],
    fh_clients: [{ id: 'client-1', org_id: ORG, user_id: OWNER, name: 'Dana Smith', email: 'dana@example.test' }],
    fh_contacts: [{ id: 'job-1', org_id: ORG, user_id: OWNER, client_id: 'client-1', name: 'Dana Smith', job_title: 'Smith driveway', amount: 20000, email: 'dana@example.test', stage: 'job', proposal_status: 'approved' }],
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
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test')
  vi.stubEnv('DOCUSIGN_INTEGRATION_KEY', 'ik'); vi.stubEnv('DOCUSIGN_USER_ID', 'u'); vi.stubEnv('DOCUSIGN_ACCOUNT_ID', 'a'); vi.stubEnv('DOCUSIGN_PRIVATE_KEY', 'k')
  vi.stubEnv('URL', 'https://app.example.test')
  vi.stubGlobal('fetch', vi.fn(recordingFetch(outbound)))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function handler(name: string) {
  return (await import(`../../netlify/functions/${name}.js`)).default
}
const post = (name: string, body: unknown, token: string | null = 'tok-owner') => new Request(`https://app.example.test/api/${name}`, {
  method: 'POST',
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
  body: JSON.stringify(body)
})
// The provider refuses every send, the way Resend answers an unverified domain.
function providerRefuses() {
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    if (url.host === 'api.resend.com') return new Response(JSON.stringify(PROVIDER_REFUSAL), { status: 403 })
    return recordingFetch(outbound)(input, init)
  }))
}

const pdf = `${OWNER}/job-1/a.pdf`
const senders: Record<string, Record<string, unknown>> = {
  'send-quote': { quote_id: 'q1', sender_user_id: OWNER, recipient_email: 'dana@example.test', storage_path: pdf },
  'send-invoice': { contact_id: 'job-1', invoice_id: 'inv-2', invoice_updated_at: '2026-11-10T00:00:00Z', sender_user_id: OWNER, recipient_email: 'dana@example.test', storage_path: pdf, amount_due: 5000 },
  'send-statement': { client_id: 'client-1', sender_user_id: OWNER, recipient_email: 'dana@example.test', storage_path: pdf, total_due: 5000 },
  'send-certificate': { contact_id: 'job-1', sender_user_id: OWNER, recipient_email: 'dana@example.test', storage_path: pdf },
  'send-message': { contact_id: 'job-1', sender_user_id: OWNER, recipient_email: 'dana@example.test', subject: 'Arrival', body: 'West gate' }
}

describe('a send the email provider refuses', () => {
  for (const [name, body] of Object.entries(senders)) {
    it(`${name} answers a plain sentence and logs the provider's answer`, async () => {
      providerRefuses()
      const res = await (await handler(name))(post(name, body))
      expect(res.status).toBe(502)
      const answer = await res.json()
      expect(answer.error).toBe('send_failed')
      expect(answer.detail).toMatch(/^The (email|message) did not go out\. /)
      expect(JSON.stringify(answer)).not.toMatch(/gmail|resend\.com|verify your domain/)
      expect(answer).not.toHaveProperty('provider_status')
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('send failed'), expect.objectContaining({ status: 403, body: PROVIDER_REFUSAL }))
    })
  }

  it('partner-invite keeps the invite link and never passes on the provider text', async () => {
    providerRefuses()
    const res = await (await handler('partner-invite'))(post('partner-invite', { job_id: 'job-1', partner_email: 'sam@example.test', invited_by_user_id: OWNER, send_email: true, partner_name: 'Sam' }))
    const answer = await res.json()
    expect(answer).toMatchObject({ ok: true, sent: false, send_failed: true })
    expect(answer.invite_url).toBeTruthy()
    expect(JSON.stringify(answer)).not.toMatch(/gmail|resend\.com|verify your domain/)
    expect(console.error).toHaveBeenCalled()
  })

  it('org-invite-create keeps the invite and never passes on the provider text', async () => {
    providerRefuses()
    const res = await (await handler('org-invite-create'))(post('org-invite-create', { email: 'new@example.test', role: 'crew', org_id: ORG }))
    const answer = await res.json()
    expect(answer.email).toMatchObject({ sent: false })
    expect(JSON.stringify(answer)).not.toMatch(/gmail|resend\.com|verify your domain/)
    expect(console.error).toHaveBeenCalled()
  })
})

describe('a request with no sign in', () => {
  const needsToken: Record<string, Record<string, unknown>> = {
    claude: { messages: [{ role: 'user', content: 'hi' }] },
    'docusign-send': { contact_id: 'job-1' },
    'partner-invite': { job_id: 'job-1', partner_email: 'sam@example.test', invited_by_user_id: OWNER },
    ...senders
  }
  // send-statement answers { error: 'unauthorized' } with no words of its own.
  delete needsToken['send-statement']
  for (const [name, body] of Object.entries(needsToken)) {
    it(`${name} asks the person to sign in again in plain words`, async () => {
      const res = await (await handler(name))(post(name, body, null))
      expect(res.status).toBe(401)
      const answer = await res.json()
      expect(answer.error).toBe('missing_token')
      expect(answer.detail ?? answer.message).toBe('Sign in again, then try again.')
    })
  }
})

describe('a function missing its server settings', () => {
  it('partner-invite says invites are not available and logs which settings are missing', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    vi.stubEnv('SUPABASE_SECRET_KEY', '')
    const res = await (await handler('partner-invite'))(post('partner-invite', {}))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'server_misconfigured', detail: 'Email invites are not available right now. Try again later.' })
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('partner-invite'), expect.stringContaining('SUPABASE_SERVICE_ROLE_KEY'))
  })
})

describe('every answer our functions write', () => {
  it('names no header, hosting setting, key, address or vendor setup step', () => {
    const dir = new URL('../../netlify/functions/', import.meta.url)
    const files = [
      ...readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => new URL(f, dir)),
      ...readdirSync(new URL('lib/', dir)).filter((f) => f.endsWith('.js')).map((f) => new URL(`lib/${f}`, dir))
    ]
    const hits: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const m of source.matchAll(/\b(detail|message)\s*:\s*(['"`])((?:\\.|(?!\2)[^\\])*)\2/g)) {
        if (DEV_WORDS.test(m[3])) hits.push(`${file.pathname.split('/netlify/functions/')[1]}: ${m[3]}`)
      }
    }
    expect(hits).toEqual([])
  })
})
