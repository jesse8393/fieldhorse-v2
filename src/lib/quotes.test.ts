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

const { createQuote, invalidateAfterQuoteWrite, makeJobFromQuote, plainQuoteError, quoteNumber } = await import('./quotes.ts')

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

  // Audit finding DATA-12: a save whose answer was lost must not make a second quote.
  it('sends the id the form minted, so a retry addresses the same quote', async () => {
    responses.push({ data: { ...quote, id: 'minted-1', status: 'draft' }, error: null })
    await createQuote({ id: 'minted-1', userId: 'user-1', orgId: 'org-1', clientId: 'client-1' })
    expect(callsOf(0, 'insert')[0][1]).toMatchObject({ id: 'minted-1' })
  })

  it('a retry that finds its quote already saved returns that quote, not an error', async () => {
    responses.push({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } })
    responses.push({ data: { ...quote, id: 'minted-1', status: 'draft' }, error: null })
    const row = await createQuote({ id: 'minted-1', userId: 'user-1', orgId: 'org-1', clientId: 'client-1' })
    expect(row.id).toBe('minted-1')
    expect(callsOf(1, 'eq')).toEqual(expect.arrayContaining([['eq', 'id', 'minted-1'], ['eq', 'user_id', 'user-1'], ['eq', 'org_id', 'org-1']]))
    expect(callsOf(1, 'insert')).toEqual([])
    expect(callsOf(1, 'update')).toEqual([])
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

// Audit finding DATA-13: what refreshes after a quote write.
describe('invalidateAfterQuoteWrite', () => {
  function keysAfter(input: Parameters<typeof invalidateAfterQuoteWrite>[1]) {
    const keys: unknown[] = []
    invalidateAfterQuoteWrite({ invalidateQueries: (f: { queryKey: unknown }) => { keys.push(f.queryKey); return Promise.resolve() } } as any, input)
    return keys
  }
  it('refreshes the quotes list, the quote, its lead and its client', () => {
    expect(keysAfter({ quoteId: 'q-1', leadId: 'l-1', clientId: 'c-1' })).toEqual([
      ['quotes'], ['quote', 'q-1'], ['leads'], ['lead', 'l-1'], ['clientDetail', 'c-1']
    ])
  })
  it('refreshes the jobs list too when a job was made', () => {
    expect(keysAfter({ quoteId: 'q-1', clientId: 'c-1', jobMade: true })).toEqual([
      ['quotes'], ['quote', 'q-1'], ['clientDetail', 'c-1'], ['jobs']
    ])
  })
})

// raw-errors-3: plainQuoteError let any message with a space in it through,
// so every PostgREST refusal reached the quote screens as it was.
describe('plainQuoteError', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })

  it('never shows the database, a gateway page or a lapsed session as they are', () => {
    expect(plainQuoteError({ code: '42501', message: 'new row violates row-level security policy for table "fh_quotes"' }))
      .toBe('Your role does not allow this. Ask an owner or admin.')
    expect(plainQuoteError({ code: '23505', message: 'duplicate key value violates unique constraint "fh_quotes_pkey"' }))
      .toBe('This was already saved. Refresh to see the latest.')
    expect(plainQuoteError({ message: '<html><head><title>502 Bad Gateway</title></head><body><center>cloudflare</center></body></html>' }))
      .toBe('Something went wrong on our side. Try again in a minute.')
    expect(plainQuoteError({ code: 'PGRST303', message: 'JWT expired' })).toBe('Your sign in ran out. Sign in again, then try again.')
    expect(plainQuoteError({ code: '23514', message: 'new row for relation "fh_quotes" violates check constraint "fh_quotes_status_check"' }, 'The quote was not saved. Try again.'))
      .toBe('The quote was not saved. Try again.')
  })

  it('keeps a sentence the app wrote', () => {
    expect(plainQuoteError(new Error('This quote changed on another device. Check it and try again.'))).toBe('This quote changed on another device. Check it and try again.')
  })
})
