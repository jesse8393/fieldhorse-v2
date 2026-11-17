import { afterEach, describe, expect, it, vi } from 'vitest'

// The hermetic Supabase mock behind every e2e spec and screenshot script.
// These checks pin how it answers PostgREST reads, so a test only sees the
// rows the real database would return for the same query.
import { apiStatus, queryRows, restResponse, rpcResponse } from '../../scripts/qa-mock.mjs'

const BASE = 'https://qa-mock.supabase.co/rest/v1/'

type Row = Record<string, unknown>

type Init = { method?: string; headers?: Record<string, string>; tables?: Record<string, Row[]>; body?: unknown; schema?: null }

function read(path: string, init: Init = {}) {
  const res = restResponse(`${BASE}${path}`, init)
  return { ...res, json: res.body ? JSON.parse(res.body) : undefined }
}

// The filter tests below read made up tables such as `t`, which the schema
// in database.types.ts does not have, so they turn the schema checks off.
function ids(path: string, tables?: Record<string, Row[]>) {
  return (read(path, tables ? { tables, schema: null } : {}).json as Row[]).map((r) => r.id)
}

describe('qa mock REST reads', () => {
  it('returns only job and invoice rows for stage=in.(job,invoice)', () => {
    const rows = read('fh_contacts?select=*&stage=in.(job,invoice)').json as Row[]
    expect(rows.map((r) => r.stage).sort()).toEqual(['invoice', 'job'])
    expect(rows.map((r) => r.id).sort()).toEqual(['c-job1', 'c-job2'])
  })

  it('returns two rows for limit=2 and honors offset', () => {
    expect(read('fh_contacts?select=*&limit=2').json).toHaveLength(2)
    expect(ids('fh_contacts?select=*&order=id.asc&limit=2&offset=1')).toEqual(['c-done', 'c-job1'])
  })

  it('applies every filter on the same column', () => {
    const t = [
      { id: 'a', start_at: '2026-10-07T23:00:00Z' },
      { id: 'b', start_at: '2026-10-08T05:00:00Z' },
      { id: 'c', start_at: '2026-10-08T20:00:00.000+00:00' },
      { id: 'd', start_at: '2026-10-09T05:00:00Z' }
    ]
    expect(ids('t?start_at=gte.2026-10-08T05:00:00.000Z&start_at=lt.2026-10-09T05:00:00.000Z', { t })).toEqual(['b', 'c'])
  })

  it('compares ISO times as instants, whatever their spelling', () => {
    const t = [
      { id: 'utc', at: '2026-10-08T05:00:00Z' },
      { id: 'offset', at: '2026-10-08T00:00:00-05:00' },
      { id: 'later', at: '2026-10-08T05:00:01Z' },
      { id: 'midnight', at: '2026-10-08T00:00:00Z' },
      { id: 'before', at: '2026-10-07T23:59:59Z' }
    ]
    expect(ids('t?at=eq.2026-10-08T05:00:00.000%2B00:00', { t })).toEqual(['utc', 'offset'])
    expect(ids('t?at=lt.2026-10-08T00:00:01Z', { t })).toEqual(['midnight', 'before'])
    // A date alone against a time column is midnight UTC.
    expect(ids('t?at=eq.2026-10-08', { t })).toEqual(['midnight'])
    expect(ids('t?at=lt.2026-10-08', { t })).toEqual(['before'])
  })

  it('compares numbers numerically and booleans as booleans', () => {
    const t = [
      { id: 'nine', amount: 9, paid: true },
      { id: 'ten', amount: '10.00', paid: false },
      { id: 'hundred', amount: 100, paid: null }
    ]
    expect(ids('t?amount=gt.9.5', { t })).toEqual(['ten', 'hundred'])
    expect(ids('t?amount=eq.10', { t })).toEqual(['ten'])
    expect(ids('t?amount=lte.10', { t })).toEqual(['nine', 'ten'])
    expect(ids('t?paid=is.true', { t })).toEqual(['nine'])
    expect(ids('t?paid=is.false', { t })).toEqual(['ten'])
    expect(ids('t?paid=eq.false', { t })).toEqual(['ten'])
    expect(ids('t?paid=is.null', { t })).toEqual(['hundred'])
  })

  it('treats a null or missing column as SQL does', () => {
    const t = [
      { id: 'set', status: 'open' },
      { id: 'null', status: null },
      { id: 'missing' }
    ]
    expect(ids('t?status=is.null', { t })).toEqual(['null', 'missing'])
    expect(ids('t?status=neq.closed', { t })).toEqual(['set'])
    expect(ids('t?status=eq.open', { t })).toEqual(['set'])
  })

  it('reads in lists with double quoted values', () => {
    const t = [
      { id: 'plain', name: 'c' },
      { id: 'space', name: 'a b' },
      { id: 'comma', name: 'x, y' },
      { id: 'other', name: 'z' }
    ]
    expect(ids('t?name=in.(%22a b%22,c,%22x, y%22)', { t })).toEqual(['plain', 'space', 'comma'])
    expect(ids('t?name=in.()', { t })).toEqual([])
  })

  it('orders by several columns with the database null rules', () => {
    const t = [
      { id: 'a', due: '2026-10-09', n: 2 },
      { id: 'b', due: null, n: 1 },
      { id: 'c', due: '2026-10-08', n: 3 },
      { id: 'd', due: '2026-10-09', n: 1 }
    ]
    expect(ids('t?order=due.asc,n.asc', { t })).toEqual(['c', 'd', 'a', 'b'])
    expect(ids('t?order=due.desc,n.desc', { t })).toEqual(['b', 'a', 'd', 'c'])
    expect(ids('t?order=due.desc.nullslast,n.asc', { t })).toEqual(['d', 'a', 'c', 'b'])
    expect(ids('t?order=due.asc.nullsfirst', { t })).toEqual(['b', 'c', 'a', 'd'])
  })

  it('negates a test with not. and never matches a null that way', () => {
    const t = [
      { id: 'job', stage: 'job' },
      { id: 'lead', stage: 'lead' },
      { id: 'moved', stage: 'moved_lead' },
      { id: 'blank', stage: null }
    ]
    expect(ids('t?stage=not.eq.job', { t })).toEqual(['lead', 'moved'])
    expect(ids('t?stage=not.in.("moved_lead","moved_quote")', { t })).toEqual(['job', 'lead'])
    expect(ids('t?stage=not.is.null', { t })).toEqual(['job', 'lead', 'moved'])
    expect(ids('t?stage=not.bogus.x', { t })).toEqual(['job', 'lead', 'moved', 'blank'])
  })

  it('ignores what it does not model, as before', () => {
    const t = [
      { id: 'job', stage: 'job', name: 'Ann' },
      { id: 'lead', stage: 'lead', name: 'Bob' }
    ]
    const all = ['job', 'lead']
    expect(ids('t?or=(stage.eq.job,stage.eq.quote)', { t })).toEqual(all)
    expect(ids('t?name=ilike.*ann*', { t })).toEqual(all)
    expect(ids('t?tags=cs.{a}', { t })).toEqual(all)
    expect(ids('t?fh_contacts.stage=eq.quote', { t })).toEqual(all)
    expect(ids('t?select=*,fh_contacts(name)&fh_contacts.order=name.desc&fh_contacts.limit=1', { t })).toEqual(all)
    expect(ids('t?order=fh_contacts(name).desc', { t })).toEqual(all)
  })

  it('sends the filtered count before limit and offset when asked', () => {
    const prefer = { Prefer: 'count=exact' }
    const page = read('fh_contacts?select=id&stage=in.(moved_lead,moved_quote)&order=id.asc&limit=1&offset=1', { headers: prefer })
    expect(page.headers['content-range']).toBe('1-1/4')
    expect((page.json as Row[]).map((r) => r.id)).toEqual(['c-lead1'])

    const head = read('fh_contacts?select=id&stage=eq.job', { method: 'HEAD', headers: prefer })
    expect(head.status).toBe(200)
    expect(head.body).toBe('')
    expect(head.headers['content-range']).toBe('0-0/1')

    const none = read('fh_contacts?select=id&stage=eq.nothing', { method: 'HEAD', headers: prefer })
    expect(none.headers['content-range']).toBe('*/0')

    const uncounted = read('fh_contacts?select=id&limit=2')
    expect(uncounted.headers['content-range']).toBe('0-1/*')
  })

  it('answers single object requests with the one matching row, or 406 for none or several', () => {
    const object = { Accept: 'application/vnd.pgrst.object+json' }
    const hit = read('fh_contacts?select=*&stage=eq.moved_quote&order=amount.asc&limit=1', { headers: object })
    expect(hit.status).toBe(200)
    expect((hit.json as Row).id).toBe('c-change')

    const none = read('fh_contacts?select=*&id=eq.nope', { headers: object })
    expect(none.status).toBe(406)
    expect((none.json as Row).code).toBe('PGRST116')

    // Two moved quotes match, so PostgREST refuses to pick one.
    const several = read('fh_contacts?select=*&stage=eq.moved_quote', { headers: object })
    expect(several.status).toBe(406)
    expect(several.json).toMatchObject({ code: 'PGRST116', details: 'The result contains 2 rows' })
  })

  it('keeps the first row for a single object request when it ignored part of the query', () => {
    // The database would apply these, so the mock cannot tell how many rows
    // it would return, and keeps its older answer.
    const object = { Accept: 'application/vnd.pgrst.object+json' }
    for (const path of [
      'fh_contacts?select=*&stage=eq.moved_quote&or=(id.eq.c-quote,id.eq.nope)',
      'fh_contacts?select=*&stage=eq.moved_quote&name=ilike.*mmc*',
      'fh_contacts?select=*,fh_clients!inner(name)&stage=eq.moved_quote',
      'fh_contacts?select=*,fh_clients(name)&stage=eq.moved_quote&fh_clients.name=eq.Jeff%20Roy'
    ]) {
      const res = read(path, { headers: object })
      expect(res.status, path).toBe(200)
      expect((res.json as Row).stage, path).toBe('moved_quote')
    }
  })

  it('reads a date column against a time filter as the database does, by its date', () => {
    // Postgres casts the literal to the column's date type, dropping the
    // time and zone as written.
    const t = [
      { id: 'fifth', paid_on: '2026-10-05' },
      { id: 'sixth', paid_on: '2026-10-06' }
    ]
    expect(ids('t?paid_on=gte.2026-10-05T05:00:00.000Z', { t })).toEqual(['fifth', 'sixth'])
    expect(ids('t?paid_on=lt.2026-10-06T01:00:00.000Z', { t })).toEqual(['fifth'])
    expect(ids('t?paid_on=lte.2026-10-05T23:30:00-05:00', { t })).toEqual(['fifth'])
    expect(ids('t?paid_on=eq.2026-10-06T18:00:00Z', { t })).toEqual(['sixth'])
    expect(ids('t?paid_on=in.(2026-10-05T12:00:00Z,2026-10-09T00:00:00Z)', { t })).toEqual(['fifth'])
    // A time column still compares as an instant.
    const times = [{ id: 'early', at: '2026-10-05T01:00:00Z' }, { id: 'late', at: '2026-10-05T06:00:00Z' }]
    expect(ids('t?at=gte.2026-10-05T05:00:00.000Z', { t: times })).toEqual(['late'])
  })

  it('applies every read operator to writes too', () => {
    // This used to match c-job1: writes applied only eq and is.null, so a
    // PATCH the database would apply to no row looked like it succeeded.
    const patched = read('fh_contacts?id=eq.c-job1&stage=in.(lead)', { method: 'PATCH', body: { notes: 'x' } })
    expect(patched.status).toBe(200)
    expect(patched.json).toEqual([])
    const sent = read('fh_invoices?status=neq.sent&select=id', { method: 'PATCH', body: { notes: 'x' } })
    expect((sent.json as Row[]).map((r) => r.id)).toEqual(['inv0'])
  })

  it('exposes the same rules as a pure helper', () => {
    const rows = [{ id: 1, v: 'b' }, { id: 2, v: 'a' }, { id: 3, v: 'c' }]
    expect(queryRows(rows, '?v=neq.c&order=v.asc')).toEqual({ rows: [rows[1], rows[0]], total: 2, offset: 0 })
  })
})

describe('qa mock refuses what the database would refuse', () => {
  // The names come from src/lib/database.types.ts. Before this, an unknown
  // function, table or column got a 200, so a call production cannot serve
  // passed every e2e spec.
  it('answers 404 PGRST202 for a function the schema does not have', () => {
    const res = rpcResponse('fh_no_such_function', {})
    expect(res.status).toBe(404)
    expect(JSON.parse(res.body)).toMatchObject({ code: 'PGRST202' })
  })

  it('answers 404 PGRST202 for a known function called with arguments it does not take', () => {
    expect(rpcResponse('fh_money_visible', { org_id: 'org-1' }).status).toBe(404)
    expect(rpcResponse('fh_money_visible', {}).status).toBe(404)
    expect(JSON.parse(rpcResponse('fh_money_visible', { p_org_id: 'org-1' }).body)).toBe(true)
  })

  it('answers whether money is visible from the signed in role, as the database does', () => {
    const crew = { org_members: [{ org_id: 'org-1', user_id: 'qa-user-1', role: 'crew', revoked_at: null }] }
    expect(JSON.parse(rpcResponse('fh_money_visible', { p_org_id: 'org-1' }, crew).body)).toBe(false)
  })

  it('answers 404 42P01 for a table the schema does not have, on reads and writes', () => {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      const res = read('fh_no_such_table?select=*', { method, body: {} })
      expect(res.status, method).toBe(404)
      expect(res.json, method).toMatchObject({ code: '42P01' })
    }
  })

  it('answers 400 PGRST204 for an unknown column in a select', () => {
    const res = read('fh_invoices?select=id,no_such_column')
    expect(res.status).toBe(400)
    expect(res.json).toMatchObject({ code: 'PGRST204' })
    expect(res.json.message).toContain('no_such_column')
    expect(read('fh_contacts?select=id,fh_clients(name,no_such_column)').status).toBe(400)
    expect(read('fh_contacts?select=id,no_such_table(name)').status).toBe(400)
    // Aliases, casts, json paths, embeds by table or by foreign key column
    expect(read('fh_contacts?select=id,who:name,amount::text,milestones->0,fh_clients!inner(name),client:client_id(name)').status).toBe(200)
  })

  it('answers 400 for an unknown column in a filter or an order', () => {
    expect(read('fh_invoices?no_such_column=eq.1').status).toBe(400)
    expect(read('fh_invoices?order=no_such_column.desc').status).toBe(400)
  })

  it('answers 400 PGRST204 for an unknown column in an insert or a patch', () => {
    const insert = read('fh_payments?select=*', { method: 'POST', body: { amount: 10, invoice_idd: 'inv1' } })
    expect(insert.status).toBe(400)
    expect(insert.json).toMatchObject({ code: 'PGRST204' })
    expect(insert.json.message).toContain('invoice_idd')
    expect(read('fh_payments', { method: 'POST', body: [{ amount: 1 }, { amount: 2, nope: 1 }] }).status).toBe(400)
    expect(read('fh_invoices?id=eq.inv1', { method: 'PATCH', body: { status: 'paid', paid: true } }).status).toBe(400)
    expect(read('fh_payments', { method: 'POST', body: { amount: 10, invoice_id: 'inv1' } }).status).toBe(200)
  })

  it('answers 501 for a write filter it does not apply, instead of writing every row', () => {
    for (const filter of ['or=(status.eq.sent,status.eq.paid)', 'title=ilike.*draw*', 'fh_clients.name=eq.Jeff']) {
      const res = read(`fh_invoices?${filter}`, { method: 'PATCH', body: { notes: 'x' } })
      expect(res.status, filter).toBe(501)
    }
  })

  it('answers 404 for an /api path no Netlify function serves', () => {
    expect(apiStatus('https://app.local/api/send-invoice')).toBe(200)
    expect(apiStatus('https://app.local/api/org-members-list?org=1')).toBe(200)
    expect(apiStatus('https://app.local/api/no-such-function')).toBe(404)
  })
})

describe('qa mock QA_NOW', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('throws at load when QA_NOW does not parse, naming the variable and the value', async () => {
    vi.stubEnv('QA_NOW', 'next Tuesday')
    vi.resetModules()
    await expect(import('../../scripts/qa-mock.mjs')).rejects.toThrow(/QA_NOW.*"next Tuesday"/)
  })

  it('throws at load when QA_NOW has no zone, since Node would read it in the host zone', async () => {
    for (const value of ['2026-10-08 14:00', '2026-10-08T14:00:00', '2026-10-08', 'Thu Oct 08 2026 09:00:00']) {
      vi.stubEnv('QA_NOW', value)
      vi.resetModules()
      await expect(import('../../scripts/qa-mock.mjs'), value).rejects.toThrow(new RegExp(`QA_NOW.*zone.*${JSON.stringify(value)}`))
    }
  })

  it('reads a QA_NOW with an offset as that instant', async () => {
    vi.stubEnv('QA_NOW', '2026-10-08T09:00:00-05:00')
    vi.resetModules()
    const mock = await import('../../scripts/qa-mock.mjs')
    expect(mock.session.expires_at).toBe(Date.parse('2026-10-08T14:00:00.000Z') / 1000 + 86400)
  })

  it('builds its clock from a valid QA_NOW', async () => {
    vi.stubEnv('QA_NOW', '2026-10-08T14:00:00.000Z')
    vi.resetModules()
    const mock = await import('../../scripts/qa-mock.mjs')
    expect(mock.session.expires_at).toBe(Date.parse('2026-10-08T14:00:00.000Z') / 1000 + 86400)
  })

  it('uses the real clock when QA_NOW is empty', async () => {
    vi.stubEnv('QA_NOW', '')
    vi.resetModules()
    const before = Math.floor(Date.now() / 1000)
    const mock = await import('../../scripts/qa-mock.mjs')
    expect(mock.session.expires_at).toBeGreaterThanOrEqual(before + 86400)
  })
})
