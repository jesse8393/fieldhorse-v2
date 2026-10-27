import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ historyError: null as object | null, logged: null as any, sent: 0 }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'sender', email: 'sender@example.com' } }, error: null }) },
  from: (table: string) => ({
    insert: async (row: any) => { mock.logged = row; return { error: mock.historyError } },
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === 'profiles' ? { company_name: 'Contractor' } : null }) }) }),
  }),
}) }))
vi.mock('../../netlify/functions/lib/rateLimit.js', () => ({ hashIdentifier: (value: string) => value, checkRateLimit: async () => true }))
vi.mock('../../netlify/functions/lib/orgAccess.js', () => ({
  loadAccessibleRow: async () => ({ row: { id: 'job', user_id: 'sender', org_id: 'company', name: 'Customer', job_title: 'Kitchen' } }),
  brandingUserIdFor: async () => 'sender',
}))
import sendMessage from '../../netlify/functions/send-message.js'

beforeEach(() => {
  mock.historyError = null; mock.logged = null; mock.sent = 0
  for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'SEND_EMAIL_FROM']) vi.stubEnv(name, name === 'SUPABASE_URL' ? 'https://example.supabase.co' : name === 'SEND_EMAIL_FROM' ? 'messages@example.com' : 'test')
  vi.stubGlobal('fetch', async () => { mock.sent++; return new Response(JSON.stringify({ id: 'provider-id' }), { status: 200 }) })
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const request = () => new Request('https://example.com/api/send-message', {
  method: 'POST', headers: { authorization: 'Bearer signed-in', 'Content-Type': 'application/json' },
  body: JSON.stringify({ contact_id: 'job', sender_user_id: 'sender', recipient_email: 'customer@example.com', subject: 'Arrival', body: 'West gate\n8:30 AM' }),
})

describe('email history acknowledgement', () => {
  it('records actual sent content with company and job scope', async () => {
    const response = await sendMessage(request())
    expect(await response.json()).toMatchObject({ ok: true, history_saved: true, email_id: 'provider-id' })
    expect(mock.logged).toMatchObject({ org_id: 'company', contact_id: 'job', user_id: 'sender', category: 'email', parsed: { communication: { body: 'West gate\n8:30 AM', subject: 'Arrival', status: 'sent', channel: 'email' } } })
    expect(mock.sent).toBe(1)
  })
  it('does not report a failed send when only history persistence fails', async () => {
    mock.historyError = { message: 'Database unavailable' }
    const response = await sendMessage(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, history_saved: false })
    expect(mock.sent).toBe(1)
  })
})
