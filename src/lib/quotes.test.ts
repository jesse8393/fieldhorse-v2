import { beforeEach, describe, expect, it, vi } from 'vitest'

type Call = [string, ...unknown[]]
const responses: { data: unknown; error: unknown }[] = []
const builders: Call[][] = []

function builder(): unknown {
  const calls: Call[] = []
  builders.push(calls)
  const response = responses.shift() ?? { data: null, error: null }
  const proxy: unknown = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(response).then(resolve, reject)
      }
      return (...args: unknown[]) => {
        calls.push([String(prop), ...args])
        return proxy
      }
    },
  })
  return proxy
}

vi.mock('./supabase.ts', () => ({ supabase: { from: (table: string) => { const b = builder(); builders[builders.length - 1].push(['from', table]); return b } } }))

const { createQuote, makeJobFromQuote, quoteNumber, quoteToJobDraft } = await import('./quotes.ts')

function callsOf(index: number, method: string) {
  return builders[index].filter((c) => c[0] === method)
}

beforeEach(() => {
  responses.length = 0
  builders.length = 0
})

const quote = {
  id: 'quote-1',
  client_id: 'client-1',
  lead_id: null,
  job_id: null,
  title: 'Deck rebuild',
  job_type: 'deck',
  scope_text: 'Tear out and rebuild',
  terms_text: 'Half up front',
  exclusions_text: 'No permits',
  amount: 0,
  status: 'approved',
  sent_at: null,
  expires_at: null,
  change_request_note: null,
  change_requested_at: null,
  approved_version_id: null,
  org_id: 'org-1',
  origin_contact_id: null,
  user_id: 'user-1',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
}

function item(over: Record<string, unknown>) {
  return {
    id: 'i', quote_id: 'quote-1', contact_id: null, description: 'Line', qty: 1, rate: 0, amount: 0,
    is_optional: false, is_excluded: false, notes: null, section: null, sort_order: 0, unit: null,
    org_id: 'org-1', user_id: 'user-1', created_at: '', updated_at: '', ...over,
  }
}

const client = { name: 'Jane Smith', phone: '615 555 0101', email: 'jane@example.com' }

describe('quoteToJobDraft', () => {
  it('sums only the base lines into the amount', () => {
    const draft = quoteToJobDraft(quote, [
      item({ id: 'a', amount: 1000 }),
      item({ id: 'b', amount: 250, is_optional: true }),
      item({ id: 'c', amount: 75, is_excluded: true }),
      item({ id: 'd', amount: 500.5 }),
    ], client)
    expect(draft.amount).toBe(1500.5)
  })

  it('gives 0 with no lines', () => {
    expect(quoteToJobDraft(quote, [], client).amount).toBe(0)
  })

  it('copies the quote and client into a job row', () => {
    const draft = quoteToJobDraft(quote, [], client)
    expect(draft).toMatchObject({
      stage: 'job',
      client_id: 'client-1',
      name: 'Jane Smith',
      phone: '615 555 0101',
      email: 'jane@example.com',
      job_title: 'Deck rebuild',
      scope_text: 'Tear out and rebuild',
      terms_text: 'Half up front',
      exclusions_text: 'No permits',
      job_type: 'deck',
      user_id: 'user-1',
      org_id: 'org-1',
    })
  })
})

describe('quoteNumber', () => {
  it('keeps the proposal shape and uses the last four characters of the quote id', () => {
    expect(quoteNumber('Parker Construction', 'quote-a1b2', '2026-03-04T00:00:00Z')).toBe('PC-2026-A1B2')
  })
})

describe('createQuote', () => {
  it('inserts a draft quote and returns the row', async () => {
    responses.push({ data: { ...quote, status: 'draft' }, error: null })
    const row = await createQuote({ userId: 'user-1', orgId: 'org-1', clientId: 'client-1', leadId: 'lead-1', title: 'Deck rebuild' })
    expect(row.id).toBe('quote-1')
    expect(callsOf(0, 'from')[0][1]).toBe('fh_quotes')
    expect(callsOf(0, 'insert')[0][1]).toMatchObject({ user_id: 'user-1', org_id: 'org-1', client_id: 'client-1', lead_id: 'lead-1', title: 'Deck rebuild', status: 'draft' })
  })

  it('throws when the insert fails', async () => {
    responses.push({ data: null, error: { message: 'boom' } })
    await expect(createQuote({ userId: 'u', orgId: 'o', clientId: 'c' })).rejects.toThrow('boom')
  })
})

describe('makeJobFromQuote', () => {
  it('inserts the job, copies the lines onto it and links the quote', async () => {
    responses.push({ data: quote, error: null })
    responses.push({ data: [item({ id: 'a', amount: 1000 }), item({ id: 'b', amount: 250, is_optional: true })], error: null })
    responses.push({ data: client, error: null })
    responses.push({ data: { id: 'job-7' }, error: null })
    responses.push({ data: null, error: null })
    responses.push({ data: null, error: null })

    const result = await makeJobFromQuote('quote-1')
    expect(result).toEqual({ jobId: 'job-7' })

    expect(callsOf(0, 'from')[0][1]).toBe('fh_quotes')
    expect(callsOf(1, 'from')[0][1]).toBe('fh_quote_items')
    expect(callsOf(2, 'from')[0][1]).toBe('fh_clients')

    expect(callsOf(3, 'from')[0][1]).toBe('fh_contacts')
    expect(callsOf(3, 'insert')[0][1]).toMatchObject({ stage: 'job', client_id: 'client-1', name: 'Jane Smith', amount: 1000 })

    expect(callsOf(4, 'from')[0][1]).toBe('fh_quote_items')
    const copied = callsOf(4, 'insert')[0][1] as Record<string, unknown>[]
    expect(copied).toHaveLength(2)
    for (const row of copied) {
      expect(row.contact_id).toBe('job-7')
      expect(row.quote_id).toBeNull()
      expect(row).not.toHaveProperty('id')
    }
    expect(copied[1]).toMatchObject({ is_optional: true, amount: 250 })

    expect(callsOf(5, 'from')[0][1]).toBe('fh_quotes')
    expect(callsOf(5, 'update')[0][1]).toEqual({ job_id: 'job-7' })
    expect(callsOf(5, 'eq')[0]).toEqual(['eq', 'id', 'quote-1'])
  })

  it('skips the item copy when the quote has no lines', async () => {
    responses.push({ data: quote, error: null })
    responses.push({ data: [], error: null })
    responses.push({ data: client, error: null })
    responses.push({ data: { id: 'job-7' }, error: null })
    responses.push({ data: null, error: null })

    await makeJobFromQuote('quote-1')
    expect(builders).toHaveLength(5)
    expect(callsOf(3, 'insert')[0][1]).toMatchObject({ amount: 0 })
    expect(callsOf(4, 'from')[0][1]).toBe('fh_quotes')
  })

  // Task 10, Make this a job (D61): the job is a copy of the quote's words
  // and base price, and the quote points at it. The quote's status is left
  // alone, so an approved quote stays approved and a draft stays a draft.
  it('makeJobFromQuote copies scope, amount and terms and sets job_id', async () => {
    responses.push({ data: quote, error: null })
    responses.push({ data: [item({ id: 'a', amount: 1200.25 }), item({ id: 'b', amount: 300 }), item({ id: 'c', amount: 99, is_excluded: true })], error: null })
    responses.push({ data: client, error: null })
    responses.push({ data: { id: 'job-9' }, error: null })
    responses.push({ data: null, error: null })
    responses.push({ data: null, error: null })

    await expect(makeJobFromQuote('quote-1')).resolves.toEqual({ jobId: 'job-9' })

    const job = callsOf(3, 'insert')[0][1] as Record<string, unknown>
    expect(job).toMatchObject({
      stage: 'job',
      scope_text: 'Tear out and rebuild',
      terms_text: 'Half up front',
      exclusions_text: 'No permits',
      amount: 1500.25,
    })
    expect(job).not.toHaveProperty('status')

    expect(callsOf(5, 'from')[0][1]).toBe('fh_quotes')
    expect(callsOf(5, 'update')[0][1]).toEqual({ job_id: 'job-9' })
    // Only the pointer is written: nothing touches the quote's status.
    expect(callsOf(5, 'update')[0][1]).not.toHaveProperty('status')
  })

  it('a quote with no lines makes a job with no amount', async () => {
    responses.push({ data: { ...quote, amount: 0 }, error: null })
    responses.push({ data: [], error: null })
    responses.push({ data: client, error: null })
    responses.push({ data: { id: 'job-0' }, error: null })
    responses.push({ data: null, error: null })

    await expect(makeJobFromQuote('quote-1')).resolves.toEqual({ jobId: 'job-0' })
    expect(callsOf(3, 'insert')[0][1]).toMatchObject({ amount: 0, stage: 'job' })
    // No lines, so no copy of them is attempted.
    expect(builders).toHaveLength(5)
  })
})
