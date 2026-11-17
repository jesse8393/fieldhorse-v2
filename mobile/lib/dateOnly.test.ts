import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Date-only values in a US time zone: the bug shows only west of UTC.
process.env.TZ = 'America/Chicago'

const mock = vi.hoisted(() => ({ results: new Map<string, unknown>(), options: null as any, calls: [] as any[] }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: any) => { mock.options = options; return options },
  useQueryClient: () => ({ invalidateQueries: () => undefined })
}))
vi.mock('./supabase', () => ({ supabase: {
  from: (table: string) => {
    const chain: any = new Proxy({}, { get: (_t, key) => key === 'then'
      ? (resolve: any) => Promise.resolve(mock.results.get(table) ?? { data: [], error: null }).then(resolve)
      : (...args: any[]) => { mock.calls.push([table, String(key), ...args]); return chain } })
    return chain
  }
} }))

import { useAddExpense, useAddMileage, useInvoicesOverview } from './queries'
import { buildInvoiceHtml } from './invoiceHtml'

beforeEach(() => { mock.results.clear(); mock.calls = []; vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('native date-only values', () => {
  it('an expense logged at 7:30 pm is dated today, not tomorrow', async () => {
    vi.setSystemTime(new Date(2026, 10, 16, 19, 30))
    await useAddExpense()({ userId: 'user', contactId: 'job', amount: 10 })
    expect(mock.calls.find(c => c[1] === 'insert')?.[2]).toMatchObject({ expense_date: '2026-11-16' })
  })

  it('a trip logged at 7:30 pm is dated today, not tomorrow', async () => {
    vi.setSystemTime(new Date(2026, 10, 16, 19, 30))
    await useAddMileage()({ userId: 'user', contactId: 'job', miles: 12 })
    expect(mock.calls.find(c => c[1] === 'insert')?.[2]).toMatchObject({ drove_on: '2026-11-16' })
  })

  it('payments dated the 1st and on Sunday count toward this month and this week', async () => {
    vi.setSystemTime(new Date(2026, 10, 3, 12, 0)) // Tuesday, November 3
    mock.results.set('fh_payments', { data: [{ amount: 100, paid_on: '2026-11-01' }], error: null })
    useInvoicesOverview('user')
    const out = await mock.options.queryFn()
    expect(out.collectedThisMonth).toBe(100)
    expect(out.collectedThisWeek).toBe(100)
  })

  it('the customer invoice prints the payment on its own day', () => {
    const html = buildInvoiceHtml({} as any, {}, { total: 100, paid: 100, balance: 0, issuedAt: '2026-11-16', payments: [{ amount: 100, paidOn: '2026-11-16', method: 'check' }] })
    expect(html).toContain('11/16/2026')
    expect(html).not.toContain('11/15/2026')
  })
})
