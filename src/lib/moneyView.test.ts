import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'

// These checks read the local day, week and month. Pin Central time, where
// Jesse works, so the result is the same on every machine and in CI (UTC).
// Set it as the file loads too, because the fixtures below build local
// dates before any hook runs.
const originalTz = process.env.TZ
process.env.TZ = 'America/Chicago'
beforeAll(() => { process.env.TZ = 'America/Chicago' })
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

// stages.ts builds the Supabase client on import; the view model only
// reads its pure helpers, so a stub client is enough here.
vi.mock('./supabase.ts', () => ({ supabase: {} }))

import { buildInvoiceList, buildMoneyView, classifyInvoice, invoiceDueNow, type MoneyRow } from './moneyView.ts'
import type { InvoicesBundle, QuoteRow } from './queries.ts'

// Thursday, October 8, 2026, noon. The week runs Sunday Oct 4 to Saturday Oct 10.
const NOW = new Date(2026, 9, 8, 12, 0, 0)

type InvoiceJob = InvoicesBundle['jobs'][number]
type Invoice = InvoicesBundle['invoices'][number]
type Payment = InvoicesBundle['payments'][number]

function job(partial: Partial<InvoiceJob> & { id: string }): InvoiceJob {
  return {
    user_id: 'u1',
    client_id: 'cl-1',
    name: 'Harold Wickham',
    email: 'harold@example.com',
    phone: '555-0100',
    address: '12 Elm St',
    stage: 'job',
    amount: 50000,
    cost: null,
    job_title: 'Driveway replacement',
    job_type: null,
    completed_at: null,
    created_at: new Date(2026, 8, 1).toISOString(),
    updated_at: new Date(2026, 9, 1).toISOString(),
    fh_clients: { name: 'Harold Wickham', email: 'harold@example.com', phone: '555-0100', address: '12 Elm St' },
    ...partial
  } as InvoiceJob
}

function invoice(partial: Partial<Invoice> & { id: string }): Invoice {
  return {
    contact_id: 'j1',
    user_id: 'u1',
    org_id: 'org-1',
    title: 'Progress draw 1',
    description: null,
    notes: null,
    amount: 1000,
    status: 'sent',
    sequence_number: 1,
    issued_at: new Date(2026, 9, 1).toISOString(),
    due_at: '2026-10-15',
    created_at: new Date(2026, 9, 1).toISOString(),
    updated_at: new Date(2026, 9, 1).toISOString(),
    ...partial
  } as Invoice
}

function payment(partial: Partial<Payment> & { id: string }): Payment {
  return {
    user_id: 'u1',
    org_id: 'org-1',
    contact_id: 'j1',
    invoice_id: null,
    amount: 500,
    kind: null,
    method: 'check',
    reference: null,
    paid_on: '2026-10-05',
    created_at: new Date(2026, 9, 5).toISOString(),
    ...partial
  } as Payment
}

function bundle(partial: Partial<InvoicesBundle> = {}): InvoicesBundle {
  return { jobs: [job({ id: 'j1' })], payments: [], invoices: [], changeOrders: [], ...partial }
}

function quote(partial: Partial<QuoteRow> & { id: string }): QuoteRow {
  return {
    user_id: 'u1',
    org_id: 'org-1',
    client_id: 'cl-2',
    title: 'Parking lot repour',
    amount: 46200,
    status: 'sent',
    job_id: null,
    sent_at: new Date(2026, 9, 7, 12, 0, 0).toISOString(),
    updated_at: new Date(2026, 9, 7).toISOString(),
    created_at: new Date(2026, 9, 1).toISOString(),
    fh_clients: { id: 'cl-2', name: 'MMC Properties', email: null, phone: null, address: null },
    ...partial
  } as QuoteRow
}

const COMPANY = { orgId: 'org-1', userId: 'u1' }
const build = (b: InvoicesBundle, quotes: QuoteRow[] = []) => buildMoneyView({ bundle: b, quotes, now: NOW, company: COMPANY })
const DASH = /[-–—]/

describe('week and month totals', () => {
  it('counts a payment on Sunday Oct 4 toward the week and one on Saturday Oct 3 not', () => {
    const view = build(bundle({
      payments: [
        payment({ id: 'sun', paid_on: '2026-10-04', amount: 1200 }),
        payment({ id: 'sat', paid_on: '2026-10-03', amount: 800 })
      ]
    }))
    expect(view.collectedThisWeek).toBe(1200)
    // Both fall in October.
    expect(view.monthToDate).toBe(2000)
  })

  it('keeps Saturday Oct 10 in the week and leaves Sunday Oct 11 out', () => {
    const view = build(bundle({
      payments: [
        payment({ id: 'sat', paid_on: '2026-10-10', amount: 300 }),
        payment({ id: 'next', paid_on: '2026-10-11', amount: 700 })
      ]
    }))
    expect(view.collectedThisWeek).toBe(300)
  })

  it('leaves last month out of the month to date', () => {
    const view = build(bundle({
      payments: [
        payment({ id: 'a', paid_on: '2026-09-30', amount: 900 }),
        payment({ id: 'b', paid_on: '2026-10-01', amount: 100 })
      ]
    }))
    expect(view.monthToDate).toBe(100)
  })

  it('reads a timestamp paid_on in local time', () => {
    // Sunday 8 pm Central is already Monday in UTC; it still counts as Sunday.
    const sundayEvening = new Date(2026, 9, 4, 20, 0, 0).toISOString()
    const view = build(bundle({ payments: [payment({ id: 'x', paid_on: sundayEvening, amount: 250 })] }))
    expect(view.collectedThisWeek).toBe(250)
  })
})

describe('overdue and due soon', () => {
  it('puts an invoice due yesterday in overdue with the chip 1 day overdue', () => {
    const view = build(bundle({ invoices: [invoice({ id: 'i1', due_at: '2026-10-07', amount: 1240 })] }))
    expect(view.overdue).toHaveLength(1)
    expect(view.overdue[0].chip).toEqual({ label: '1 day overdue', tone: 'danger' })
    expect(view.overdue[0].amount).toBe(1240)
    expect(view.dueSoon).toHaveLength(0)
  })

  it('says days for more than one', () => {
    const view = build(bundle({ invoices: [invoice({ id: 'i1', due_at: '2026-10-02' })] }))
    expect(view.overdue[0].chip?.label).toBe('6 days overdue')
  })

  it('puts an invoice due in 3 days in dueSoon and one due in 9 days in neither', () => {
    const view = build(bundle({
      invoices: [
        invoice({ id: 'soon', due_at: '2026-10-11', amount: 4850 }),
        invoice({ id: 'later', due_at: '2026-10-17', amount: 2960 })
      ]
    }))
    expect(view.dueSoon.map((r) => r.id)).toEqual(['soon'])
    expect(view.dueSoon[0].note).toBe('Due Oct 11')
    expect(view.dueSoon[0].chip).toBeNull()
    expect(view.overdue).toHaveLength(0)
  })

  it('treats an invoice due today as due soon, not overdue', () => {
    const view = build(bundle({ invoices: [invoice({ id: 'today', due_at: '2026-10-08' })] }))
    expect(view.overdue).toHaveLength(0)
    expect(view.dueSoon[0].note).toBe('Due today')
  })

  it('counts day 7 as due soon and day 8 as not', () => {
    const view = build(bundle({
      invoices: [
        invoice({ id: 'd7', due_at: '2026-10-15' }),
        invoice({ id: 'd8', due_at: '2026-10-16' })
      ]
    }))
    expect(view.dueSoon.map((r) => r.id)).toEqual(['d7'])
  })

  it('reads a due timestamp as its local calendar day', () => {
    // 11 pm Central on Oct 7 is Oct 8 in UTC. The due day is still Oct 7.
    const dueLate = new Date(2026, 9, 7, 23, 0, 0).toISOString()
    const view = build(bundle({ invoices: [invoice({ id: 'late', due_at: dueLate })] }))
    expect(view.overdue.map((r) => r.id)).toEqual(['late'])
    expect(view.overdue[0].chip?.label).toBe('1 day overdue')
  })

  it('never lists void, paid or draft invoices', () => {
    const view = build(bundle({
      invoices: [
        invoice({ id: 'v', status: 'void', due_at: '2026-10-01' }),
        invoice({ id: 'p', status: 'paid', due_at: '2026-10-01' }),
        invoice({ id: 'd', status: 'draft', due_at: '2026-10-01' }),
        invoice({ id: 'v2', status: 'void', due_at: '2026-10-10' }),
        invoice({ id: 'p2', status: 'paid', due_at: '2026-10-10' })
      ]
    }))
    expect(view.overdue).toHaveLength(0)
    expect(view.dueSoon).toHaveLength(0)
    expect(view.dueThisWeek).toBe(0)
  })

  it('treats a stored overdue status as an open invoice', () => {
    const view = build(bundle({ invoices: [invoice({ id: 'o', status: 'overdue', due_at: '2026-10-05' })] }))
    expect(view.overdue.map((r) => r.id)).toEqual(['o'])
  })

  it('skips an invoice with no due date and one the job has already paid off', () => {
    const view = build(bundle({
      jobs: [job({ id: 'j1', amount: 1000 })],
      payments: [payment({ id: 'p', amount: 1000, paid_on: '2026-09-01' })],
      invoices: [
        invoice({ id: 'paidoff', due_at: '2026-10-01', amount: 1000 }),
        invoice({ id: 'nodue', due_at: null, amount: 500 })
      ]
    }))
    expect(view.overdue).toHaveLength(0)
    expect(view.dueSoon).toHaveLength(0)
  })

  it('orders overdue by the oldest due date and due soon by the soonest', () => {
    const view = build(bundle({
      invoices: [
        invoice({ id: 'o2', due_at: '2026-10-06' }),
        invoice({ id: 'o1', due_at: '2026-10-01' }),
        invoice({ id: 's2', due_at: '2026-10-13' }),
        invoice({ id: 's1', due_at: '2026-10-09' })
      ]
    }))
    expect(view.overdue.map((r) => r.id)).toEqual(['o1', 'o2'])
    expect(view.dueSoon.map((r) => r.id)).toEqual(['s1', 's2'])
  })

  it('builds the row from the job and the invoice', () => {
    const view = build(bundle({ invoices: [invoice({ id: 'i1', due_at: '2026-10-07', title: 'Final balance' })] }))
    const row = view.overdue[0]
    expect(row.title).toBe('Harold Wickham')
    expect(row.subline).toContain('Driveway replacement, final balance · Invoice 1')
    expect(row.invoiceId).toBe('i1')
    expect(row.to).toBe('/jobs/j1?tab=financials')
  })
})

describe('due this week', () => {
  it('adds what is due by Saturday, overdue included, and leaves Sunday out', () => {
    const view = build(bundle({
      invoices: [
        invoice({ id: 'a', due_at: '2026-10-07', amount: 1000 }),
        invoice({ id: 'b', due_at: '2026-10-10', amount: 2000 }),
        invoice({ id: 'c', due_at: '2026-10-11', amount: 4000 })
      ]
    }))
    expect(view.dueThisWeek).toBe(3000)
  })

  it('never asks for more than the job still owes', () => {
    const view = build(bundle({
      jobs: [job({ id: 'j1', amount: 1500 })],
      invoices: [invoice({ id: 'a', due_at: '2026-10-09', amount: 2000 })]
    }))
    expect(view.dueThisWeek).toBe(1500)
    expect(view.dueSoon[0].amount).toBe(1500)
  })

  it('counts approved change orders in what the job owes', () => {
    const view = build(bundle({
      jobs: [job({ id: 'j1', amount: 1500 })],
      changeOrders: [{ contact_id: 'j1', amount: 600, status: 'approved' }] as InvoicesBundle['changeOrders'],
      invoices: [invoice({ id: 'a', due_at: '2026-10-09', amount: 2000 })]
    }))
    expect(view.dueThisWeek).toBe(2000)
  })
})

describe('waiting on approval', () => {
  it('keeps canonical quotes inside the active company even if a mixed cache includes partner rows', () => {
    const rows = [
      quote({ id: 'own' }),
      quote({ id: 'coworker', user_id: 'another-member' }),
      quote({ id: 'partner', org_id: 'org-2' }),
      quote({ id: 'unscoped', org_id: null })
    ]
    expect(build(bundle(), rows).waiting.map((row) => row.id)).toEqual(['own', 'coworker'])
    expect(buildMoneyView({ bundle: bundle(), quotes: rows, now: NOW, company: null }).waiting).toEqual([])
    expect(buildMoneyView({ bundle: bundle(), quotes: rows, now: NOW }).waiting).toEqual([])
  })

  it('uses only the signed in person’s quotes when no company is active', () => {
    const rows = [quote({ id: 'own', org_id: null }), quote({ id: 'other', user_id: 'someone-else', org_id: null })]
    const view = buildMoneyView({ bundle: bundle(), quotes: rows, now: NOW, company: { userId: 'u1', orgId: null } })
    expect(view.waiting.map((row) => row.id)).toEqual(['own'])
  })

  it('writes Sent yesterday for a quote sent 1 day ago', () => {
    const view = build(bundle(), [quote({ id: 'q1', sent_at: new Date(2026, 9, 7, 12, 0, 0).toISOString() })])
    expect(view.waiting).toHaveLength(1)
    expect(view.waiting[0].note).toBe('Sent yesterday')
    expect(view.waiting[0].amount).toBe(46200)
    expect(view.waiting[0].title).toBe('MMC Properties')
    expect(view.waiting[0].subline).toBe('Parking lot repour')
    expect(view.waiting[0].invoiceId).toBeNull()
    expect(view.waiting[0].canRemind).toBe(false)
    expect(view.waiting[0].to).toBe('/quotes/q1')
  })

  it('writes Sent 4 days ago, and a date after a week', () => {
    const view = build(bundle(), [
      quote({ id: 'q4', sent_at: new Date(2026, 9, 4, 12, 0, 0).toISOString() }),
      quote({ id: 'q9', sent_at: new Date(2026, 8, 29, 12, 0, 0).toISOString() })
    ])
    expect(view.waiting.find((r) => r.id === 'q4')?.note).toBe('Sent 4 days ago')
    expect(view.waiting.find((r) => r.id === 'q9')?.note).toBe('Sent Sep 29')
  })

  it('keeps a viewed quote waiting, as Jobs and Today do', () => {
    const view = build(bundle(), [quote({ id: 'q1', status: 'viewed', sent_at: new Date(2026, 9, 4, 12, 0, 0).toISOString() })])
    expect(view.waiting[0].note).toBe('Viewed, sent 4 days ago')
  })

  it('leaves out drafts, decided quotes and quotes already made into jobs', () => {
    const view = build(bundle(), [
      quote({ id: 'draft', status: 'draft' }),
      quote({ id: 'approved', status: 'approved' }),
      quote({ id: 'changes', status: 'changes_requested' }),
      quote({ id: 'rejected', status: 'rejected' }),
      quote({ id: 'expired', status: 'expired' }),
      quote({ id: 'lost', status: 'lost' }),
      quote({ id: 'converted', status: 'sent', job_id: 'j1' })
    ])
    expect(view.waiting).toHaveLength(0)
  })

  it('lists the quote that has waited longest first', () => {
    const view = build(bundle(), [
      quote({ id: 'new', sent_at: new Date(2026, 9, 7, 12, 0, 0).toISOString() }),
      quote({ id: 'old', sent_at: new Date(2026, 9, 2, 12, 0, 0).toISOString() }),
      quote({ id: 'unknown', sent_at: null })
    ])
    expect(view.waiting.map((r) => r.id)).toEqual(['old', 'new', 'unknown'])
    expect(view.waiting[2].note).toBe('Sent')
  })
})

describe('paid in the last 10 days', () => {
  it('lists payments from the last 10 days, newest first, with a Paid chip', () => {
    const view = build(bundle({
      invoices: [invoice({ id: 'dep', title: 'Deposit', status: 'paid' })],
      payments: [
        payment({ id: 'old', paid_on: '2026-09-27', amount: 100 }),
        payment({ id: 'edge', paid_on: '2026-09-28', amount: 6187.5, invoice_id: 'dep' }),
        payment({ id: 'new', paid_on: '2026-10-06', amount: 250 }),
        payment({ id: 'future', paid_on: '2026-10-12', amount: 999 })
      ]
    }))
    expect(view.paid.map((r) => r.id)).toEqual(['new', 'edge'])
    expect(view.paid[1].chip).toEqual({ label: 'Paid Sep 28', tone: 'success' })
    expect(view.paid[1].amount).toBe(6187.5)
    expect(view.paid[1].subline).toBe('Driveway replacement, deposit')
    expect(view.paid[0].subline).toBe('Driveway replacement')
    expect(view.paid[1].invoiceId).toBeNull()
  })
})

describe('margin', () => {
  it('averages the margin of won jobs that have a cost, as a percent', () => {
    const view = build(bundle({
      jobs: [
        job({ id: 'a', amount: 10000, cost: 7000 }),
        job({ id: 'b', amount: 20000, cost: 16000 }),
        job({ id: 'c', amount: 30000, cost: null })
      ]
    }))
    expect(view.marginPct).toBe(25)
    expect(view.marginNote).toBe('Based on 2 of 3 jobs with recorded costs')
  })

  it('is null when no job has a cost', () => {
    expect(build(bundle()).marginPct).toBeNull()
  })

  it('does not conceal a recorded loss by capping its costs', () => {
    const view = build(bundle({ jobs: [job({ id: 'a', amount: 1000, cost: 99000 })] }))
    expect(view.marginPct).toBe(-9800)
  })
})

describe('empty and edge cases', () => {
  it('gives zeros and empty lists for an empty bundle', () => {
    const view = build({ jobs: [], payments: [], invoices: [], changeOrders: [] })
    expect(view).toEqual({
      collectedThisWeek: 0,
      dueThisWeek: 0,
      monthToDate: 0,
      marginPct: null,
      marginNote: 'Based on 0 of 0 jobs with recorded costs',
      overdue: [],
      dueSoon: [],
      waiting: [],
      paid: []
    })
  })

  it('gives canRemind false for a contact without an email', () => {
    const noEmail = job({ id: 'j1', email: '', fh_clients: { name: 'Harold', email: null, phone: null, address: null } })
    const view = build(bundle({ jobs: [noEmail], invoices: [invoice({ id: 'i1', due_at: '2026-10-07' })] }))
    expect(view.overdue[0].canRemind).toBe(false)
  })

  it('finds the email on the linked client when the job has none', () => {
    const viaClient = job({ id: 'j1', email: null })
    const view = build(bundle({ jobs: [viaClient], invoices: [invoice({ id: 'i1', due_at: '2026-10-07' })] }))
    expect(view.overdue[0].canRemind).toBe(true)
  })

  it('gives canRemind true when the job has an email', () => {
    const view = build(bundle({ invoices: [invoice({ id: 'i1', due_at: '2026-10-07' })] }))
    expect(view.overdue[0].canRemind).toBe(true)
  })

  it('keeps an invoice whose job left the list, at its own amount and without a reminder', () => {
    const view = build(bundle({ jobs: [], invoices: [invoice({ id: 'i1', due_at: '2026-10-07', amount: 700 })] }))
    expect(view.overdue[0].amount).toBe(700)
    expect(view.overdue[0].title).toBe('Customer')
    expect(view.overdue[0].canRemind).toBe(false)
  })

  it('writes no hyphen, en dash or em dash in any note or chip it makes', () => {
    const view = build(
      bundle({
        invoices: [
          invoice({ id: 'o', due_at: '2026-10-02' }),
          invoice({ id: 's', due_at: '2026-10-12' }),
          invoice({ id: 'today', due_at: '2026-10-08' })
        ],
        payments: [payment({ id: 'p', paid_on: '2026-10-01' })]
      }),
      [
        quote({ id: 'q1', sent_at: new Date(2026, 9, 7, 12).toISOString() }),
        quote({ id: 'q2', status: 'viewed', sent_at: new Date(2026, 9, 3, 12).toISOString() }),
        quote({ id: 'q3', sent_at: new Date(2025, 11, 30, 12).toISOString() })
      ]
    )
    const rows: MoneyRow[] = [...view.overdue, ...view.dueSoon, ...view.waiting, ...view.paid]
    expect(rows.length).toBeGreaterThan(5)
    for (const row of rows) {
      expect(row.note).not.toMatch(DASH)
      if (row.chip) expect(row.chip.label).not.toMatch(DASH)
    }
    // A date in another year carries the year and still has no dash.
    expect(view.waiting.find((r) => r.id === 'q3')?.note).toBe('Sent Dec 30, 2025')
  })
})

describe('buildInvoiceList', () => {
  const all = bundle({
    invoices: [
      invoice({ id: 'draft', status: 'draft', due_at: null, amount: 300, title: 'Deposit' }),
      invoice({ id: 'sent', status: 'sent', due_at: '2026-10-28', amount: 400 }),
      invoice({ id: 'late', status: 'sent', due_at: '2026-10-06', amount: 500 }),
      invoice({ id: 'paid', status: 'paid', due_at: '2026-10-01', amount: 600 }),
      invoice({ id: 'void', status: 'void', due_at: '2026-10-01', amount: 700 })
    ]
  })

  it('lists every invoice in the order it came, with its status', () => {
    const rows = buildInvoiceList({ bundle: all, now: NOW })
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ['draft', 'draft'],
      ['sent', 'sent'],
      ['late', 'overdue'],
      ['paid', 'paid'],
      ['void', 'void']
    ])
  })

  it('labels each status with a word', () => {
    const rows = buildInvoiceList({ bundle: all, now: NOW })
    const label = (id: string) => rows.find((r) => r.id === id)?.chip
    expect(label('draft')).toEqual({ label: 'Draft', tone: 'neutral' })
    expect(label('sent')).toEqual({ label: 'Sent', tone: 'neutral' })
    expect(label('late')).toEqual({ label: '2 days overdue', tone: 'danger' })
    expect(label('paid')).toEqual({ label: 'Paid', tone: 'success' })
    expect(label('void')).toEqual({ label: 'Void', tone: 'neutral' })
  })

  it('shows the due date on an open invoice and none on a draft without one', () => {
    const rows = buildInvoiceList({ bundle: all, now: NOW })
    expect(rows.find((r) => r.id === 'sent')?.note).toBe('Due Oct 28')
    expect(rows.find((r) => r.id === 'draft')?.note).toBe('')
    expect(rows.find((r) => r.id === 'sent')?.invoiceId).toBe('sent')
  })

  it('writes no dashes', () => {
    for (const row of buildInvoiceList({ bundle: all, now: NOW })) {
      expect(row.note).not.toMatch(DASH)
      expect(row.chip?.label ?? '').not.toMatch(DASH)
    }
  })
})

// What each invoice actually owes (Phase 8, task 5), with the plan's
// numbers: a $10,000 job, invoice 1 for $5,000 overdue with a linked
// $2,000 payment, and invoice 2 for $5,000 due Friday Oct 9.
describe('what each invoice actually owes', () => {
  const partial = () => bundle({
    jobs: [job({ id: 'j1', amount: 10000 })],
    invoices: [
      invoice({ id: 'i2', title: 'Final', sequence_number: 2, amount: 5000, due_at: '2026-10-09' }),
      invoice({ id: 'i1', title: 'Deposit', sequence_number: 1, amount: 5000, status: 'overdue', due_at: '2026-10-02' })
    ],
    payments: [payment({ id: 'p1', invoice_id: 'i1', amount: 2000, paid_on: '2026-10-03' })]
  })

  it('shows the overdue row at what is left after its linked payment', () => {
    const view = build(partial())
    expect(view.overdue.map((r) => [r.id, r.amount])).toEqual([['i1', 3000]])
    expect(view.dueSoon.map((r) => [r.id, r.amount])).toEqual([['i2', 5000]])
  })

  it('adds the same amounts into Due this week', () => {
    expect(build(partial()).dueThisWeek).toBe(8000)
  })

  it('prefills Mark paid with what is still owed', () => {
    expect(invoiceDueNow(partial(), 'i1')).toBe(3000)
    expect(invoiceDueNow(partial(), 'i2')).toBe(5000)
  })

  it('shows the same amount in the full invoice list', () => {
    const rows = buildInvoiceList({ bundle: partial(), now: NOW })
    expect(rows.find((r) => r.id === 'i1')?.amount).toBe(3000)
  })

  it('spreads an unlinked $4,000 payment over two $5,000 invoices, oldest due first', () => {
    const view = build(bundle({
      jobs: [job({ id: 'j1', amount: 10000 })],
      invoices: [
        invoice({ id: 'i1', sequence_number: 1, amount: 5000, due_at: '2026-10-05' }),
        invoice({ id: 'i2', sequence_number: 2, amount: 5000, due_at: '2026-10-09' })
      ],
      payments: [payment({ id: 'p1', amount: 4000, paid_on: '2026-10-03' })]
    }))
    expect(view.overdue.map((r) => r.amount)).toEqual([1000])
    expect(view.dueSoon.map((r) => r.amount)).toEqual([5000])
    expect(view.dueThisWeek).toBe(6000)
  })

  it('never counts money that already paid a bill marked paid', () => {
    const view = build(bundle({
      jobs: [job({ id: 'j1', amount: 10000 })],
      invoices: [invoice({ id: 'i2', sequence_number: 2, amount: 5000, due_at: '2026-10-05' })],
      // The paid deposit sits outside the 500 row display list.
      settledInvoices: [{ id: 'i1', contact_id: 'j1', amount: 5000, status: 'paid', due_at: '2026-09-01', sequence_number: 1, created_at: '2026-08-25T12:00:00Z' }],
      payments: [payment({ id: 'p1', amount: 5000, paid_on: '2026-09-02' })]
    }))
    expect(view.overdue.map((r) => [r.id, r.amount])).toEqual([['i2', 5000]])
  })

  // Review of task 5: a job billed without a recorded contract amount has
  // no balance to cap at, so its bill asks for its face less payments.
  it('keeps a bill on a job with no contract amount', () => {
    const view = build(bundle({
      jobs: [job({ id: 'j1', amount: null })],
      invoices: [invoice({ id: 'i1', sequence_number: 1, amount: 5000, status: 'overdue', due_at: '2026-10-02' })],
      payments: [payment({ id: 'p1', invoice_id: 'i1', amount: 2000, paid_on: '2026-10-03' })]
    }))
    expect(view.overdue.map((r) => [r.id, r.amount])).toEqual([['i1', 3000]])
    expect(view.dueThisWeek).toBe(3000)
  })

  // Review of task 5: a deposit logged against the job before the draws
  // were made covers the deposit draft, so the progress draw asks for all
  // of its $4,000, as the job page's Mark paid does.
  it('lets a covered deposit draft keep the progress draw whole', () => {
    const b = bundle({
      jobs: [job({ id: 'j1', amount: 10000 })],
      invoices: [
        invoice({ id: 'd3', title: 'Final', sequence_number: 3, amount: 3000, status: 'draft', due_at: null }),
        invoice({ id: 'd2', title: 'Progress', sequence_number: 2, amount: 4000, due_at: '2026-10-01' }),
        invoice({ id: 'd1', title: 'Deposit', sequence_number: 1, amount: 3000, status: 'draft', due_at: null })
      ],
      payments: [payment({ id: 'p1', amount: 3000, paid_on: '2026-09-20' })]
    })
    expect(build(b).overdue.map((r) => [r.id, r.amount])).toEqual([['d2', 4000]])
    expect(invoiceDueNow(b, 'd2')).toBe(4000)
    expect(invoiceDueNow(b, 'd1')).toBe(0)
  })

  it('counts an old open invoice when 620 invoices outgrow the display list of 500', () => {
    // 619 paid invoices and one old open one, newest first, as the bundle
    // holds them. The display list keeps the 500 newest; the open one is
    // the oldest of all, so only the uncapped open list carries it.
    const paid = Array.from({ length: 619 }, (_, n) =>
      invoice({ id: `paid-${n}`, status: 'paid', amount: 100, due_at: '2026-09-30', created_at: new Date(2026, 8, 30, 12, 0, 0, -n).toISOString() }))
    const old = invoice({ id: 'old', title: 'Final', amount: 1240, due_at: '2025-01-15', created_at: new Date(2025, 0, 1).toISOString() })
    const all = [...paid, old]
    const view = build(bundle({
      jobs: [job({ id: 'j1', amount: 500000 })],
      invoices: all.slice(0, 500),
      openInvoices: all.filter((i) => i.status === 'sent')
    }))
    expect(all).toHaveLength(620)
    expect(view.overdue.map((r) => [r.id, r.amount])).toEqual([['old', 1240]])
    expect(view.dueThisWeek).toBe(1240)
  })
})

// The screen feeds a clock that moves while the app stays open (Phase 8,
// task 6), so the view must read every week, day and month from `now`
// alone. Payments on Monday Oct 5 and Saturday Oct 10, on another job so
// they pay nothing off the bill, sit in the week of Sunday Oct 4 to
// Saturday Oct 10.
describe('the clock rolling over', () => {
  const b = bundle({
    jobs: [job({ id: 'j1' }), job({ id: 'j2', name: 'MMC Properties', job_title: 'Parking lot repour' })],
    payments: [
      payment({ id: 'p-mon', contact_id: 'j2', amount: 500, paid_on: '2026-10-05', created_at: new Date(2026, 9, 5, 15).toISOString() }),
      payment({ id: 'p-sat', contact_id: 'j2', amount: 2000, paid_on: '2026-10-10', created_at: new Date(2026, 9, 10, 15).toISOString() })
    ],
    invoices: [invoice({ id: 'sun', amount: 1240, due_at: '2026-10-11' })]
  })

  it('counts last week\'s payments on Saturday night', () => {
    const view = buildMoneyView({ bundle: b, quotes: [], now: new Date(2026, 9, 10, 23, 59) })
    expect(view.collectedThisWeek).toBe(2500)
    // A bill due Sunday is not due by this Saturday.
    expect(view.dueThisWeek).toBe(0)
    expect(view.dueSoon.map((r) => r.note)).toEqual(['Due Oct 11'])
  })

  it('gives $0.00 collected this week on Sunday at 8 am for last week\'s payments', () => {
    const view = buildMoneyView({ bundle: b, quotes: [], now: new Date(2026, 9, 11, 8, 0) })
    expect(view.collectedThisWeek).toBe(0)
    expect(view.monthToDate).toBe(2500)
    // The same bill is now due today, and due this week.
    expect(view.dueThisWeek).toBe(1240)
    expect(view.dueSoon.map((r) => r.note)).toEqual(['Due today'])
  })
})

describe('classifyInvoice', () => {
  it('calls an issued bill overdue only once its due day has ended', () => {
    expect(classifyInvoice({ status: 'sent', due_at: '2026-10-08', amount: 900 }, 900, NOW).status).toBe('sent')
    const late = classifyInvoice({ status: 'sent', due_at: '2026-10-07', amount: 900 }, 600, NOW)
    expect(late).toMatchObject({ status: 'overdue', daysLate: 1, owed: 600 })
  })
})
