import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'

// The Money bundle's reads, run through the real Supabase client against
// the hermetic mock (scripts/qa-mock.mjs), which honors filters, order,
// limit and offset as PostgREST does. Phase 8, task 5: the totals must not
// come from the display list capped at 500 invoices.

// Money reads the local day. Pin Central time, where the owner works.
const originalTz = process.env.TZ
process.env.TZ = 'America/Chicago'
beforeAll(() => { process.env.TZ = 'America/Chicago' })
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

const mock = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]> }))

vi.mock('./supabase.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./supabase.ts')>()
  const { createClient } = await import('@supabase/supabase-js')
  const { restResponse } = await import('../../scripts/qa-mock.mjs')
  const viaMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
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

import { fetchInvoicesBundle } from './queries.ts'
import { buildMoneyView } from './moneyView.ts'

// Thursday, October 8, 2026, noon.
const NOW = new Date(2026, 9, 8, 12, 0, 0)
const ORG = 'org-1'

function invoiceRow(id: string, partial: Record<string, unknown>) {
  return {
    id,
    org_id: ORG,
    user_id: 'qa-user-1',
    contact_id: 'c-job',
    title: 'Progress draw',
    description: null,
    notes: null,
    amount: 100,
    status: 'paid',
    sequence_number: 1,
    issued_at: '2026-09-30T12:00:00Z',
    due_at: '2026-09-30',
    updated_at: '2026-09-30T12:00:00Z',
    ...partial
  }
}

describe('fetchInvoicesBundle', () => {
  it('loads every open invoice for the totals when 620 invoices outgrow the display cap', async () => {
    // 619 paid invoices from the last few weeks, then one open invoice from
    // January 2025, the oldest of all.
    const paid = Array.from({ length: 619 }, (_, n) =>
      invoiceRow(`paid-${String(n).padStart(3, '0')}`, {
        sequence_number: n + 2,
        created_at: new Date(Date.UTC(2026, 8, 30, 12) - n * 3600_000).toISOString()
      }))
    const old = invoiceRow('old-open', {
      title: 'Final',
      amount: 1240,
      status: 'sent',
      sequence_number: 1,
      issued_at: '2025-01-02T12:00:00Z',
      due_at: '2025-01-15',
      created_at: '2025-01-01T12:00:00Z'
    })
    mock.tables = {
      fh_contacts: [{
        id: 'c-job', org_id: ORG, user_id: 'qa-user-1', client_id: null, name: 'Rosa Delgado', email: 'rosa@example.com',
        phone: null, address: null, stage: 'job', amount: 200000, cost: null, job_title: 'Concrete steps', job_type: null,
        completed_at: null, created_at: '2024-12-01T12:00:00Z', updated_at: '2026-09-30T12:00:00Z', fh_clients: null
      }],
      fh_payments: [],
      fh_invoices: [...paid, old],
      fh_change_orders: []
    }

    const bundle = await fetchInvoicesBundle('qa-user-1', ORG)

    expect(paid.length + 1).toBe(620)
    // The open invoice is in the uncapped open list and joins the rows the
    // screen lists, after the 500 newest.
    expect(bundle.openInvoices?.map((i) => i.id)).toEqual(['old-open'])
    expect(bundle.invoices).toHaveLength(501)
    expect(bundle.invoices[500].id).toBe('old-open')

    const view = buildMoneyView({ bundle, quotes: [], now: NOW })
    expect(view.overdue.map((r) => [r.id, r.amount])).toEqual([['old-open', 1240]])
    expect(view.dueThisWeek).toBe(1240)
  })

  // Review of task 5: drafts take part in the allocation (a deposit logged
  // against the job covers its deposit draft), so the bundle loads them
  // uncapped with the paid and void rows.
  it('loads drafts with the settled invoices so a covered deposit draft keeps the progress draw whole', async () => {
    mock.tables = {
      fh_contacts: [{
        id: 'c-job', org_id: ORG, user_id: 'qa-user-1', client_id: null, name: 'Rosa Delgado', email: 'rosa@example.com',
        phone: null, address: null, stage: 'job', amount: 10000, cost: null, job_title: 'Patio pour', job_type: null,
        completed_at: null, created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-30T12:00:00Z', fh_clients: null
      }],
      fh_payments: [{ id: 'p1', org_id: ORG, user_id: 'qa-user-1', contact_id: 'c-job', invoice_id: null, amount: 3000, paid_on: '2026-09-20', created_at: '2026-09-20T12:00:00Z' }],
      fh_invoices: [
        invoiceRow('d1', { title: 'Deposit', amount: 3000, status: 'draft', sequence_number: 1, due_at: null, created_at: '2026-09-25T12:00:00Z' }),
        invoiceRow('d2', { title: 'Progress', amount: 4000, status: 'sent', sequence_number: 2, due_at: '2026-10-01', created_at: '2026-09-25T12:00:01Z' }),
        invoiceRow('d3', { title: 'Final', amount: 3000, status: 'draft', sequence_number: 3, due_at: null, created_at: '2026-09-25T12:00:02Z' })
      ],
      fh_change_orders: []
    }

    const bundle = await fetchInvoicesBundle('qa-user-1', ORG)
    expect(bundle.settledInvoices?.map((i) => i.id).sort()).toEqual(['d1', 'd3'])
    const view = buildMoneyView({ bundle, quotes: [], now: NOW })
    expect(view.overdue.map((r) => [r.id, r.amount])).toEqual([['d2', 4000]])
  })
})
