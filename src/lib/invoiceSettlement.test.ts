import { describe, it, expect } from 'vitest'
import { allocateInvoiceDue, amountsDueByInvoice, invoicesPaidInFull, pickBalanceInvoice } from './invoiceSettlement.ts'

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

// What each open invoice still asks for (Phase 8, task 5). The numbers are
// the plan's: a $10,000 job billed as two $5,000 invoices.
const bill = (id: string, sequence_number: number, amount: number, due_at: string | null, status = 'sent') =>
  ({ id, sequence_number, amount, status, due_at, contact_id: 'job' })

describe('allocateInvoiceDue', () => {
  it('subtracts a linked payment from its own invoice and leaves the next one whole', () => {
    const due = allocateInvoiceDue({
      invoices: [bill('i1', 1, 5000, '2026-10-02', 'overdue'), bill('i2', 2, 5000, '2026-10-09')],
      payments: [{ amount: 2000, invoice_id: 'i1' }],
      contractTotal: 10000
    })
    expect(due.get('i1')).toBe(3000)
    expect(due.get('i2')).toBe(5000)
  })

  it('applies an unlinked payment to the open invoices oldest due first', () => {
    const due = allocateInvoiceDue({
      invoices: [bill('i2', 2, 5000, '2026-10-20'), bill('i1', 1, 5000, '2026-10-05')],
      payments: [{ amount: 4000 }],
      contractTotal: 10000
    })
    expect(due.get('i1')).toBe(1000)
    expect(due.get('i2')).toBe(5000)
  })

  it('settles by invoice number, as logPayment does, when a lower numbered bill is due later', () => {
    // Review of task 5: one settle order everywhere, so Money, Today and the
    // job page never disagree on which bill the money went to.
    const due = allocateInvoiceDue({
      invoices: [bill('second', 2, 5000, '2026-10-01'), bill('first', 1, 5000, '2026-10-30')],
      payments: [{ amount: 4000 }],
      contractTotal: 10000
    })
    expect(due.get('first')).toBe(1000)
    expect(due.get('second')).toBe(5000)
  })

  it('breaks a tie in invoice number by due date, then by when the row was made', () => {
    const due = allocateInvoiceDue({
      invoices: [
        { ...bill('later', 0, 5000, '2026-10-30'), created_at: '2026-09-01T12:00:00Z' },
        { ...bill('sooner', 0, 5000, '2026-10-01'), created_at: '2026-09-02T12:00:00Z' },
        { ...bill('newer', 0, 5000, null), created_at: '2026-09-03T12:00:00Z' },
        { ...bill('older', 0, 5000, null), created_at: '2026-09-02T13:00:00Z' }
      ],
      payments: [{ amount: 12000 }],
      contractTotal: 20000
    })
    expect(due.get('sooner')).toBe(0)
    expect(due.get('later')).toBe(0)
    expect(due.get('older')).toBe(3000)
    expect(due.get('newer')).toBe(5000)
  })

  it('lets an unsent draft take the money logged against the job before a later bill, as invoicesPaidInFull does', () => {
    // Review of task 5. A $3,000 deposit was logged against the job, then
    // draws were made from terms: the deposit draft is covered, so the
    // progress draw still asks for all of its $4,000. The drafts themselves
    // are not open bills and are not in the answer.
    const draws = [
      bill('d1', 1, 3000, null, 'draft'),
      bill('d2', 2, 4000, '2026-10-01'),
      bill('d3', 3, 3000, null, 'draft')
    ]
    const payments = [{ amount: 3000 }]
    const due = allocateInvoiceDue({ invoices: draws, payments, contractTotal: 10000 })
    expect([...due.keys()]).toEqual(['d2'])
    expect(due.get('d2')).toBe(4000)
    expect(invoicesPaidInFull({ invoices: draws, payments, contractTotal: 10000 })).toEqual(['d1'])
    // Marking the covered draft paid moves no money, so the draw stays whole.
    const after = allocateInvoiceDue({
      invoices: [{ ...draws[0], status: 'paid' }, draws[1], draws[2]],
      payments,
      contractTotal: 10000
    })
    expect(after.get('d2')).toBe(4000)
  })

  it('counts a viewed invoice as an open bill', () => {
    const due = allocateInvoiceDue({
      invoices: [bill('i1', 1, 5000, '2026-10-02', 'viewed')],
      payments: [{ amount: 1000 }],
      contractTotal: 10000
    })
    expect(due.get('i1')).toBe(4000)
    expect(invoicesPaidInFull({
      invoices: [bill('i1', 1, 5000, '2026-10-02', 'viewed')],
      payments: [{ amount: 5000 }],
      contractTotal: 10000
    })).toEqual(['i1'])
  })

  it('never counts money that already paid a bill marked paid', () => {
    // The first $5,000 paid invoice 1 (logPayment flipped it to paid); it
    // must not also pay invoice 2.
    const due = allocateInvoiceDue({
      invoices: [bill('i1', 1, 5000, '2026-09-20', 'paid'), bill('i2', 2, 5000, '2026-10-09')],
      payments: [{ amount: 5000 }],
      contractTotal: 10000
    })
    expect(due.get('i2')).toBe(5000)
    expect(due.has('i1')).toBe(false)
  })

  it('caps the running total of open bills at the job balance, oldest first', () => {
    const due = allocateInvoiceDue({
      invoices: [bill('i1', 1, 5000, '2026-10-02'), bill('i2', 2, 5000, '2026-10-09')],
      payments: [],
      contractTotal: 8000
    })
    expect(due.get('i1')).toBe(5000)
    expect(due.get('i2')).toBe(3000)
  })

  it('treats money linked to a void invoice as unlinked, and money linked to an unknown one as spent', () => {
    expect(allocateInvoiceDue({
      invoices: [bill('v', 1, 5000, '2026-09-01', 'void'), bill('i2', 2, 5000, '2026-10-09')],
      payments: [{ amount: 2000, invoice_id: 'v' }],
      contractTotal: 10000
    }).get('i2')).toBe(3000)
    expect(allocateInvoiceDue({
      invoices: [bill('i2', 2, 5000, '2026-10-09')],
      payments: [{ amount: 2000, invoice_id: 'elsewhere' }],
      contractTotal: 10000
    }).get('i2')).toBe(5000)
  })

  it('spills an overpayment on a linked invoice onto the next open one', () => {
    const due = allocateInvoiceDue({
      invoices: [bill('i1', 1, 5000, '2026-10-02'), bill('i2', 2, 5000, '2026-10-09')],
      payments: [{ amount: 6000, invoice_id: 'i1' }],
      contractTotal: 10000
    })
    expect(due.get('i1')).toBe(0)
    expect(due.get('i2')).toBe(4000)
  })

  it('leaves unlinked money alone when told the list is not the whole job', () => {
    const due = allocateInvoiceDue({
      invoices: [bill('i2', 2, 5000, '2026-10-09')],
      payments: [{ amount: 5000 }, { amount: 1000, invoice_id: 'i2' }],
      contractTotal: 10000,
      applyUnlinked: false
    })
    expect(due.get('i2')).toBe(4000)
  })

  it('has no cap when the contract is unknown', () => {
    const due = allocateInvoiceDue({
      invoices: [bill('i1', 1, 700, '2026-10-02')],
      payments: [],
      contractTotal: null
    })
    expect(due.get('i1')).toBe(700)
  })

  it('agrees with invoicesPaidInFull on which bills are paid', () => {
    const issued = (list: { id: string; status?: string }[], ids: string[]) =>
      ids.filter((id) => ['sent', 'viewed', 'overdue'].includes(String(list.find((inv) => inv.id === id)?.status)))
    const cases = [
      { invoices: [inv('a', 1, 5000), inv('b', 2, 5000)], payments: [{ amount: 3000 }, { amount: 3000 }], contractTotal: 10000 },
      { invoices: [inv('a', 1, 5000, 'paid'), inv('b', 2, 5000)], payments: [{ amount: 5000 }, { amount: 1000 }], contractTotal: 10000 },
      { invoices: [inv('a', 1, 5000), inv('b', 2, 5000)], payments: [{ amount: 5000, invoice_id: 'b' }], contractTotal: 10000 },
      { invoices: [inv('bal', 1, 10000)], payments: [{ amount: 3000 }, { amount: 7000 }], contractTotal: 10000 },
      // A covered deposit draft next to a sent progress draw (review of task 5).
      { invoices: [inv('d1', 1, 3000, 'draft'), inv('d2', 2, 4000), inv('d3', 3, 3000, 'draft')], payments: [{ amount: 3000 }], contractTotal: 10000 },
      { invoices: [inv('d1', 1, 3000, 'draft'), inv('d2', 2, 4000), inv('d3', 3, 3000, 'draft')], payments: [{ amount: 7000 }], contractTotal: 10000 },
      { invoices: [inv('d1', 1, 3000, 'draft'), inv('d2', 2, 4000), inv('d3', 3, 3000, 'draft')], payments: [{ amount: 3000 }, { amount: 4000, invoice_id: 'd2' }], contractTotal: 10000 },
      { invoices: [inv('d1', 1, 3000, 'paid'), inv('d2', 2, 4000), inv('d3', 3, 3000, 'draft')], payments: [{ amount: 3000 }, { amount: 2000 }], contractTotal: 10000 },
      { invoices: [inv('dep', 1, 10000, 'draft'), inv('mid', 2, 8000), inv('fin', 3, 2000, 'draft')], payments: [{ amount: 10000 }, { amount: 8000 }], contractTotal: 20000 },
      { invoices: [inv('a', 1, 5000, 'viewed'), inv('b', 2, 5000)], payments: [{ amount: 5000 }], contractTotal: 10000 }
    ]
    for (const c of cases) {
      const due = allocateInvoiceDue(c)
      const zero = [...due].filter(([, owed]) => owed === 0).map(([id]) => id)
      expect(zero.sort(), JSON.stringify(c.payments)).toEqual(issued(c.invoices, invoicesPaidInFull(c)).sort())
    }
  })
})

describe('amountsDueByInvoice', () => {
  it('allocates each job on its own', () => {
    const due = amountsDueByInvoice({
      invoices: [
        { ...bill('a1', 1, 5000, '2026-10-02'), contact_id: 'a' },
        { ...bill('b1', 1, 5000, '2026-10-02'), contact_id: 'b' }
      ],
      payments: [{ amount: 4000, contact_id: 'a' }],
      contractFor: () => 10000
    })
    expect(due.get('a1')).toBe(1000)
    expect(due.get('b1')).toBe(5000)
  })
})
