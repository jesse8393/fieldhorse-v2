import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { buildHomeDashboardBundle, coverPhotoJobIds, homeCoversKey, type HomeDashboardSource } from './homeDashboard.ts'

// These checks read the local hour, day or week. Pin Central time, where
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

function baseSource(overrides: Partial<HomeDashboardSource> = {}): HomeDashboardSource {
  return {
    now: new Date('2026-06-18T12:00:00.000Z'),
    contacts: [],
    overdueSchedules: [],
    payments: [],
    todaySchedules: [],
    tomorrowSchedules: [],
    photoUrlByJob: {},
    leads: [],
    quotes: [],
    sentChangeOrders: [],
    openInvoices: [],
    approvedChangeOrders: [],
    ...overrides,
  }
}

type Lead = HomeDashboardSource['leads'][number]
type Quote = HomeDashboardSource['quotes'][number]

function lead(partial: Partial<Lead> & { id: string }): Lead {
  return {
    client_id: 'cl-1', title: 'Driveway', status: 'open', follow_up_on: null, last_contact: null,
    created_at: '2026-06-01T12:00:00.000Z', updated_at: '2026-06-01T12:00:00.000Z',
    fh_clients: { name: 'Lead client' }, ...partial,
  }
}

function quote(partial: Partial<Quote> & { id: string }): Quote {
  return {
    client_id: 'cl-1', title: 'Patio', status: 'draft', amount: 0, job_id: null, sent_at: null,
    change_request_note: null, change_requested_at: null,
    created_at: '2026-06-01T12:00:00.000Z', updated_at: '2026-06-01T12:00:00.000Z',
    fh_clients: { name: 'Quote client' }, ...partial,
  }
}

describe('buildHomeDashboardBundle', () => {
  it('creates a next action for invoices past due via due_at', () => {
    const bundle = buildHomeDashboardBundle(baseSource({
      contacts: [{
        id: 'job-1',
        name: 'Main bath remodel',
        amount: 12000,
        stage: 'job',
        created_at: '2026-06-01T12:00:00.000Z',
        updated_at: '2026-06-01T12:00:00.000Z',
        completed_at: null,
        follow_up_on: null,
        proposal_status: null,
      }],
      openInvoices: [{
        id: 'invoice-1',
        contact_id: 'job-1',
        title: 'Final draw',
        amount: 4500,
        due_at: '2026-06-10T12:00:00.000Z',
        status: 'sent',
      }],
    }))

    const action = bundle.nextActions.find((row) => row.kind === 'inv-overdue')
    expect(action).toMatchObject({
      id: 'inv-overdue-invoice-1',
      contactId: 'job-1',
      contactName: 'Main bath remodel',
      contactAmount: 4500,
      urgencyTone: 'danger',
      urgencyLabel: 'Past due',
      tab: 'financials',
      intent: 'nudge_invoice',
    })
    expect(action?.title).toBe('Invoice 8d past due')
    expect(action?.detail).toContain('Final draw')
  })

  it('dedupes contacts before calculating dashboard totals', () => {
    const job = {
      id: 'job-1',
      name: 'Kitchen job',
      amount: 10000,
      stage: 'job',
      created_at: '2026-06-01T12:00:00.000Z',
      updated_at: '2026-06-01T12:00:00.000Z',
      completed_at: null,
      follow_up_on: null,
      proposal_status: null,
    }
    const bundle = buildHomeDashboardBundle(baseSource({ contacts: [job, { ...job, name: 'Kitchen job duplicate' }] }))

    expect(bundle.pipeline).toBe(10000)
    expect(bundle.stageBreakdown.active).toBe(1)
    expect(bundle.stageRail.find((row) => row.key === 'job')).toEqual({ key: 'job', count: 1, total: 10000 })
  })

  // Task 15: Needs an answer reads fh_leads and fh_quotes. A lead is due
  // by its follow_up_on; a quote sent or viewed and quiet for 7 days is
  // waiting on a nudge; a quote sent two days ago is left alone.
  it('Needs an answer lists a lead whose follow up is due and a quote quiet for 7 days', () => {
    const bundle = buildHomeDashboardBundle(baseSource({
      leads: [
        lead({ id: 'lead-1', follow_up_on: '2026-06-15', fh_clients: { name: 'Rosa Delgado', phone: '6155550101' } }),
        // Quoted already: the quote carries the follow up now.
        lead({ id: 'lead-2', status: 'quoted', follow_up_on: '2026-06-10', fh_clients: { name: 'Quoted lead' } }),
        // Not due yet.
        lead({ id: 'lead-3', follow_up_on: '2026-06-19', fh_clients: { name: 'Later lead' } }),
      ],
      quotes: [
        quote({ id: 'quote-1', status: 'sent', amount: 9000, sent_at: '2026-06-09T12:00:00.000Z', updated_at: '2026-06-09T12:00:00.000Z', fh_clients: { name: 'Marcus Bell' } }),
        quote({ id: 'quote-2', status: 'viewed', amount: 4000, sent_at: '2026-06-16T12:00:00.000Z', updated_at: '2026-06-16T12:00:00.000Z', fh_clients: { name: 'Fresh quote' } }),
      ],
    }))

    expect(bundle.nextActions.map((row) => row.id)).toEqual(['followup-due-lead-1', 'followup-quote-1'])
    expect(bundle.nextActions[0]).toMatchObject({
      kind: 'followup-due',
      recordKind: 'lead',
      recordId: 'lead-1',
      contactId: '',
      verb: 'Call',
      contactName: 'Rosa Delgado',
      title: 'Call Rosa Delgado',
      detail: 'Follow up 3d overdue',
      urgencyTone: 'danger',
      intent: 'follow_up',
    })
    expect(bundle.nextActions[1]).toMatchObject({
      kind: 'followup',
      recordKind: 'quote',
      recordId: 'quote-1',
      contactName: 'Marcus Bell',
      contactAmount: 9000,
      detail: 'Quote waiting 9 days',
      intent: 'quote_followup',
    })
    expect(bundle.nextActionsTotal).toBe(2)
    expect(bundle.dealsAtRisk).toEqual({ count: 2, value: 9000, followUps: 1, quotesAttention: 1 })
  })

  it('missing phone repair keeps due leads in the same urgency order', () => {
    const leads = [
      lead({ id: 'older', follow_up_on: '2026-06-10', fh_clients: { name: 'Rosa', phone: null } }),
      lead({ id: 'recent', follow_up_on: '2026-06-17', fh_clients: { name: 'Marcus', phone: '6155550101' } })
    ]
    const actions = buildHomeDashboardBundle(baseSource({ leads })).nextActions
    const callable = buildHomeDashboardBundle(baseSource({ leads: leads.map((row) => ({ ...row, fh_clients: { ...row.fh_clients!, phone: '6155550101' } })) })).nextActions
    expect(actions[0]).toMatchObject({ id: 'followup-due-older', verb: 'Add phone', title: 'Add phone for Rosa', clientId: 'cl-1', contactPhone: null })
    expect(actions[1]).toMatchObject({ id: 'followup-due-recent', verb: 'Call', title: 'Call Marcus' })
    expect(actions.map(({ id, urgency, urgencyTone, dueIso }) => ({ id, urgency, urgencyTone, dueIso })))
      .toEqual(callable.map(({ id, urgency, urgencyTone, dueIso }) => ({ id, urgency, urgencyTone, dueIso })))
  })

  it('the stage rail is four counts: leads, quotes, jobs and invoices due', () => {
    const bundle = buildHomeDashboardBundle(baseSource({
      contacts: [{
        id: 'job-1', name: 'Deck', amount: 25000, stage: 'job',
        created_at: '2026-05-01T12:00:00.000Z', updated_at: '2026-06-01T12:00:00.000Z',
        completed_at: null, follow_up_on: null, proposal_status: null,
      }],
      leads: [lead({ id: 'lead-1' }), lead({ id: 'lead-2', status: 'lost' })],
      quotes: [
        quote({ id: 'quote-1', status: 'sent', amount: 9000 }),
        quote({ id: 'quote-2', status: 'draft', amount: 1500 }),
        // Made into a job: it is counted as the job now.
        quote({ id: 'quote-3', status: 'approved', amount: 25000, job_id: 'job-1' }),
        quote({ id: 'quote-4', status: 'lost', amount: 800 }),
      ],
      openInvoices: [
        { id: 'inv-1', contact_id: 'job-1', title: 'Deposit', amount: 5000, due_at: '2026-06-30', status: 'sent' },
      ],
      payments: [{ contact_id: 'job-1', invoice_id: 'inv-1', amount: 2000, created_at: '2026-06-11T12:00:00.000Z', paid_on: '2026-06-11' }],
    }))
    expect(bundle.stageRail).toEqual([
      { key: 'lead', count: 1, total: 0 },
      { key: 'quote', count: 2, total: 10500 },
      { key: 'job', count: 1, total: 25000 },
      { key: 'invoice', count: 1, total: 3000 },
    ])
    expect(bundle.pipeline).toBe(35500)
  })

  it('puts customer quote changes at the front of the owner queue', () => {
    const bundle = buildHomeDashboardBundle(baseSource({
      quotes: [quote({
        id: 'quote-change-1',
        status: 'changes_requested',
        amount: 18000,
        sent_at: '2026-06-01T10:00:00.000Z',
        updated_at: '2026-06-01T10:00:00.000Z',
        change_request_note: 'Please separate the cabinet allowance.',
        change_requested_at: '2026-06-18T10:00:00.000Z',
        fh_clients: { name: 'Kitchen client' },
      })],
    }))

    expect(bundle.nextActions[0]).toMatchObject({
      kind: 'quote-changes',
      recordKind: 'quote',
      recordId: 'quote-change-1',
      verb: 'Review',
      contactName: 'Kitchen client',
      detail: 'Please separate the cabinet allowance.',
      urgencyTone: 'danger',
      tab: 'quote',
      intent: 'review_quote_changes',
    })
    expect(bundle.dealsAtRisk.quotesAttention).toBe(1)
    // The quiet quote rule does not list it a second time.
    expect(bundle.nextActions.filter((row) => row.recordId === 'quote-change-1')).toHaveLength(1)
  })

  it('routes change order actions to the change orders tab', () => {
    const bundle = buildHomeDashboardBundle(baseSource({
      contacts: [{
        id: 'job-1', name: 'Patio', amount: 9000, stage: 'job',
        created_at: '2026-06-01T12:00:00.000Z', updated_at: '2026-06-17T12:00:00.000Z',
        completed_at: null, follow_up_on: null, proposal_status: null,
      }],
      sentChangeOrders: [{
        id: 'co-1', contact_id: 'job-1', sequence_number: 2, title: 'Drainage add', amount: 1250,
        updated_at: '2026-06-12T12:00:00.000Z',
      }],
    }))
    expect(bundle.nextActions.find((row) => row.kind === 'co-unsigned')).toMatchObject({
      recordKind: 'job',
      recordId: 'job-1',
      contactId: 'job-1',
      tab: 'change_orders',
      intent: 'change_order_followup',
    })
  })

  it('does not chase invoices on jobs already paid in full, whenever they were paid', () => {
    const bundle = buildHomeDashboardBundle(baseSource({
      contacts: [{
        id: 'job-1',
        name: 'Deck build',
        amount: 25000,
        stage: 'job',
        created_at: '2026-05-01T12:00:00.000Z',
        updated_at: '2026-06-01T12:00:00.000Z',
        completed_at: '2026-05-20T12:00:00.000Z',
        follow_up_on: null,
        proposal_status: null,
      }],
      // Paid in full weeks before the current week's Sunday.
      payments: [{ contact_id: 'job-1', amount: 25000, created_at: '2026-05-21T12:00:00.000Z', paid_on: '2026-05-21' }],
    }))
    expect(bundle.nextActions.find((row) => row.kind === 'invoice')).toBeUndefined()
    const health = bundle.jobHealth.find((row) => row.id === 'job-1')
    expect(health?.billing).toBe('Paid')
  })

  it('chases the remaining balance, not the full contract', () => {
    const bundle = buildHomeDashboardBundle(baseSource({
      contacts: [{
        id: 'job-1',
        name: 'Deck build',
        amount: 25000,
        stage: 'job',
        created_at: '2026-05-01T12:00:00.000Z',
        updated_at: '2026-06-01T12:00:00.000Z',
        completed_at: '2026-05-20T12:00:00.000Z',
        follow_up_on: null,
        proposal_status: null,
      }],
      payments: [{ contact_id: 'job-1', amount: 20000, created_at: '2026-05-21T12:00:00.000Z', paid_on: '2026-05-21' }],
    }))
    const action = bundle.nextActions.find((row) => row.kind === 'invoice')
    expect(action?.contactAmount).toBe(5000)
    expect(action?.detail).toBe('$5,000 owed')
  })

  it('counts weekly collections by paid_on, and only within the current week', () => {
    const bundle = buildHomeDashboardBundle(baseSource({
      // now = Thursday 2026-06-18; week starts Sunday 2026-06-14.
      payments: [
        { contact_id: 'a', amount: 3000, created_at: '2026-06-16T12:00:00.000Z', paid_on: '2026-06-16' },
        // Logged this week but backdated to last month, not this week's money.
        { contact_id: 'b', amount: 900, created_at: '2026-06-16T12:00:00.000Z', paid_on: '2026-05-02' },
        { contact_id: 'c', amount: 500, created_at: '2026-04-01T12:00:00.000Z', paid_on: '2026-04-01' },
      ],
    }))
    expect(bundle.invoicingWeek).toBe(3000)
  })

  it('folds approved change orders into job-health balances', () => {
    const bundle = buildHomeDashboardBundle(baseSource({
      contacts: [{
        id: 'job-1',
        name: 'Garage',
        amount: 10000,
        stage: 'job',
        created_at: '2026-05-01T12:00:00.000Z',
        updated_at: '2026-06-01T12:00:00.000Z',
        completed_at: '2026-06-01T12:00:00.000Z',
        follow_up_on: null,
        proposal_status: null,
      }],
      payments: [{ contact_id: 'job-1', amount: 10000, created_at: '2026-06-02T12:00:00.000Z', paid_on: '2026-06-02' }],
      approvedChangeOrders: [{ contact_id: 'job-1', amount: 2000, status: 'approved' }],
    }))
    const health = bundle.jobHealth.find((row) => row.id === 'job-1')
    expect(health?.billing).toBe('Outstanding') // the $2K CO is still owed
  })

  it('keeps every next action ordered by urgency so See all reaches the full queue', () => {
    // 25 leads with follow ups 10 to 34 days overdue; the most overdue is
    // the most urgent.
    const leads = Array.from({ length: 25 }, (_, i) => lead({
      id: `lead-${i + 1}`,
      follow_up_on: new Date(Date.parse('2026-06-08T12:00:00.000Z') - i * 86400000).toISOString().slice(0, 10),
      fh_clients: { name: `Lead ${i + 1}` },
    }))
    const bundle = buildHomeDashboardBundle(baseSource({ leads }))
    expect(bundle.nextActionsTotal).toBe(25)
    expect(bundle.nextActions).toHaveLength(25)
    expect(bundle.nextActions[0].recordId).toBe('lead-25')
    expect(bundle.nextActions[19].recordId).toBe('lead-6')
    expect(bundle.nextActions[24].recordId).toBe('lead-1')
  })
})

describe('today and tomorrow on site', () => {
  it('carries the address, the job title and tomorrow from the source', () => {
    const bundle = buildHomeDashboardBundle(baseSource({
      todaySchedules: [{
        id: 'visit-1',
        contact_id: 'job-1',
        start_at: '2026-06-18T12:30:00.000Z',
        end_at: '2026-06-18T16:00:00.000Z',
        title: 'Pour slab, crew A',
        fh_contacts: { name: 'Whitcomb', stage: 'job', address: '2210 Ridgecrest Dr', job_title: 'Garage slab' },
      }],
      tomorrowSchedules: [{
        id: 'visit-2',
        contact_id: 'job-2',
        start_at: '2026-06-19T14:00:00.000Z',
        end_at: null,
        title: null,
        fh_contacts: { name: 'Castellanos', stage: 'lead', address: null, job_title: 'Pool deck' },
      }],
    }))

    expect(bundle.todayOnSite).toEqual([{
      id: 'visit-1',
      contactId: 'job-1',
      title: 'Pour slab, crew A',
      clientName: 'Whitcomb',
      stage: 'job',
      startAt: '2026-06-18T12:30:00.000Z',
      endAt: '2026-06-18T16:00:00.000Z',
      address: '2210 Ridgecrest Dr',
      jobTitle: 'Garage slab',
    }])
    expect(bundle.tomorrowOnSite).toEqual([{
      id: 'visit-2',
      contactId: 'job-2',
      title: 'Castellanos',
      clientName: 'Castellanos',
      stage: 'lead',
      startAt: '2026-06-19T14:00:00.000Z',
      endAt: null,
      address: null,
      jobTitle: 'Pool deck',
    }])
  })

  it('reads the job from the contact rows when a visit has no embedded contact', () => {
    const bundle = buildHomeDashboardBundle(baseSource({
      contacts: [{
        id: 'job-1',
        name: 'Plumbing Bellevue',
        amount: 33100,
        stage: 'job',
        created_at: '2026-06-01T12:00:00.000Z',
        updated_at: '2026-06-17T12:00:00.000Z',
        completed_at: null,
        follow_up_on: null,
        proposal_status: null,
        address: '412 Burkitt Station Rd',
        job_title: 'Slab and trench',
      }],
      todaySchedules: [{
        id: 'visit-1',
        contact_id: 'job-1',
        start_at: '2026-06-18T14:00:00.000Z',
        end_at: '2026-06-18T18:00:00.000Z',
        title: 'Pour slab',
        fh_contacts: null,
      }],
    }))

    expect(bundle.todayOnSite[0]).toMatchObject({
      clientName: 'Plumbing Bellevue',
      stage: 'job',
      address: '412 Burkitt Station Rd',
      jobTitle: 'Slab and trench',
    })
    expect(bundle.tomorrowOnSite).toEqual([])
  })
})

// Today's overdue rule is Money's (Phase 8, task 5): the same classify
// function decides when an invoice is overdue, and the same allocator
// decides how much it still asks for. The numbers are the plan's.
describe('overdue invoices agree with Money', () => {
  const job = {
    id: 'job-1',
    name: 'Rosa Delgado',
    amount: 10000,
    stage: 'job',
    created_at: '2026-06-01T12:00:00.000Z',
    updated_at: '2026-06-01T12:00:00.000Z',
    completed_at: null,
    follow_up_on: null,
    proposal_status: null,
  }
  const bill = (id: string, sequence: number, dueAt: string, status = 'sent') => ({
    id, contact_id: 'job-1', title: sequence === 1 ? 'Deposit' : 'Final', amount: 5000, due_at: dueAt, status,
    sequence_number: sequence, created_at: '2026-06-01T12:00:00.000Z',
  })
  const overdueActions = (source: Partial<HomeDashboardSource>) =>
    buildHomeDashboardBundle(baseSource({ contacts: [job], ...source })).nextActions.filter((a) => a.kind === 'inv-overdue')

  it('asks for what is left after a linked payment, as the Money row does', () => {
    const actions = overdueActions({
      openInvoices: [bill('i1', 1, '2026-06-10', 'overdue'), bill('i2', 2, '2026-06-19')],
      payments: [{ contact_id: 'job-1', invoice_id: 'i1', amount: 2000, created_at: '2026-06-11T12:00:00.000Z', paid_on: '2026-06-11' }],
    })
    expect(actions.map((a) => [a.id, a.contactAmount])).toEqual([['inv-overdue-i1', 3000]])
    expect(actions[0].title).toBe('Invoice 8d past due')
    // The due day reads as the calendar day Money shows, June 10.
    expect(new Date(actions[0].dueIso).getDate()).toBe(10)
  })

  it('spreads an unlinked payment over the open invoices oldest due first', () => {
    const actions = overdueActions({
      openInvoices: [bill('i1', 1, '2026-06-10'), bill('i2', 2, '2026-06-12')],
      payments: [{ contact_id: 'job-1', invoice_id: null, amount: 4000, created_at: '2026-06-11T12:00:00.000Z', paid_on: '2026-06-11' }],
    })
    expect(actions.map((a) => [a.id, a.contactAmount])).toEqual([['inv-overdue-i1', 1000], ['inv-overdue-i2', 5000]])
  })

  it('does not count money that already paid a bill marked paid', () => {
    const actions = overdueActions({
      openInvoices: [bill('i2', 2, '2026-06-12')],
      settledInvoices: [bill('i1', 1, '2026-06-01', 'paid')],
      payments: [{ contact_id: 'job-1', invoice_id: null, amount: 5000, created_at: '2026-06-02T12:00:00.000Z', paid_on: '2026-06-02' }],
    })
    expect(actions.map((a) => [a.id, a.contactAmount])).toEqual([['inv-overdue-i2', 5000]])
  })

  it('leaves an invoice due today alone, as Money does', () => {
    // A bare date parses as UTC midnight, the evening before in Chicago;
    // the bill is not overdue until June 18 has ended.
    expect(overdueActions({ openInvoices: [bill('i1', 1, '2026-06-18')] })).toEqual([])
    expect(overdueActions({ openInvoices: [bill('i1', 1, '2026-06-17')] }).map((a) => a.title)).toEqual(['Invoice 1d past due'])
  })

  it('drops an overdue invoice the job has paid off', () => {
    expect(overdueActions({
      openInvoices: [bill('i1', 1, '2026-06-10')],
      payments: [{ contact_id: 'job-1', invoice_id: 'i1', amount: 5000, created_at: '2026-06-11T12:00:00.000Z', paid_on: '2026-06-11' }],
    })).toEqual([])
  })

  // Review of task 5: a job billed without a recorded contract amount has
  // no balance to cap at, so its overdue bill still asks for its face less
  // payments, as it did before the allocator.
  it('keeps an overdue invoice on a job with no contract amount', () => {
    const noAmount = { ...job, amount: null }
    const actions = buildHomeDashboardBundle(baseSource({
      contacts: [noAmount],
      openInvoices: [bill('i1', 1, '2026-06-10')],
      payments: [{ contact_id: 'job-1', invoice_id: 'i1', amount: 2000, created_at: '2026-06-11T12:00:00.000Z', paid_on: '2026-06-11' }],
    })).nextActions.filter((a) => a.kind === 'inv-overdue')
    expect(actions.map((a) => [a.id, a.contactAmount])).toEqual([['inv-overdue-i1', 3000]])
  })

  // Review of task 5: a deposit logged against the job before the draws
  // were made covers the deposit draft, so the progress draw asks for all
  // of its $4,000, as invoicesPaidInFull and the job page say.
  it('lets a covered deposit draft keep the progress draw whole', () => {
    const draw = (id: string, sequence: number, amount: number, status: string, dueAt: string | null) => ({
      ...bill(id, sequence, dueAt ?? '2026-06-10', status), amount, due_at: dueAt, title: `Draw ${sequence}`,
    })
    const actions = overdueActions({
      openInvoices: [draw('d2', 2, 4000, 'sent', '2026-06-10')],
      settledInvoices: [draw('d1', 1, 3000, 'draft', null), draw('d3', 3, 3000, 'draft', null)],
      payments: [{ contact_id: 'job-1', invoice_id: null, amount: 3000, created_at: '2026-06-02T12:00:00.000Z', paid_on: '2026-06-02' }],
    })
    expect(actions.map((a) => [a.id, a.contactAmount])).toEqual([['inv-overdue-d2', 4000]])
  })
})

describe('coverPhotoJobIds', () => {
  it('lists each job that renders a thumbnail once, sorted', () => {
    const ids = coverPhotoJobIds({
      nextActions: [
        { contactId: 'job-b' },
        { contactId: 'job-a' },
      ] as never,
      todayOnSite: [
        { contactId: 'job-c' },
        { contactId: null },
      ] as never,
      topPipeline: [
        { id: 'job-a' },
        { id: 'job-d' },
      ] as never,
    })
    expect(ids).toEqual(['job-a', 'job-b', 'job-c', 'job-d'])
  })

  it('keys covers by user and job list', () => {
    expect(homeCoversKey('user-1', ['job-a', 'job-b'])).toEqual(['homeCovers', 'user-1', ['job-a', 'job-b']])
  })
})
