// What the customer invoice page asks for. The figures come from the one
// allocator the app, the PDF and the email use (allocateInvoiceDue), in
// whole cents, so the link never asks for a different amount.
import { describe, expect, it } from 'vitest'
import { publicInvoiceView } from './invoiceView.ts'
import { invoiceAmountDue } from '../../lib/invoices.ts'

const job = (amount: number | null) => ({ id: 'job-1', name: 'Dana Smith', job_title: 'Garage slab', stage: 'job', amount })
const inv = (id: string, seq: number, amount: number, status: string, extra: Record<string, unknown> = {}) => ({
  id, contact_id: 'job-1', sequence_number: seq, title: `Draw ${seq}`, amount, status,
  issued_at: '2026-11-06T12:00:00.000Z', due_at: '2026-11-21', ...extra
})

describe('the customer invoice page figures', () => {
  it('a client billed with no job owes the open invoice, not the open one less an earlier paid one', () => {
    const invoices = [
      inv('inv-1', 1, 500, 'paid', { contact_id: null, client_id: 'cl-1' }),
      inv('inv-2', 2, 1000, 'sent', { contact_id: null, client_id: 'cl-1' })
    ]
    const view = publicInvoiceView({
      contact: { id: 'cl-1', name: 'Dana Smith', stage: null, amount: 1000 },
      payments: [{ id: 'p1', contact_id: null, invoice_id: 'inv-1', amount: 500 }],
      invoices
    })
    expect(view.current?.id).toBe('inv-2')
    expect(view.amountDue).toBe(1000)
    expect(view.status).toBe('outstanding')
    expect(view.balance).toBe(1000)
    // No contract stands behind a client's own invoices.
    expect(view.showContractPosition).toBe(false)
  })

  it('a part payment on the open invoice comes off what it asks for, as the PDF does', () => {
    const invoices = [inv('inv-1', 1, 5000, 'sent')]
    const payments = [{ id: 'p1', contact_id: 'job-1', invoice_id: 'inv-1', amount: 2000 }]
    const view = publicInvoiceView({ contact: job(10000), payments, invoices })
    expect(view.amountDue).toBe(3000)
    expect(view.amountDue).toBe(invoiceAmountDue({ invoice: invoices[0], contact: job(10000) as any, payments, invoices }))
    expect(view.balance).toBe(8000)
    expect(view.status).toBe('outstanding')
  })

  it('a sent invoice on a job saved with no price is owed, not paid in full', () => {
    const view = publicInvoiceView({ contact: job(null), payments: [], invoices: [inv('inv-1', 1, 500, 'sent')] })
    expect(view.amountDue).toBe(500)
    expect(view.status).toBe('outstanding')
    expect(view.balance).toBe(500)
    expect(view.showContractPosition).toBe(false)
  })

  it('49 cents still owed is owed', () => {
    const view = publicInvoiceView({
      contact: job(5000),
      payments: [{ id: 'p1', contact_id: 'job-1', invoice_id: 'inv-1', amount: 4999.51 }],
      invoices: [inv('inv-1', 1, 5000, 'sent')]
    })
    expect(view.amountDue).toBe(0.49)
    expect(view.status).toBe('outstanding')
  })

  it('never asks for contract money that was not invoiced, and keeps the last bill as the document', () => {
    const view = publicInvoiceView({
      contact: job(10000),
      payments: [{ id: 'p1', contact_id: 'job-1', invoice_id: 'inv-1', amount: 5000 }],
      invoices: [inv('inv-1', 1, 5000, 'paid')]
    })
    expect(view.amountDue).toBe(0)
    expect(view.status).toBe('paid')
    expect(view.current).toBeNull()
    // The number and dates stay those of the bill the customer was sent.
    expect(view.shown?.id).toBe('inv-1')
    // The contract position still tells the truth about the job.
    expect(view.balance).toBe(5000)
  })

  it('uses the figure the server worked out, which also knows the unsent drafts', () => {
    const view = publicInvoiceView({
      contact: job(10000),
      payments: [{ id: 'p1', contact_id: 'job-1', invoice_id: null, amount: 2500 }],
      invoices: [inv('inv-2', 2, 5000, 'sent', { amount_due: 5000 })]
    })
    expect(view.amountDue).toBe(5000)
  })

  it('a job with no invoice rows keeps the whole job balance', () => {
    const view = publicInvoiceView({
      contact: job(10000),
      payments: [{ id: 'p1', contact_id: 'job-1', invoice_id: null, amount: 2500.25 }],
      changeOrders: [{ id: 'co', status: 'approved', amount: 100 }, { id: 'co2', status: 'sent', amount: 900 }],
      invoices: []
    })
    expect(view.amountDue).toBe(7599.75)
    expect(view.status).toBe('outstanding')
    expect(view.showContractPosition).toBe(true)
  })

  it('drafts and void rows never show or get picked as this invoice', () => {
    const view = publicInvoiceView({
      contact: job(10000),
      payments: [],
      invoices: [inv('inv-1', 1, 2500, 'draft'), inv('inv-2', 2, 2500, 'void'), inv('inv-3', 3, 5000, 'overdue')]
    })
    expect(view.rows.map((r) => r.id)).toEqual(['inv-3'])
    expect(view.current?.id).toBe('inv-3')
  })
})
