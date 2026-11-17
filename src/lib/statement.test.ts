import { describe, it, expect } from 'vitest'
import { gatherStatement } from './statement.ts'

const jobs = [
  { id: 'a', job_title: 'Sidewalk', stage: 'job', amount: 1880 },
  { id: 'b', job_title: 'Driveway', stage: 'invoice', amount: 2500 },
  { id: 'c', job_title: 'Curb', stage: 'closed', amount: 1400 },
  { id: 'd', job_title: 'Paid off', stage: 'job', amount: 1000 },
  { id: 'e', job_title: 'Just a lead', stage: 'lead', amount: 5000 },
  { id: 'f', job_title: 'Lost bid', stage: 'lost', amount: 9000 }
]
const payments = [
  { contact_id: 'a', amount: 500 },
  { contact_id: 'c', amount: 500 },
  { contact_id: 'd', amount: 1000 } // fully paid → drops out
]

describe('gatherStatement', () => {
  it('rolls billing-stage jobs into per-property balances', () => {
    const { lines, totalDue } = gatherStatement(jobs, payments)
    // a: 1380, b: 2500, c: 900. d paid off, e/f wrong stage.
    expect(lines.map((l) => l.contactId)).toEqual(['b', 'a', 'c']) // sorted by balance desc
    expect(totalDue).toBe(4780)
  })

  it('carries contract + paid onto each line', () => {
    const { lines } = gatherStatement(jobs, payments)
    const a = lines.find((l) => l.contactId === 'a')!
    expect(a.contract).toBe(1880)
    expect(a.paid).toBe(500)
    expect(a.balance).toBe(1380)
  })

  it('excludes non-billing stages and fully-paid jobs', () => {
    const ids = gatherStatement(jobs, payments).lines.map((l) => l.contactId)
    expect(ids).not.toContain('d') // fully paid
    expect(ids).not.toContain('e') // lead
    expect(ids).not.toContain('f') // lost
  })

  it('handles empty inputs', () => {
    expect(gatherStatement([], [])).toEqual({ lines: [], totalDue: 0, notInvoiced: [], notInvoicedTotal: 0 })
    expect(gatherStatement(undefined, undefined)).toEqual({ lines: [], totalDue: 0, notInvoiced: [], notInvoicedTotal: 0 })
  })

  it('folds APPROVED change orders into the contract (raises what is owed)', () => {
    const cos = [
      { contact_id: 'a', amount: 500, status: 'approved' },   // +500 to a
      { contact_id: 'a', amount: 200, status: 'draft' },      // ignored (not approved)
      { contact_id: 'c', amount: -100, status: 'approved' }   // credit on c
    ]
    const { lines, totalDue } = gatherStatement(jobs, payments, cos)
    const a = lines.find((l) => l.contactId === 'a')!
    expect(a.contract).toBe(2380)  // 1880 + 500
    expect(a.balance).toBe(1880)   // 2380 - 500 paid
    const c = lines.find((l) => l.contactId === 'c')!
    expect(c.contract).toBe(1300)  // 1400 - 100 credit
    expect(c.balance).toBe(800)    // 1300 - 500 paid
    // b unchanged (no CO): 2500. total = 1880 + 2500 + 800
    expect(totalDue).toBe(5180)
  })

  it('falls back through job_title → name → address for the property label', () => {
    const { lines } = gatherStatement(
      [{ id: 'x', name: 'Acme', address: '1 Main', stage: 'job', amount: 100 }],
      []
    )
    expect(lines[0].property).toBe('Acme')
  })
})

// Audit 2026-11-16 (S05, M-13, PT-06): Total due is what is owed on issued
// invoices, by the allocator Money uses; contract money nobody has
// invoiced yet is listed apart and is not part of Total due.
describe('gatherStatement with invoices', () => {
  const jobsB = [
    { id: 'j1', job_title: 'Driveway', stage: 'job', amount: 12800 },
    { id: 'j2', job_title: 'Garage slab', stage: 'job', amount: 33100 },
    { id: 'j3', job_title: 'Old idea', stage: 'moved_quote', amount: 9000 }
  ]
  const invoicesB = [
    { id: 'i1', contact_id: 'j1', sequence_number: 1, amount: 6400, status: 'paid' },
    { id: 'i2', contact_id: 'j1', sequence_number: 2, amount: 6400, status: 'sent' },
    // Billed to the client directly (D62): no job.
    { id: 'd1', contact_id: null, sequence_number: 1, amount: 800, status: 'paid', title: 'Service call' },
    { id: 'd2', contact_id: null, sequence_number: 2, amount: 500.25, status: 'overdue', title: 'Sealing' },
    { id: 'x1', contact_id: 'j1', sequence_number: 3, amount: 999, status: 'draft' }
  ]
  const paymentsB = [
    { contact_id: 'j1', invoice_id: 'i1', amount: 6400 },
    { contact_id: null, invoice_id: 'd1', amount: 800 },
    { contact_id: null, invoice_id: 'd2', amount: 100 }
  ]

  it('totals what is owed on issued invoices, direct ones included, and keeps the unbilled contract apart', () => {
    const s = gatherStatement(jobsB, paymentsB, [], { invoices: invoicesB })
    expect(s.lines.map((l) => [l.property, l.balance])).toEqual([['Driveway', 6400], ['Sealing', 400.25]])
    expect(s.totalDue).toBe(6800.25)
    expect(s.notInvoiced.map((l) => [l.property, l.balance])).toEqual([['Garage slab', 33100]])
    expect(s.notInvoicedTotal).toBe(33100)
  })

  it('a part payment linked to an invoice comes off it, and the rest of the contract waits apart', () => {
    const s = gatherStatement(
      [{ id: 'j1', job_title: 'Patio', stage: 'job', amount: 10000 }],
      [{ contact_id: 'j1', invoice_id: 'i1', amount: 2000 }],
      [],
      { invoices: [{ id: 'i1', contact_id: 'j1', sequence_number: 1, amount: 5000, status: 'sent' }] }
    )
    expect(s.lines[0]).toMatchObject({ property: 'Patio', paid: 2000, balance: 3000 })
    expect(s.totalDue).toBe(3000)
    expect(s.notInvoiced[0]).toMatchObject({ property: 'Patio', balance: 5000 })
  })

  it('adds cents exactly', () => {
    const jobsC = ['a', 'b', 'c'].map((id, i) => ({ id, job_title: `Job ${id}`, stage: 'job', amount: [2499.5, 100.5, 100.5][i] }))
    const invoicesC = jobsC.map((j, i) => ({ id: `i${i}`, contact_id: j.id, sequence_number: 1, amount: j.amount, status: 'sent' }))
    const s = gatherStatement(jobsC, [], [], { invoices: invoicesC })
    expect(s.totalDue).toBe(2700.5)
    expect(s.notInvoicedTotal).toBe(0)
  })
})

describe('gatherStatement with what the server worked out', () => {
  it('reads amount_due when every open invoice carries it', () => {
    // A deposit logged against the job paid an unsent draft the customer
    // link never receives; only the server knows the draw owes all of itself.
    const s = gatherStatement(
      [{ id: 'j1', job_title: 'Patio', stage: 'job', amount: 10000 }],
      [{ contact_id: 'j1', invoice_id: null, amount: 2500 }],
      [],
      { invoices: [{ id: 'i2', contact_id: 'j1', sequence_number: 2, amount: 5000, status: 'sent', amount_due: 5000 }] }
    )
    expect(s.totalDue).toBe(5000)
    expect(s.notInvoicedTotal).toBe(2500)
  })
})

