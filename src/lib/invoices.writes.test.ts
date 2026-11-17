import { describe, it, expect, vi, beforeEach } from 'vitest'

// The writes in invoices.ts against a small in-memory table store that
// applies every filter the code sends and answers selects after writes.
const fake = vi.hoisted(() => {
  const state = { tables: {} as Record<string, any[]>, failUpdates: 0 }
  function from(table: string) {
    const q = { op: 'select' as 'select' | 'insert' | 'update', filters: [] as Array<(r: any) => boolean>, single: false, patch: null as any, row: null as any }
    function run() {
      const rows = (state.tables[table] ||= [])
      if (q.op === 'insert') {
        if (rows.some((r) => r.id === q.row.id)) return { data: null, error: null }
        rows.push({ ...q.row })
        return { data: null, error: null }
      }
      const matched = rows.filter((r) => q.filters.every((f) => f(r)))
      if (q.op === 'update') {
        if (state.failUpdates > 0) { state.failUpdates--; return { data: null, error: { message: 'network' } } }
        for (const r of matched) Object.assign(r, q.patch)
        const out = matched.map((r) => ({ ...r }))
        return { data: q.single ? (out[0] ?? null) : out, error: null }
      }
      return { data: q.single ? (matched[0] ?? null) : matched.map((r) => ({ ...r })), error: null }
    }
    const api: any = {
      select: () => api,
      insert: (row: any) => { q.op = 'insert'; q.row = row; return api },
      upsert: (row: any) => { q.op = 'insert'; q.row = row; return api },
      update: (patch: any) => { q.op = 'update'; q.patch = patch; return api },
      eq: (col: string, val: any) => { q.filters.push((r) => r[col] === val); return api },
      in: (col: string, vals: any[]) => { q.filters.push((r) => vals.includes(r[col])); return api },
      order: () => api,
      range: () => api,
      maybeSingle: () => { q.single = true; return api },
      single: () => { q.single = true; return api },
      then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject)
    }
    return api
  }
  const storage = { from: () => ({ upload: async () => ({ error: null }) }) }
  return { state, supabase: { from, storage } }
})

vi.mock('./supabase.ts', () => ({ supabase: fake.supabase, authHeaders: async () => ({}) }))
vi.mock('./pdf.js', () => ({
  generateInvoice: async () => ({ doc: { output: () => new Blob(['%PDF-']) }, filename: 'Invoice.pdf' }),
  downloadPdf: () => {}
}))

const { logInvoicePayment, settleInvoiceAfterEdit, sendInvoiceEmail } = await import('./invoices.ts')

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  fake.state.failUpdates = 0
  fake.state.tables = { fh_payments: [], fh_invoices: [], fh_change_orders: [], fh_contacts: [] }
})

// M-23
describe('a payment against a void invoice', () => {
  it('is refused and books nothing', async () => {
    fake.state.tables.fh_invoices = [{ id: 'v', user_id: 'u', amount: 500, status: 'void' }]
    const res = await logInvoicePayment({ id: 'v', user_id: 'u', amount: 500, status: 'void' } as any, { amount: 500, paid_on: '2026-11-16' })
    expect(res.error).toBeTruthy()
    expect(fake.state.tables.fh_payments).toEqual([])
  })
})

describe('logInvoicePayment settles in whole cents', () => {
  it('marks an invoice paid when cents payments add up to it exactly', async () => {
    fake.state.tables.fh_invoices = [{ id: 'i', user_id: 'u', amount: 1000.07, status: 'sent' }]
    const res = await logInvoicePayment({ id: 'i', user_id: 'u', amount: 1000.07, status: 'sent' } as any, { amount: 100, paid_on: '2026-11-16', priorPayments: [{ amount: 500.04 }, { amount: 400.03 }] })
    expect(res.paid).toBe(true)
    expect(fake.state.tables.fh_invoices[0].status).toBe('paid')
  })

  it('leaves an invoice one cent short open', async () => {
    fake.state.tables.fh_invoices = [{ id: 'i', user_id: 'u', amount: 1000.07, status: 'sent' }]
    const res = await logInvoicePayment({ id: 'i', user_id: 'u', amount: 1000.07, status: 'sent' } as any, { amount: 1000.06, paid_on: '2026-11-16' })
    expect(res.paid).toBe(false)
    expect(fake.state.tables.fh_invoices[0].status).toBe('sent')
  })
})

// M-24
describe('an invoice edited down to what was already paid on it', () => {
  it('becomes paid when it bills the client directly', async () => {
    fake.state.tables.fh_invoices = [{ id: 'i', contact_id: null, user_id: 'u', amount: 500, status: 'sent' }]
    fake.state.tables.fh_payments = [{ id: 'p', contact_id: null, invoice_id: 'i', amount: 500 }]
    const res = await settleInvoiceAfterEdit({ id: 'i', contact_id: null, amount: 500, status: 'sent' } as any)
    expect(res).toEqual({ paid: true, error: null })
    expect(fake.state.tables.fh_invoices[0].status).toBe('paid')
  })

  it('becomes paid on a job when the job payments now cover it', async () => {
    fake.state.tables.fh_contacts = [{ id: 'j', amount: 10000, stage: 'job' }]
    fake.state.tables.fh_invoices = [{ id: 'i', contact_id: 'j', user_id: 'u', amount: 500, status: 'sent', sequence_number: 1 }]
    fake.state.tables.fh_payments = [{ id: 'p', contact_id: 'j', invoice_id: 'i', amount: 500 }]
    const res = await settleInvoiceAfterEdit({ id: 'i', contact_id: 'j', amount: 500, status: 'sent' } as any)
    expect(res).toEqual({ paid: true, error: null })
    expect(fake.state.tables.fh_invoices[0].status).toBe('paid')
  })

  it('stays open while money is still owed on it', async () => {
    fake.state.tables.fh_invoices = [{ id: 'i', contact_id: null, user_id: 'u', amount: 600, status: 'sent' }]
    fake.state.tables.fh_payments = [{ id: 'p', contact_id: null, invoice_id: 'i', amount: 500 }]
    const res = await settleInvoiceAfterEdit({ id: 'i', contact_id: null, amount: 600, status: 'sent' } as any)
    expect(res).toEqual({ paid: false, error: null })
    expect(fake.state.tables.fh_invoices[0].status).toBe('sent')
  })
})

// DATA-17: the status write after a payment or a send is checked, tried
// once more, and reported when it still fails.
describe('status writes after a payment or a send', () => {
  it('retries the paid flip once after a dropped connection', async () => {
    fake.state.tables.fh_invoices = [{ id: 'i', user_id: 'u', amount: 500, status: 'sent' }]
    fake.state.failUpdates = 1
    const res: any = await logInvoicePayment({ id: 'i', user_id: 'u', amount: 500, status: 'sent' } as any, { amount: 500, paid_on: '2026-11-16' })
    expect(fake.state.tables.fh_invoices[0].status).toBe('paid')
    expect(res.statusError ?? null).toBeNull()
  })

  it('reports a paid flip that failed twice', async () => {
    fake.state.tables.fh_invoices = [{ id: 'i', user_id: 'u', amount: 500, status: 'sent' }]
    fake.state.failUpdates = 2
    const res: any = await logInvoicePayment({ id: 'i', user_id: 'u', amount: 500, status: 'sent' } as any, { amount: 500, paid_on: '2026-11-16' })
    expect(res.error).toBeNull()
    expect(res.statusError).toBeTruthy()
    expect(fake.state.tables.fh_invoices[0].status).toBe('sent')
  })

  it('retries the sent flip once and reports when it still fails', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))
    const invoice = { id: 'i', contact_id: null, client_id: 'c', user_id: 'u', amount: 500, status: 'draft', sequence_number: 1, title: 'Deposit', issued_at: null, updated_at: 'x' }
    fake.state.tables.fh_invoices = [{ ...invoice }]
    fake.state.failUpdates = 1
    const ok: any = await sendInvoiceEmail({ invoice: invoice as any, contact: null, client: { id: 'c', name: 'Dana', email: 'd@x.com' }, company: {}, userId: 'u' })
    expect(ok.ok).toBe(true)
    expect(ok.statusError ?? null).toBeNull()
    expect(fake.state.tables.fh_invoices[0].status).toBe('sent')

    fake.state.tables.fh_invoices = [{ ...invoice }]
    fake.state.failUpdates = 2
    const bad: any = await sendInvoiceEmail({ invoice: invoice as any, contact: null, client: { id: 'c', name: 'Dana', email: 'd@x.com' }, company: {}, userId: 'u' })
    expect(bad.ok).toBe(true)
    expect(bad.statusError).toBeTruthy()
    vi.unstubAllGlobals()
  })
})

