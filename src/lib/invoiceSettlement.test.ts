import { describe, it, expect } from 'vitest'
import { invoicesPaidInFull, pickBalanceInvoice } from './invoiceSettlement.ts'

const inv = (id: string, sequence_number: number, amount: number, status = 'sent') =>
  ({ id, sequence_number, amount, status })

describe('invoicesPaidInFull', () => {
  it('settles a sent invoice paid in full by a payment logged against the job', () => {
    expect(invoicesPaidInFull({
      invoices: [inv('final', 1, 10000)],
      payments: [{ amount: 10000 }],
      contractTotal: 10000
    })).toEqual(['final'])
  })

  it('leaves a partially paid invoice open', () => {
    expect(invoicesPaidInFull({
      invoices: [inv('a', 1, 5000), inv('b', 2, 5000)],
      payments: [{ amount: 3000 }],
      contractTotal: 10000
    })).toEqual([])
  })

  it('pays open invoices oldest first and stops at the first it cannot cover', () => {
    expect(invoicesPaidInFull({
      invoices: [inv('b', 2, 5000), inv('a', 1, 5000)],
      payments: [{ amount: 3000 }, { amount: 3000 }],
      contractTotal: 10000
    })).toEqual(['a'])
  })

  it('honours the invoice a payment is linked to', () => {
    // The customer paid draw 2 first: draw 1 must stay open.
    expect(invoicesPaidInFull({
      invoices: [inv('a', 1, 5000), inv('b', 2, 5000)],
      payments: [{ amount: 5000, invoice_id: 'b' }],
      contractTotal: 10000
    })).toEqual(['b'])
  })

  it('spills an overpayment on a linked invoice onto the next open one', () => {
    expect(invoicesPaidInFull({
      invoices: [inv('a', 1, 5000), inv('b', 2, 5000)],
      payments: [{ amount: 10000, invoice_id: 'a' }],
      contractTotal: 10000
    })).toEqual(['a', 'b'])
  })

  it('combines linked and job level money on one invoice', () => {
    expect(invoicesPaidInFull({
      invoices: [inv('a', 1, 5000)],
      payments: [{ amount: 2000 }, { amount: 3000, invoice_id: 'a' }],
      contractTotal: 10000
    })).toEqual(['a'])
  })

  it('never reuses money that already paid an earlier invoice', () => {
    // Draw 1 was settled by the first $5,000; a later $1,000 must not
    // also settle the $5,000 draw 2.
    expect(invoicesPaidInFull({
      invoices: [inv('a', 1, 5000, 'paid'), inv('b', 2, 5000)],
      payments: [{ amount: 5000 }, { amount: 1000 }],
      contractTotal: 10000
    })).toEqual([])
  })

  it('keeps an invoice open when a row marked paid by hand already claims the money', () => {
    expect(invoicesPaidInFull({
      invoices: [inv('a', 1, 5000, 'paid'), inv('b', 2, 5000)],
      payments: [{ amount: 5000 }],
      contractTotal: 10000
    })).toEqual([])
  })

  it('settles the last open bill once the whole contract is paid, even next to a hand marked row', () => {
    expect(invoicesPaidInFull({
      invoices: [inv('a', 1, 5000, 'paid'), inv('b', 2, 5000, 'paid'), inv('c', 3, 5000)],
      payments: [{ amount: 5000, invoice_id: 'b' }, { amount: 5000 }],
      contractTotal: 10000
    })).toEqual(['c'])
  })

  it('settles a paid deposit draft while the rest of the contract is unbilled', () => {
    expect(invoicesPaidInFull({
      invoices: [inv('dep', 1, 10000, 'draft'), inv('mid', 2, 8000, 'draft'), inv('fin', 3, 2000, 'draft')],
      payments: [{ amount: 10000 }],
      contractTotal: 20000
    })).toEqual(['dep'])
    expect(invoicesPaidInFull({
      invoices: [inv('dep', 1, 10000)],
      payments: [{ amount: 10000 }],
      contractTotal: 20000
    })).toEqual(['dep'])
  })

  it('applies an earlier deposit against a bill for the unbilled contract', () => {
    const invoices = [inv('bal', 1, 10000)]
    expect(invoicesPaidInFull({ invoices, payments: [{ amount: 3000 }, { amount: 4000 }], contractTotal: 10000 })).toEqual([])
    expect(invoicesPaidInFull({ invoices, payments: [{ amount: 3000 }, { amount: 7000 }], contractTotal: 10000 })).toEqual(['bal'])
  })

  it('ignores void rows and treats money linked to them as job level', () => {
    expect(invoicesPaidInFull({
      invoices: [inv('old', 1, 5000, 'void'), inv('new', 2, 5000)],
      payments: [{ amount: 5000, invoice_id: 'old' }],
      contractTotal: 5000
    })).toEqual(['new'])
  })

  it('never settles an invoice nobody paid, even when the job has no contract amount', () => {
    expect(invoicesPaidInFull({ invoices: [inv('a', 1, 5000)], payments: [], contractTotal: 0 })).toEqual([])
    expect(invoicesPaidInFull({ invoices: [inv('a', 1, 5000)], payments: [{ amount: 5000 }], contractTotal: 0 })).toEqual(['a'])
  })

  it('does not settle extra invoices on an over invoiced job until the money is there', () => {
    const invoices = [inv('a', 1, 5000), inv('b', 2, 5000), inv('c', 3, 5000)]
    expect(invoicesPaidInFull({ invoices, payments: [], contractTotal: 10000 })).toEqual([])
    expect(invoicesPaidInFull({ invoices, payments: [{ amount: 5000 }], contractTotal: 10000 })).toEqual(['a'])
  })

  it('falls back to the invoiced total when the contract is unknown', () => {
    expect(invoicesPaidInFull({
      invoices: [inv('a', 1, 5000), inv('b', 2, 5000)],
      payments: [{ amount: 6000 }],
      contractTotal: null
    })).toEqual(['a'])
  })

  it('works in cents so float dust never blocks a settle', () => {
    expect(invoicesPaidInFull({
      invoices: [inv('a', 1, 0.3)],
      payments: [{ amount: 0.1 }, { amount: 0.2 }],
      contractTotal: 0.3
    })).toEqual(['a'])
  })

  it('skips paid, zero amount and already settled rows', () => {
    expect(invoicesPaidInFull({
      invoices: [inv('z', 1, 0), inv('p', 2, 100, 'paid')],
      payments: [{ amount: 100 }],
      contractTotal: 100
    })).toEqual([])
  })
})

describe('pickBalanceInvoice', () => {
  it('resends the oldest open issued invoice instead of minting another', () => {
    const plan = pickBalanceInvoice({
      invoices: [inv('b', 2, 4000), inv('a', 1, 5000), inv('c', 3, 1000)],
      contractTotal: 10000,
      balance: 10000
    })
    expect(plan?.invoice?.id).toBe('a')
  })

  it('prefers an issued bill over an older unsent draft', () => {
    const plan = pickBalanceInvoice({
      invoices: [inv('d', 1, 5000, 'draft'), inv('s', 2, 3000, 'overdue')],
      contractTotal: 10000,
      balance: 10000
    })
    expect(plan?.invoice?.id).toBe('s')
  })

  it('sends the oldest draft when nothing has been issued', () => {
    const plan = pickBalanceInvoice({
      invoices: [inv('d2', 2, 8000, 'draft'), inv('d1', 1, 10000, 'draft')],
      contractTotal: 18000,
      balance: 18000
    })
    expect(plan?.invoice?.id).toBe('d1')
  })

  it('mints only the unbilled part of the contract', () => {
    const plan = pickBalanceInvoice({
      invoices: [inv('a', 1, 5000, 'paid'), inv('v', 2, 2000, 'void')],
      contractTotal: 12000,
      balance: 7000
    })
    expect(plan).toEqual({ amount: 7000 })
  })

  it('bills the contract, not the balance, when a deposit was logged with no invoice', () => {
    expect(pickBalanceInvoice({ invoices: [], contractTotal: 10000, balance: 7000 })).toEqual({ amount: 10000 })
  })

  it('bills the remaining balance when everything is invoiced but money is still owed', () => {
    expect(pickBalanceInvoice({
      invoices: [inv('a', 1, 5000, 'paid'), inv('b', 2, 5000, 'paid')],
      contractTotal: 10000,
      balance: 5000
    })).toEqual({ amount: 5000 })
  })

  it('returns null when nothing is owed', () => {
    expect(pickBalanceInvoice({ invoices: [inv('a', 1, 5000, 'paid')], contractTotal: 5000, balance: 0 })).toBeNull()
  })
})
