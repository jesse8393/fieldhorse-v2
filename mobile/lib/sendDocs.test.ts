import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mock = vi.hoisted(() => ({ invoice: null as any, calls: [] as any[], uploads: [] as any[], fetches: [] as any[] }))
vi.mock('expo-print', () => ({ printToFileAsync: async () => ({ uri: 'file:///invoice.pdf' }) }))
vi.mock('./supabase', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
  from: (table: string) => {
    const chain: any = new Proxy({}, { get: (_t, key) => key === 'then'
      ? (resolve: any) => Promise.resolve(table === 'fh_invoices' ? { data: mock.invoice, error: null } : { data: [{ id: 'file' }], error: null }).then(resolve)
      : (...args: any[]) => { mock.calls.push([table, String(key), ...args]); return chain } })
    return chain
  },
  storage: { from: () => ({ upload: async (...args: any[]) => { mock.uploads.push(args); return { error: null } } }) }
} }))

import { sendInvoiceEmail, pickInvoiceToSend } from './sendDocs'

const invoice = { id: 'inv-2', contact_id: 'job', status: 'draft', amount: 4000, title: 'Progress', description: 'Framing', updated_at: '2026-11-16T10:00:00Z' }
const input = () => ({ html: '<p/>', filename: 'Invoice.pdf', userId: 'user', contact: { id: 'job', name: 'Pat', email: 'pat@example.com' }, invoice })

beforeEach(() => {
  mock.invoice = { ...invoice }; mock.calls = []; mock.uploads = []; mock.fetches = []
  vi.stubGlobal('fetch', async (url: string, init?: any) => {
    if (url.startsWith('file://')) return { arrayBuffer: async () => new ArrayBuffer(8) }
    mock.fetches.push([url, JSON.parse(init.body)])
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('native send invoice', () => {
  it('sends the invoice row id and the updated_at it was opened with', async () => {
    expect(await sendInvoiceEmail(input())).toEqual({ ok: true })
    expect(mock.fetches).toHaveLength(1)
    expect(mock.fetches[0][0]).toMatch(/\/api\/send-invoice$/)
    expect(mock.fetches[0][1]).toMatchObject({ contact_id: 'job', invoice_id: 'inv-2', invoice_updated_at: '2026-11-16T10:00:00Z', amount_due: 4000, description: 'Framing' })
  })

  it('a changed invoice stops before any PDF is saved', async () => {
    mock.invoice = { ...invoice, updated_at: '2026-11-16T11:00:00Z' }
    const result = await sendInvoiceEmail(input())
    expect(result.ok).toBe(false)
    expect(mock.uploads).toEqual([])
    expect(mock.calls.some(c => c[0] === 'fh_job_files')).toBe(false)
    expect(mock.fetches).toEqual([])
  })

  it('a void or missing invoice stops before any PDF is saved', async () => {
    mock.invoice = { ...invoice, status: 'void' }
    expect((await sendInvoiceEmail(input())).ok).toBe(false)
    mock.invoice = null
    expect((await sendInvoiceEmail(input())).ok).toBe(false)
    expect(mock.uploads).toEqual([])
    expect(mock.fetches).toEqual([])
  })
})

describe('choosing the invoice to send', () => {
  const rows = [
    { id: 'a', status: 'paid' }, { id: 'b', status: 'draft' }, { id: 'c', status: 'void' }
  ] as any[]
  it('uses the invoice that was opened', () => {
    expect(pickInvoiceToSend(rows, 'a')).toMatchObject({ invoice: { id: 'a' } })
  })
  it('uses the only open invoice when none was opened', () => {
    expect(pickInvoiceToSend(rows, undefined)).toMatchObject({ invoice: { id: 'b' } })
  })
  it('asks for an invoice when there is none or more than one open', () => {
    expect(pickInvoiceToSend([], undefined).invoice).toBeNull()
    expect(pickInvoiceToSend([...rows, { id: 'd', status: 'sent' }], undefined).invoice).toBeNull()
  })
})
