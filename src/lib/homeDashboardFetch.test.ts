import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'

// Today's bundle reads, run through the real Supabase client against the
// hermetic mock (scripts/qa-mock.mjs). Review of Phase 8, task 5: the
// allocator needs a job's drafts, paid and void invoices next to its open
// ones, and Today should read them only for the jobs that have an open
// bill, not the whole company's history.

// Today reads the local day. Pin Central time, where Jesse works.
const originalTz = process.env.TZ
process.env.TZ = 'America/Chicago'
beforeAll(() => { process.env.TZ = 'America/Chicago' })
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

const mock = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  requests: [] as string[]
}))

vi.mock('./supabase.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./supabase.ts')>()
  const { createClient } = await import('@supabase/supabase-js')
  const { restResponse } = await import('../../scripts/qa-mock.mjs')
  const viaMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    mock.requests.push(decodeURIComponent(url))
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    const r = restResponse(url, { method: init?.method || 'GET', headers, tables: mock.tables })
    return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', ...(r.headers || {}) } })
  }
  const supabase = createClient('https://qa-mock.supabase.co', 'anon', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: viaMock }
  })
  return { ...original, supabase }
})

import { fetchHomeDashboard } from './homeDashboard.ts'

// Thursday, October 8, 2026, noon.
const NOW = new Date(2026, 9, 8, 12, 0, 0)
const ORG = 'org-1'

function contactRow(id: string, partial: Record<string, unknown> = {}) {
  return {
    id, org_id: ORG, user_id: 'qa-user-1', name: `Job ${id}`, amount: 10000, stage: 'job',
    updated_at: '2026-09-01T12:00:00Z', created_at: '2026-09-01T12:00:00Z', completed_at: null,
    follow_up_on: null, proposal_status: null, quote_change_request_note: null, quote_change_requested_at: null,
    address: null, job_title: 'Patio pour', ...partial
  }
}

function invoiceRow(id: string, contact_id: string, partial: Record<string, unknown>) {
  return {
    id, org_id: ORG, user_id: 'qa-user-1', contact_id, title: 'Draw', amount: 100, status: 'paid',
    sequence_number: 1, due_at: '2026-09-30', created_at: '2026-09-25T12:00:00Z', ...partial
  }
}

describe('fetchHomeDashboard', () => {
  it('reads drafts, paid and void invoices only for the jobs with an open bill, so a covered deposit draft keeps the progress draw whole', async () => {
    mock.requests = []
    mock.tables = {
      fh_contacts: [contactRow('c-open'), contactRow('c-done'), contactRow('c-quiet')],
      fh_payments: [
        { id: 'p1', org_id: ORG, user_id: 'qa-user-1', contact_id: 'c-open', invoice_id: null, amount: 3000, paid_on: '2026-09-20', created_at: '2026-09-20T12:00:00Z' }
      ],
      fh_invoices: [
        invoiceRow('d1', 'c-open', { title: 'Deposit', amount: 3000, status: 'draft', due_at: null }),
        invoiceRow('d2', 'c-open', { title: 'Progress', amount: 4000, status: 'sent', sequence_number: 2, due_at: '2026-10-01' }),
        invoiceRow('d3', 'c-open', { title: 'Final', amount: 3000, status: 'draft', sequence_number: 3, due_at: null }),
        // A finished job with only paid invoices: none of these are needed.
        ...Array.from({ length: 5 }, (_, n) => invoiceRow(`done-${n}`, 'c-done', { sequence_number: n + 1 }))
      ],
      fh_change_orders: [],
      fh_schedule: [],
      fh_public_links: []
    }

    const bundle = await fetchHomeDashboard('qa-user-1', NOW, ORG)

    const overdue = bundle.nextActions.filter((a) => a.kind === 'inv-overdue')
    expect(overdue.map((a) => [a.id, a.contactAmount])).toEqual([['inv-overdue-d2', 4000]])

    // The read of the other invoices names the jobs that have an open bill.
    const other = mock.requests.filter((u) => u.includes('/rest/v1/fh_invoices') && u.includes('draft'))
    expect(other.length).toBeGreaterThan(0)
    for (const url of other) {
      expect(url).toContain('contact_id=in.(c-open)')
      expect(url).not.toContain('c-done')
    }
  })

  it('skips the read of other invoices when no bill is open', async () => {
    mock.requests = []
    mock.tables = {
      fh_contacts: [contactRow('c-done')],
      fh_payments: [],
      fh_invoices: Array.from({ length: 3 }, (_, n) => invoiceRow(`done-${n}`, 'c-done', { sequence_number: n + 1 })),
      fh_change_orders: [],
      fh_schedule: [],
      fh_public_links: []
    }
    const bundle = await fetchHomeDashboard('qa-user-1', NOW, ORG)
    expect(bundle.nextActions.filter((a) => a.kind === 'inv-overdue')).toEqual([])
    expect(mock.requests.filter((u) => u.includes('/rest/v1/fh_invoices') && u.includes('draft'))).toEqual([])
  })

  // OPS-09: a job is behind only when its visits are all in the past.
  it('calls a job behind only when it has past visits and none from today on', async () => {
    mock.requests = []
    const visit = (id: string, contact_id: string, start: Date, hours = 2) => ({
      id, org_id: ORG, user_id: 'qa-user-1', contact_id, title: 'Visit',
      start_at: start.toISOString(), end_at: new Date(start.getTime() + hours * 3600e3).toISOString()
    })
    mock.tables = {
      fh_contacts: [contactRow('c-split'), contactRow('c-late'), contactRow('c-today')],
      fh_payments: [],
      fh_invoices: [],
      fh_change_orders: [],
      fh_schedule: [
        // This morning, done, and another tomorrow: on track.
        visit('s1', 'c-split', new Date(2026, 9, 8, 7, 0, 0)),
        visit('s2', 'c-split', new Date(2026, 9, 9, 8, 0, 0)),
        // Three days ago and nothing since: behind.
        visit('s3', 'c-late', new Date(2026, 9, 5, 8, 0, 0)),
        // Only this morning: today counts, so not behind.
        visit('s4', 'c-today', new Date(2026, 9, 8, 7, 0, 0))
      ],
      fh_public_links: []
    }
    const bundle = await fetchHomeDashboard('qa-user-1', NOW, ORG)
    expect(bundle.jobsBehind).toBe(1)
    expect(bundle.nextActions.filter((a) => a.kind === 'reschedule').map((a) => a.contactId)).toEqual(['c-late'])
  })
})
