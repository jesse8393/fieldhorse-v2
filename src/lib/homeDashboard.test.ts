import { describe, expect, it } from 'vitest'
import { buildHomeDashboardBundle, type HomeDashboardSource } from './homeDashboard.ts'

function baseSource(overrides: Partial<HomeDashboardSource> = {}): HomeDashboardSource {
  return {
    now: new Date('2026-06-18T12:00:00.000Z'),
    contacts: [],
    overdueSchedules: [],
    payments: [],
    todaySchedules: [],
    photoUrlByJob: {},
    proposalViews: [],
    sentChangeOrders: [],
    openInvoices: [],
    approvedChangeOrders: [],
    ...overrides,
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
    const source = baseSource({
      contacts: [
        {
          id: 'lead-1',
          name: 'Kitchen lead',
          amount: 10000,
          stage: 'lead',
          created_at: '2026-06-01T12:00:00.000Z',
          updated_at: '2026-06-01T12:00:00.000Z',
          completed_at: null,
          follow_up_on: null,
          proposal_status: null,
        },
        {
          id: 'lead-1',
          name: 'Kitchen lead duplicate',
          amount: 10000,
          stage: 'lead',
          created_at: '2026-06-01T12:00:00.000Z',
          updated_at: '2026-06-01T12:00:00.000Z',
          completed_at: null,
          follow_up_on: null,
          proposal_status: null,
        },
      ],
    })

    const bundle = buildHomeDashboardBundle(source)

    expect(bundle.pipeline).toBe(10000)
    expect(bundle.stageBreakdown.lead).toBe(1)
    expect(bundle.dealsAtRisk.followUps).toBe(1)
  })

  it('routes quote and change order actions to their exact job tabs', () => {
    const bundle = buildHomeDashboardBundle(baseSource({
      contacts: [{
        id: 'quote-1',
        name: 'Patio quote',
        amount: 9000,
        stage: 'quote',
        created_at: '2026-06-01T12:00:00.000Z',
        updated_at: '2026-06-17T12:00:00.000Z',
        completed_at: null,
        follow_up_on: null,
        proposal_status: 'viewed',
      }],
      proposalViews: [{
        contact_id: 'quote-1',
        last_viewed_at: '2026-06-14T12:00:00.000Z',
      }],
      sentChangeOrders: [{
        id: 'co-1',
        contact_id: 'quote-1',
        sequence_number: 2,
        title: 'Drainage add',
        amount: 1250,
        updated_at: '2026-06-12T12:00:00.000Z',
      }],
    }))

    expect(bundle.nextActions.find((row) => row.kind === 'viewed-quiet')).toMatchObject({
      tab: 'quote',
      intent: 'quote_followup',
    })
    expect(bundle.nextActions.find((row) => row.kind === 'co-unsigned')).toMatchObject({
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
})
