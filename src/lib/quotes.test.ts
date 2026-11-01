import { beforeEach, describe, expect, it, vi } from 'vitest'

type Call = [string, ...unknown[]]
const responses: { data: unknown; error: unknown }[] = []
const builders: Call[][] = []
const rpc = vi.hoisted(() => vi.fn())

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

vi.mock('./supabase.ts', () => ({ supabase: { rpc, from: (table: string) => { const b = builder(); builders[builders.length - 1].push(['from', table]); return b } } }))

const { createQuote, makeJobFromQuote, quoteNumber } = await import('./quotes.ts')

function callsOf(index: number, method: string) {
  return builders[index].filter((c) => c[0] === method)
}

beforeEach(() => {
  responses.length = 0
  builders.length = 0
  rpc.mockReset()
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
  it('returns the confirmed server job without issuing partial writes', async () => {
    rpc.mockResolvedValue({ data: 'job-7', error: null })
    await expect(makeJobFromQuote('quote-1')).resolves.toEqual({ jobId: 'job-7' })
    expect(rpc).toHaveBeenCalledWith('fh_make_job_from_quote', { p_quote_id: 'quote-1' })
    expect(builders).toHaveLength(0)
  })
  it('preserves permission failures without falling back to individual inserts', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Access revoked' } })
    await expect(makeJobFromQuote('quote-1')).rejects.toThrow('Access revoked')
    expect(builders).toHaveLength(0)
  })
  it('refuses an acknowledgement without a confirmed job', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await expect(makeJobFromQuote('quote-1')).rejects.toThrow('could not be confirmed')
  })
  it('a lost response can be retried through the same server identity', async () => {
    rpc.mockRejectedValueOnce(new Error('Network interrupted')).mockResolvedValueOnce({ data: 'existing-job', error: null })
    await expect(makeJobFromQuote('quote-1')).rejects.toThrow('Network interrupted')
    await expect(makeJobFromQuote('quote-1')).resolves.toEqual({ jobId: 'existing-job' })
    expect(rpc.mock.calls).toEqual([
      ['fh_make_job_from_quote', { p_quote_id: 'quote-1' }],
      ['fh_make_job_from_quote', { p_quote_id: 'quote-1' }]
    ])
    expect(builders).toHaveLength(0)
  })
})
