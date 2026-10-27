import { describe, expect, it } from 'vitest'
import { buildMoneyReconciliation } from './moneyReconciliation.ts'
import { customerBlockers } from './customerBlockers.ts'
import { reviewInvoice } from './invoiceReview.js'
const now = new Date('2026-10-27T12:00:00')
const job = { id: 'job', client_id: 'client', name: 'Rosa', job_title: 'Foundation', stage: 'job', amount: 10000 }
const invoice = (id: string, amount: number, status = 'sent', due_at = '2026-10-20') => ({ id, client_id: 'client', contact_id: 'job', title: 'Progress draw', amount, status, due_at, sequence_number: 1 })
const bundle = (extra: Record<string, unknown> = {}): any => ({ jobs: [job], payments: [], invoices: [invoice('a', 3000), invoice('b', 2000, 'draft')], changeOrders: [], ...extra })
const balances: any[] = [{ job, amount: 10000, paid: 1000, balance: 9000, ageDays: 70, bucket: '60+', isOutstanding: true }]

describe('money reconciliation', () => {
  it('separates issued balances, overdue amounts, unsent drafts and unissued scope', () => {
    const groups = buildMoneyReconciliation(bundle({ payments: [{ invoice_id: 'a', contact_id: 'job', amount: 1000 }] }), balances, now)
    expect(Object.fromEntries(groups.map(g => [g.id, g.total]))).toMatchObject({ receivables: 2000, overdue: 2000, drafts: 2000, unbilled: 7000, '60+': 9000 })
    for (const group of groups) expect(group.total).toBe(group.rows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0) / 100)
  })
  it('includes direct customer invoices and excludes void and paid balances', () => {
    const groups = buildMoneyReconciliation(bundle({ invoices: [{ ...invoice('direct', 12.34), contact_id: null }, invoice('paid', 20, 'paid'), invoice('void', 30, 'void')] }), [], now)
    expect(groups.find(g => g.id === 'receivables')?.total).toBe(12.34)
    expect(groups.find(g => g.id === 'overdue')?.rows[0].to).toBe('/invoices/direct')
  })
  it('includes old drafts outside the invoice display window', () => {
    const groups = buildMoneyReconciliation(bundle({ invoices: [], settledInvoices: [invoice('old', 19.99, 'draft')] }), [], now)
    expect(groups.find(g => g.id === 'drafts')).toMatchObject({ total: 19.99, rows: [{ id: 'old' }] })
  })
  it('does not call a bill due today overdue', () => {
    const groups = buildMoneyReconciliation(bundle({ invoices: [invoice('today', 500, 'sent', '2026-10-27')] }), [], now)
    expect(groups.find(g => g.id === 'receivables')?.total).toBe(500)
    expect(groups.find(g => g.id === 'overdue')?.total).toBe(0)
  })
})

describe('customer blockers', () => {
  it('surfaces Today schedule signals with overdue invoice balances', () => {
    const result = customerBlockers({ clientId: 'client', jobs: [job], schedules: [{ id: 'visit', contact_id: 'job', end_at: '2026-10-26T12:00:00' }], billing: bundle(), now })
    expect(result.map(r => r.id)).toEqual(['schedule-job', 'invoice-a'])
  })
  it('does not imply other customers, completed jobs or old visits are blocked', () => {
    const result = customerBlockers({ clientId: 'other', jobs: [{ ...job, stage: 'closed' }], schedules: [{ id: 'visit', contact_id: 'job', end_at: '2026-09-26T12:00:00' }], billing: bundle({ invoices: [{ ...invoice('foreign', 500), contact_id: 'foreign', client_id: 'foreign' }] }), now })
    expect(result).toEqual([])
  })
  it('does not invent billing risks without billing permission/data', () => {
    expect(customerBlockers({ clientId: 'client', jobs: [job], schedules: [], now })).toEqual([])
  })
})

describe('invoice billing review', () => {
  it('flags equal final balances but leaves different scheduled installments understandable', () => {
    const next = invoice('new', 2500, 'draft', '2026-11-02')
    expect(reviewInvoice({ invoice: next, invoices: [invoice('a', 2500, 'sent', '2026-10-02')], contractTotal: 5000 }).duplicates).toEqual([])
    expect(reviewInvoice({ invoice: { ...next, title: 'Final balance' }, invoices: [{ ...invoice('a', 2500), title: 'Final balance' }], contractTotal: 5000 }).duplicates).toHaveLength(1)
  })
  it('ignores void replacements and other obligations', () => {
    const next = invoice('new', 5000, 'draft')
    const review = reviewInvoice({ invoice: next, invoices: [invoice('void', 5000, 'void'), { ...invoice('other', 5000), contact_id: 'elsewhere' }], contractTotal: 5000 })
    expect(review).toMatchObject({ excess: 0, available: 5000, duplicates: [] })
  })
  it('reserves drafts and paid invoices to prevent overbilling approved scope', () => {
    const review = reviewInvoice({ invoice: invoice('new', 3000, 'draft'), invoices: [invoice('first', 3000, 'paid'), invoice('second', 3000, 'draft')], contractTotal: 8000 })
    expect(review).toMatchObject({ reserved: 6000, available: 2000, proposed: 9000, excess: 1000 })
  })
  it('replaces the edited invoice without counting it twice', () => {
    const review = reviewInvoice({ invoice: invoice('same', 3000, 'draft'), invoices: [invoice('same', 2000, 'draft'), invoice('first', 2000, 'sent')], contractTotal: 5000 })
    expect(review.excess).toBe(0)
  })
  it('uses cents and does not invent a contract cap for direct billing', () => {
    expect(reviewInvoice({ invoice: invoice('new', 0.2), invoices: [invoice('first', 0.1)], contractTotal: 0.3 }).excess).toBe(0)
    expect(reviewInvoice({ invoice: { ...invoice('new', 200), contact_id: null }, contractTotal: null }).available).toBeNull()
  })
  it('invalid or negative existing invoices cannot free contract budget', () => {
    const review = reviewInvoice({ invoice: invoice('new', 6000, 'draft'), invoices: [invoice('negative', -2000), invoice('positive', 5000)], contractTotal: 10000 })
    expect(review.excess).toBe(1000)
    expect(reviewInvoice({ invoice: invoice('bad', Number.POSITIVE_INFINITY) }).invalidAmount).toBe(true)
    expect(reviewInvoice({ invoice: invoice('bad', -1) }).invalidAmount).toBe(true)
  })
  it('checks direct customer drafts only against that customer', () => {
    const next = { ...invoice('new', 200, 'draft'), contact_id: null }
    const review = reviewInvoice({ invoice: next, invoices: [{ ...next, id: 'same' }, { ...next, id: 'foreign', client_id: 'elsewhere' }] })
    expect(review.duplicates.map(i => i.id)).toEqual(['same'])
  })
})
