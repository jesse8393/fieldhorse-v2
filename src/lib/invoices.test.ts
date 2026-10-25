import { describe, it, expect } from 'vitest'
import { buildInvoicePdf, contractTotals, invoiceAmountDue, invoiceDescription, invoicePdfInput, suggestNextInvoice } from './invoices.ts'

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

  // Phase 8, task 5: the reminder email asks for what the Money row shows.
  it('asks for what is left after a payment linked to this invoice', () => {
    const i1 = { id: 'i1', amount: 5000, status: 'overdue', sequence_number: 1, due_at: '2026-10-02' }
    const i2 = { id: 'i2', amount: 5000, status: 'sent', sequence_number: 2, due_at: '2026-10-09' }
    const args = {
      contact: { amount: 10000 } as any,
      payments: [{ amount: 2000, invoice_id: 'i1' }],
      invoices: [i1, i2]
    }
    expect(invoiceAmountDue({ ...args, invoice: i1 })).toBe(3000)
    expect(invoiceAmountDue({ ...args, invoice: i2 })).toBe(5000)
  })

  it('spreads money logged against the job over the job invoices it is given', () => {
    const i1 = { id: 'i1', amount: 5000, status: 'sent', sequence_number: 1, due_at: '2026-10-05' }
    const i2 = { id: 'i2', amount: 5000, status: 'sent', sequence_number: 2, due_at: '2026-10-09' }
    const args = { contact: { amount: 10000 } as any, payments: [{ amount: 4000 }], invoices: [i1, i2] }
    expect(invoiceAmountDue({ ...args, invoice: i1 })).toBe(1000)
    expect(invoiceAmountDue({ ...args, invoice: i2 })).toBe(5000)
  })

  it('subtracts a linked payment even without the job invoice list', () => {
    expect(invoiceAmountDue({
      invoice: { id: 'i1', amount: 5000 },
      contact: { amount: 10000 } as any,
      payments: [{ amount: 2000, invoice_id: 'i1' }]
    })).toBe(3000)
  })

  // Review of task 5: a job billed without a recorded contract amount has
  // no balance to cap at, so the invoice asks for its face less payments
  // instead of nothing.
  it('asks for the invoice less its payments when the job has no contract amount', () => {
    const i1 = { id: 'i1', amount: 5000, status: 'overdue', sequence_number: 1, due_at: '2026-10-02' }
    const payments = [{ amount: 2000, invoice_id: 'i1' }]
    expect(invoiceAmountDue({ invoice: i1, contact: { amount: null } as any, payments, invoices: [i1] })).toBe(3000)
    expect(invoiceAmountDue({ invoice: i1, contact: { amount: null } as any, payments })).toBe(3000)
    expect(invoiceAmountDue({ invoice: i1, contact: {} as any, payments: [] })).toBe(5000)
    // An approved change order makes the contract known again.
    expect(invoiceAmountDue({
      invoice: i1, contact: { amount: null } as any, payments: [],
      changeOrders: [{ amount: 1200, status: 'approved' }]
    })).toBe(1200)
  })
})

// Every string jsPDF drew, in order.
function pdfText(doc: any): string {
  const out: string[] = []
  for (const page of (doc.internal.pages as string[][]).slice(1)) {
    for (const op of page) {
      if (typeof op !== 'string' || !op.startsWith('BT')) continue
      for (const m of op.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)) out.push(m[1].replace(/\\([\\()])/g, '$1'))
    }
  }
  return out.join(' ')
}

// Review of task 5: the reminder email and the PDF it attaches must name
// one figure, so the PDF hero reads the same allocation as amount_due.
describe('buildInvoicePdf', () => {
  const company = { name: 'Harlow Construction Co.', address: '100 Main St', phone: '', email: 'admin@example.com' }
  const contact = { id: '6f1c9b1e-0000-4000-8000-000000000001', name: 'Rosa Delgado', amount: 10000, job_title: 'Patio pour', email: 'rosa@example.com' }
  const i1 = { id: 'i1', contact_id: contact.id, title: 'Deposit', amount: 5000, status: 'overdue', sequence_number: 1, due_at: '2026-10-02', issued_at: '2026-09-25T12:00:00Z', notes: null, description: null } as any
  const i2 = { ...i1, id: 'i2', title: 'Final', status: 'sent', sequence_number: 2, due_at: '2026-10-09' }

  it('prints what the invoice still owes after a payment linked to it in the hero', async () => {
    const result = await buildInvoicePdf({
      invoice: i1, contact, company,
      payments: [{ amount: 2000, invoice_id: 'i1' }],
      invoices: [i1, i2]
    })
    const text = pdfText(result.doc)
    expect(text).toContain('Amount due'.toUpperCase())
    expect(text).toContain('$3,000.00')
    // The line item still bills the invoice's own amount.
    expect(text).toContain('$5,000.00')
  })

  it('prints what is left after a deposit logged against the job pays the oldest bill', async () => {
    const progress = { ...i1, id: 'p1', title: 'Progress', amount: 4000, status: 'sent' }
    const result = await buildInvoicePdf({
      invoice: progress, contact, company,
      payments: [{ amount: 3000 }],
      invoices: [progress]
    })
    expect(pdfText(result.doc)).toContain('$1,000.00')
  })

  it('does not call a bill paid when the job has no contract amount', async () => {
    const result = await buildInvoicePdf({
      invoice: i1, contact: { ...contact, amount: null }, company,
      payments: [{ amount: 2000, invoice_id: 'i1' }],
      invoices: [i1]
    })
    const text = pdfText(result.doc)
    expect(text).not.toContain('Paid in full')
    expect(text).toContain('$3,000.00')
  })
})

describe('invoiceDescription', () => {
  it("prefers the invoice's own description over the job title", () => {
    expect(invoiceDescription({ description: '  Deposit for the shed slab ' } as any, { job_title: 'Slab + trench' } as any))
      .toBe('Deposit for the shed slab')
  })

  it('falls back to the job title then to Construction services', () => {
    expect(invoiceDescription({ description: '   ' } as any, { job_title: ' Slab + trench ' } as any)).toBe('Slab + trench')
    expect(invoiceDescription({ description: null } as any, { job_title: '' } as any)).toBe('Construction services')
    expect(invoiceDescription({} as any, null)).toBe('Construction services')
  })
})

// Phase 9, Task 12 (D62): an invoice with no job bills the client directly.
// Its contract is its own amount, so what it owes is its amount less its
// payments, and its PDF has no Contract position block to reconcile against.
describe('an invoice with no job', () => {
  const company = { name: 'Harlow Construction Co.', address: '100 Main St', phone: '', email: 'admin@example.com' }
  const client = { id: 'cl-1', name: 'Rosa Delgado', email: 'rosa@example.com', phone: '555-0101', address: '412 Burkitt Station Rd' }
  const invoice = {
    id: 'inv-solo', contact_id: null, client_id: 'cl-1', title: 'Gravel delivery', amount: 1200, status: 'sent',
    sequence_number: 1, due_at: '2026-10-20', issued_at: '2026-10-06T12:00:00Z', notes: null, description: 'Two loads of crusher run'
  } as any

  it('settles against itself', async () => {
    expect(invoiceAmountDue({ invoice, contact: null, payments: [{ amount: 200 }] })).toBe(1000)
    expect(invoiceAmountDue({ invoice, contact: null, payments: [{ amount: 200, invoice_id: 'inv-solo' }] })).toBe(1000)
    expect(invoiceAmountDue({ invoice, contact: null, payments: [{ amount: 1200 }] })).toBe(0)
    expect(invoiceAmountDue({ invoice, contact: null })).toBe(1200)

    const input = invoicePdfInput({ invoice, contact: null, client, company, payments: [{ amount: 200 }] })
    expect(input.showContractPosition).toBe(false)
    expect(input.contractTotal).toBeNull()
    expect(input.amountDue).toBe(1000)
    expect(input.contact.name).toBe('Rosa Delgado')
    expect(input.lineItems[0].notes).toBe('Two loads of crusher run')

    const result = await buildInvoicePdf({ invoice, contact: null, client, company, payments: [{ amount: 200 }] })
    const text = pdfText(result.doc)
    expect(text).toContain('$1,000.00')
    expect(text).toContain('Rosa Delgado')
    expect(text).not.toContain('Contract position')
    expect(text).not.toContain('Original contract')
  })

  it('keeps the Contract position block when there is a job', () => {
    const contact = { id: 'c-1', name: 'Rosa Delgado', amount: 10000, job_title: 'Patio pour' }
    const input = invoicePdfInput({ invoice: { ...invoice, contact_id: 'c-1' }, contact, company })
    expect(input.showContractPosition).toBe(true)
    expect(input.contractTotal).toBe(10000)
  })
})
