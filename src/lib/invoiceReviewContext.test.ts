import { beforeEach, describe, expect, it, vi } from 'vitest'
let rows: Record<string, any[]>
let failedTable: string | null = null
vi.mock('./supabase.ts', () => ({ supabase: { from: (table: string) => {
  let first = 0, last = 999
  const query: any = {
    select: () => query, eq: () => query, neq: () => query, is: () => query, order: () => query,
    range: (from: number, to: number) => { first = from; last = to; return query },
    maybeSingle: async () => ({ data: rows[table]?.[0] ?? null, error: failedTable === table ? { message: 'offline' } : null }),
    then: (resolve: (data: any) => unknown) => Promise.resolve({ data: (rows[table] ?? []).slice(first, last + 1), error: failedTable === table ? { message: 'offline' } : null }).then(resolve)
  }
  return query
} } }))
const { fetchInvoiceReviewContext } = await import('./invoiceReviewContext.ts')
beforeEach(() => { rows = { fh_contacts: [{ amount: 2000 }], fh_invoices: [], fh_change_orders: [] }; failedTable = null })
describe('fresh invoice review context', () => {
  it('reads every invoice and approved change beyond a response page', async () => {
    rows.fh_invoices = Array.from({ length: 501 }, (_, i) => ({ id: `i${i}`, amount: 1, status: 'draft' }))
    rows.fh_change_orders = Array.from({ length: 501 }, () => ({ amount: 1, status: 'approved' }))
    const result = await fetchInvoiceReviewContext('job')
    expect(result.invoices).toHaveLength(501)
    expect(result.contractTotal).toBe(2501)
  })
  it('never treats a failed approved scope read as zero', async () => {
    failedTable = 'fh_change_orders'
    await expect(fetchInvoiceReviewContext('job')).rejects.toMatchObject({ message: 'offline' })
  })
  it('rejects invalid saved scope instead of freeing budget', async () => {
    rows.fh_change_orders = [{ amount: 'Infinity', status: 'approved' }]
    await expect(fetchInvoiceReviewContext('job')).rejects.toThrow('invalid contract or approved change amounts')
  })
  it('does not invent a contract for direct customer billing', async () => {
    const result = await fetchInvoiceReviewContext(null, 'client')
    expect(result.contractTotal).toBeNull()
  })
})
