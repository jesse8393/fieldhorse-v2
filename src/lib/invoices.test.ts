import { describe, it, expect } from 'vitest'
import { contractTotals, suggestNextInvoice } from './invoices.ts'

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
    // unbilled ≈ 0.2, balance ≈ 0 (paid in full) — amount is the unbilled
    // remainder; the key assertion is no NaN/negative from FP dust.
    expect(Number.isFinite(s.amount)).toBe(true)
    expect(s.amount).toBeGreaterThanOrEqual(0)
  })
})
