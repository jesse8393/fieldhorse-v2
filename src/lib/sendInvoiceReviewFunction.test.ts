import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
let current: Record<string, any>
let siblings: Record<string, any>[]
let readError = false
const chain = (table: string) => {
  const value: any = {
    select: () => value, eq: () => value, neq: () => value, is: () => value, order: () => value, range: () => value,
    then: (resolve: (data: any) => unknown) => Promise.resolve({ data: table === 'fh_invoices' ? siblings : [], error: readError ? { message: 'offline' } : null }).then(resolve)
  }
  return value
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'sender' } }, error: null }) }, from: (table: string) => chain(table) }) }))
vi.mock('../../netlify/functions/lib/orgAccess.js', () => ({
  loadAccessibleRow: async (_db: unknown, args: any) => ({ row: args.table === 'fh_contacts' ? { id: 'job', org_id: 'org', user_id: 'sender', amount: 10000 } : current }),
  brandingUserIdFor: async () => 'sender'
}))
vi.mock('../../netlify/functions/lib/rateLimit.js', () => ({ hashIdentifier: (s: string) => s, checkRateLimit: async () => true }))
const { default: handler } = await import('../../netlify/functions/send-invoice.js')
const request = (extra = {}) => new Request('https://example.test/api/send-invoice', { method: 'POST', headers: { authorization: 'Bearer synthetic-token', 'content-type': 'application/json' }, body: JSON.stringify({ contact_id: 'job', invoice_id: 'new', sender_user_id: 'sender', recipient_email: 'customer@example.test', storage_path: 'sender/job/test.pdf', amount_due: 5000, ...extra }) })
beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://example.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-key')
  vi.stubEnv('RESEND_API_KEY', 'synthetic-resend-key')
  vi.stubEnv('SEND_EMAIL_FROM', 'billing@example.test')
  vi.stubGlobal('fetch', vi.fn())
  readError = false
  current = { id: 'new', org_id: 'org', user_id: 'sender', contact_id: 'job', client_id: 'client', title: 'Final balance', amount: 5000, status: 'draft', due_at: '2026-11-01' }
  siblings = [current]
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('invoice delivery billing checks', () => {
  it('stops overbilling before any provider call', async () => {
    siblings.push({ ...current, id: 'old', amount: 6000, status: 'paid' })
    const response = await handler(request())
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('contract_billing_exceeded')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('requires explicit review of similar drafts', async () => {
    siblings.push({ ...current, id: 'old' })
    const response = await handler(request())
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('duplicate_review_required')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('cannot use duplicate acknowledgement to bypass the contract cap', async () => {
    siblings.push({ ...current, id: 'old', amount: 7000 })
    const response = await handler(request({ duplicate_reviewed: true }))
    expect((await response.json()).error).toBe('contract_billing_exceeded')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('fails closed when the fresh invoice lookup fails', async () => {
    readError = true
    const response = await handler(request())
    expect(response.status).toBe(503)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects a stale invoice revision before provider delivery', async () => {
    current.updated_at = '2026-10-27T18:00:00Z'
    const response = await handler(request({ invoice_updated_at: '2026-10-27T17:00:00Z' }))
    expect((await response.json()).error).toBe('invoice_changed')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects mismatched job and invoice identities', async () => {
    current.contact_id = 'another-job'
    const response = await handler(request())
    expect(response.status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not bypass the tracked invoice requirement by omitting or zeroing amount_due', async () => {
    for (const amount_due of [0, undefined]) {
      const response = await handler(request({ invoice_id: null, amount_due }))
      expect((await response.json()).error).toBe('tracked_invoice_required')
    }
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects invalid invoice amounts before delivery', async () => {
    current.amount = -200
    const response = await handler(request())
    expect((await response.json()).error).toBe('invalid_invoice_amount')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('requires a tracked invoice for a positive payment request', async () => {
    const response = await handler(request({ invoice_id: null }))
    expect((await response.json()).error).toBe('tracked_invoice_required')
    expect(fetch).not.toHaveBeenCalled()
  })
})
