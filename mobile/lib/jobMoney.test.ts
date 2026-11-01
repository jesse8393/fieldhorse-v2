import { describe, expect, it } from 'vitest'
import { jobMoney } from './jobMoney'

describe('native job balance', () => {
  it('includes approved extras and credits while excluding unapproved changes', () => {
    expect(jobMoney({
      amount: 100.03,
      payments: [{ amount: 50.01 }],
      changeOrders: [
        { amount: 25.25, status: 'approved' }, { amount: -5.10, status: 'approved' },
        { amount: 900, status: 'draft' }, { amount: 800, status: 'rejected' },
      ],
      invoices: [{ amount: 50.01, status: 'paid' }, { amount: 900, status: 'void' }],
    })).toMatchObject({ contractTotal: 120.18, approvedCO: 20.15, balance: 70.17, invoiced: 50.01 })
  })

  it('keeps exact cents after decimal payments and does not show negative debt', () => {
    expect(jobMoney({ amount: 0.30, payments: [{ amount: 0.10 }, { amount: 0.20 }] }).balance).toBe(0)
    expect(jobMoney({ amount: 100, payments: [{ amount: 125 }] })).toMatchObject({ paid: 125, balance: 0 })
  })
})
