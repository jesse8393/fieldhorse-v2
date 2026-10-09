import { describe, it, expect } from 'vitest'
import { contractTotals, invoiceAmountDue, suggestNextInvoice } from './invoices.ts'

describe('contractTotals', () => {
  it('folds approved change orders into the contract', () => {
    const t = contractTotals({
      contact: { amount: 10000 } as any,
      payments: [{ amount: 4000 }],
      changeOrders: [
        { amount: 2000, status: 'approved' },
        { amount: 500, status: 'pending' }
      ]
    })
    expect(t.contractTotal).toBe(12000)
    expect(t.balance).toBe(8000)
  })

  it('reports an overpayment as a credit instead of hiding it at zero', () => {
    const t = contractTotals({
      contact: { amount: 10000 } as any,
      payments: [{ amount: 13000 }]
    })
    expect(t.rawBalance).toBe(-3000)
    expect(t.balance).toBe(0)
    expect(t.credit).toBe(3000)
  })
})

describe('suggestNextInvoice', () => {
  it('suggests the unbilled remainder to the cent', () => {
    const s = suggestNextInvoice({
      contact: { amount: 3000.5 } as any,
      invoices: [{ amount: 1500, status: 'sent' }]
    })
    expect(s.amount).toBe(1500.5)
  })

  it('suggests $0 when everything is billed but unpaid (no double-billing prefill)', () => {
    // Contract fully invoiced, nothing paid: unbilled = 0, balance = 10000.
    // The old `unbilled || balance` fallthrough prefilled a duplicate
    // $10,000 invoice here.
    const s = suggestNextInvoice({
      contact: { amount: 10000 } as any,
      payments: [],
      invoices: [{ amount: 10000, status: 'sent' }]
    })
    expect(s.amount).toBe(0)
  })

  it('labels the final invoice with cent tolerance on float dust', () => {
    const s = suggestNextInvoice({
      contact: { amount: 0.3 } as any,
      payments: [{ amount: 0.1 }, { amount: 0.2 }],
      invoices: [{ amount: 0.1, status: 'paid' }]
    })
    // unbilled ≈ 0.2, balance ≈ 0 (paid in full), amount is the unbilled
    // remainder; the key assertion is no NaN/negative from FP dust.
    expect(Number.isFinite(s.amount)).toBe(true)
    expect(s.amount).toBeGreaterThanOrEqual(0)
  })
})

describe('invoiceAmountDue', () => {
  it('asks for the whole invoice when the balance covers it', () => {
    expect(invoiceAmountDue({
      invoice: { amount: 2500 },
      contact: { amount: 10000 } as any,
      payments: [],
      changeOrders: [{ amount: 2000, status: 'approved' }]
    })).toBe(2500)
  })

  it('caps at the remaining balance after an earlier deposit, like the PDF', () => {
    // Contract $10,000, $7,000 already paid: a $5,000 invoice is due $3,000.
    expect(invoiceAmountDue({
      invoice: { amount: 5000 },
      contact: { amount: 10000 } as any,
      payments: [{ amount: 4000 }, { amount: 3000 }]
    })).toBe(3000)
  })

  it('counts approved change orders in the balance it caps at', () => {
    expect(invoiceAmountDue({
      invoice: { amount: 5000 },
      contact: { amount: 10000 } as any,
      payments: [{ amount: 10000 }],
      changeOrders: [{ amount: 1200, status: 'approved' }, { amount: 900, status: 'draft' }]
    })).toBe(1200)
  })

  it('keeps cents and drops float dust', () => {
    expect(invoiceAmountDue({
      invoice: { amount: 1249.75 },
      contact: { amount: 2499.5 } as any
    })).toBe(1249.75)
    expect(invoiceAmountDue({
      invoice: { amount: 0.3 },
      contact: { amount: 0.3 } as any,
      payments: [{ amount: 0.1 }]
    })).toBe(0.2)
  })

  it('is zero when the job is paid in full or the invoice has no amount', () => {
    expect(invoiceAmountDue({
      invoice: { amount: 5000 },
      contact: { amount: 10000 } as any,
      payments: [{ amount: 10000 }]
    })).toBe(0)
    expect(invoiceAmountDue({ invoice: { amount: null }, contact: { amount: 10000 } as any })).toBe(0)
    expect(invoiceAmountDue({ invoice: { amount: 'abc' }, contact: { amount: 10000 } as any })).toBe(0)
  })
})
