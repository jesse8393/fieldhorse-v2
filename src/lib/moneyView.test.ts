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

import { buildInvoiceList, buildMoneyView, type MoneyRow } from './moneyView.ts'
import type { InvoicesBundle, JobRow } from './queries.ts'

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

function quote(partial: Partial<JobRow> & { id: string }): JobRow {
  return {
    user_id: 'u1',
    client_id: 'cl-2',
    name: 'MMC Properties',
    phone: null,
    email: null,
    address: null,
    stage: 'quote',
    amount: 46200,
    job_title: 'Parking lot repour',
    job_type: null,
    referred_by: null,
    proposal_status: 'sent',
    follow_up_on: null,
    completed_at: null,
    quote_sent_at: new Date(2026, 9, 7, 12, 0, 0).toISOString(),
    updated_at: new Date(2026, 9, 7).toISOString(),
    created_at: new Date(2026, 9, 1).toISOString(),
    fh_clients: null,
    ...partial
  } as JobRow
}

const build = (b: InvoicesBundle, quotes: JobRow[] = []) => buildMoneyView({ bundle: b, quotes, now: NOW })
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
    expect(row.subline).toBe('Driveway replacement, final balance')
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
  it('writes Sent yesterday for a quote sent 1 day ago', () => {
    const view = build(bundle(), [quote({ id: 'q1', quote_sent_at: new Date(2026, 9, 7, 12, 0, 0).toISOString() })])
    expect(view.waiting).toHaveLength(1)
    expect(view.waiting[0].note).toBe('Sent yesterday')
    expect(view.waiting[0].amount).toBe(46200)
    expect(view.waiting[0].title).toBe('MMC Properties')
    expect(view.waiting[0].subline).toBe('Parking lot repour')
    expect(view.waiting[0].invoiceId).toBeNull()
    expect(view.waiting[0].canRemind).toBe(false)
    expect(view.waiting[0].to).toBe('/quotes/q1?tab=quote')
  })

  it('writes Sent 4 days ago, and a date after a week', () => {
    const view = build(bundle(), [
      quote({ id: 'q4', quote_sent_at: new Date(2026, 9, 4, 12, 0, 0).toISOString() }),
      quote({ id: 'q9', quote_sent_at: new Date(2026, 8, 29, 12, 0, 0).toISOString() })
    ])
    expect(view.waiting.find((r) => r.id === 'q4')?.note).toBe('Sent 4 days ago')
    expect(view.waiting.find((r) => r.id === 'q9')?.note).toBe('Sent Sep 29')
  })

  it('keeps a viewed quote waiting, as Jobs and Today do', () => {
    const view = build(bundle(), [quote({ id: 'q1', proposal_status: 'viewed', quote_sent_at: new Date(2026, 9, 4, 12, 0, 0).toISOString() })])
    expect(view.waiting[0].note).toBe('Viewed, sent 4 days ago')
  })

  it('leaves out drafts, approved quotes and other stages', () => {
    const view = build(bundle(), [
      quote({ id: 'draft', proposal_status: null }),
      quote({ id: 'approved', proposal_status: 'approved' }),
      quote({ id: 'changes', proposal_status: 'changes_requested' }),
      quote({ id: 'lead', stage: 'lead' }),
      quote({ id: 'job', stage: 'job' })
    ])
    expect(view.waiting).toHaveLength(0)
  })

  it('lists the quote that has waited longest first', () => {
    const view = build(bundle(), [
      quote({ id: 'new', quote_sent_at: new Date(2026, 9, 7, 12, 0, 0).toISOString() }),
      quote({ id: 'old', quote_sent_at: new Date(2026, 9, 2, 12, 0, 0).toISOString() }),
      quote({ id: 'unknown', quote_sent_at: null })
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
  })

  it('is null when no job has a cost', () => {
    expect(build(bundle()).marginPct).toBeNull()
  })

  it('keeps one wild cost from running away', () => {
    const view = build(bundle({ jobs: [job({ id: 'a', amount: 1000, cost: 99000 })] }))
    expect(view.marginPct).toBe(-100)
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
        quote({ id: 'q1', quote_sent_at: new Date(2026, 9, 7, 12).toISOString() }),
        quote({ id: 'q2', proposal_status: 'viewed', quote_sent_at: new Date(2026, 9, 3, 12).toISOString() }),
        quote({ id: 'q3', quote_sent_at: new Date(2025, 11, 30, 12).toISOString() })
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
