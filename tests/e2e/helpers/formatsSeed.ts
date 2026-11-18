// One customer seeded for the format checks: a job worth $12,345.50, two
// invoices and one payment, all with cents, and dates that sit near
// midnight in Central time, so a whole dollar rounding or a UTC read shows.
export const NOW = new Date('2026-11-17T16:00:00Z') // Tue Nov 17 2026, 10:00 am Central

export const CLIENT = { id: 'cl-h', name: 'Harold Wickham', phone: '6155550101', email: 'harold@example.com', address: '12 Elm St, Murfreesboro, TN' }

export function contact(partial: Record<string, unknown>) {
  return {
    user_id: 'qa-user-1', org_id: 'org-1', client_id: 'cl-h', phone: '6155550101', email: 'harold@example.com',
    address: '12 Elm St, Murfreesboro, TN', notes: null, scope_text: null, milestones: [],
    created_at: '2026-10-01T12:00:00Z', updated_at: '2026-11-10T12:00:00Z',
    proposal_status: null, follow_up_on: null, completed_at: null, invoice_no: null, cost: null,
    fh_clients: CLIENT, ...partial
  }
}

export function invoice(partial: Record<string, unknown>) {
  return {
    user_id: 'qa-user-1', org_id: 'org-1', client_id: 'cl-h', description: null, notes: null, status: 'sent',
    sequence_number: 1, issued_at: '2026-11-03T12:00:00Z', created_at: '2026-11-03T12:00:00Z',
    updated_at: '2026-11-03T12:00:00Z', fh_clients: CLIENT, ...partial
  }
}

export function payment(partial: Record<string, unknown>) {
  return { user_id: 'qa-user-1', org_id: 'org-1', method: 'check', reference: null, invoice_id: null, kind: null, ...partial }
}

export const JOB = contact({ id: 'c-h', stage: 'job', name: 'Harold Wickham', job_title: 'Driveway replacement', amount: 12345.5, cost: 8000.25 })

export const INVOICES = [
  // Issued at 9:30 pm Central on Nov 2, which is Nov 3 in UTC.
  invoice({ id: 'inv-h1', contact_id: 'c-h', title: 'Deposit', amount: 4115.17, status: 'sent', sequence_number: 1, issued_at: '2026-11-03T03:30:00Z', created_at: '2026-11-03T03:30:00Z', due_at: '2026-11-20' }),
  invoice({ id: 'inv-h2', contact_id: 'c-h', title: 'Final', amount: 8230.33, status: 'draft', sequence_number: 2, issued_at: null, created_at: '2026-11-10T15:00:00Z', due_at: null })
]

export const PAYMENTS = [
  // Logged at 8:15 pm Central on Nov 12, which is Nov 13 in UTC.
  payment({ id: 'p-h1', contact_id: 'c-h', invoice_id: 'inv-h1', amount: 1000.5, paid_on: '2026-11-12', created_at: '2026-11-13T02:15:00Z' })
]

export const SCHEDULE = [
  // 7:00 am Central, Wed Nov 18.
  { id: 's-h1', user_id: 'qa-user-1', org_id: 'org-1', contact_id: 'c-h', title: 'Pour driveway', description: null, start_at: '2026-11-18T13:00:00Z', end_at: '2026-11-18T17:00:00Z', created_at: '2026-11-10T12:00:00Z' }
]

export const TABLES = {
  fh_contacts: [JOB],
  fh_clients: [{ ...CLIENT, user_id: 'qa-user-1', org_id: 'org-1', company_name: null, created_at: '2026-09-01T12:00:00Z' }],
  fh_invoices: INVOICES,
  fh_payments: PAYMENTS,
  fh_schedule: SCHEDULE,
  fh_leads: [],
  fh_quotes: [],
  fh_notes: []
}
