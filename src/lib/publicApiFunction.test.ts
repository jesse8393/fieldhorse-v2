import { describe, expect, it } from 'vitest'
import { edgeRuntime } from './edgeRuntimeTestUtils'
import { fakeClient, newState, type FakeState } from './teamAccountFakeSupabase'

// FN-22. The public-api edge function keyed its limiter on the first
// x-forwarded-for value, which the caller writes; it returned database
// error text to the caller; and a GET on an unsubscribe link, which is what
// a mail scanner does, opted the customer out.

const BASE = 'https://example.test/functions/v1/public-api'

function app(rpc: FakeState['rpc'] = {}, tables: FakeState['tables'] = {}) {
  const state = newState(tables)
  state.rpc = { fh_automation_tick: () => null, ...rpc }
  const runtime = edgeRuntime()
  runtime.createClient.mockImplementation(() => fakeClient(state) as any)
  return { state, call: runtime.endpoint('public-api') }
}

const formPost = (headers: Record<string, string>) => new Request(`${BASE}/forms/org-key/contact`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ name: 'Pat Lee', phone: '5125550101' }),
})

describe('public-api form limiter', () => {
  it('counts one caller however it fills the first x-forwarded-for value', async () => {
    const { call } = app({ fh_form_submit: () => ({ thank_you: 'Thanks' }) })
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      statuses.push((await call(formPost({ 'x-forwarded-for': `10.0.${i}.1, 203.0.113.7`, 'cf-connecting-ip': '203.0.113.7' }))).status)
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true)
    expect(statuses[10]).toBe(429)
  })

  it('uses the last x-forwarded-for hop, the one the platform added, when no edge address header is present', async () => {
    const { call } = app({ fh_form_submit: () => ({ thank_you: 'Thanks' }) })
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) statuses.push((await call(formPost({ 'x-forwarded-for': `10.0.${i}.1, 198.51.100.4` }))).status)
    expect(statuses[10]).toBe(429)
  })

  it('still lets two different callers post', async () => {
    const { call } = app({ fh_form_submit: () => ({ thank_you: 'Thanks' }) })
    for (let i = 0; i < 10; i++) await call(formPost({ 'cf-connecting-ip': '203.0.113.7' }))
    expect((await call(formPost({ 'cf-connecting-ip': '203.0.113.8' }))).status).toBe(200)
  })
})

describe('public-api errors', () => {
  const booking = () => new Request(`${BASE}/booking/org-key/estimate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ start: 'garbage', name: 'Pat Lee', phone: '5125550101' }),
  })

  it('answers a bad booking with a fixed message, not the database error text', async () => {
    const { call } = app({ fh_book_appointment: () => { throw new Error('invalid input syntax for type timestamp with time zone: "garbage"') } })
    const res = await call(booking())
    expect(res.status).toBe(400)
    const { error } = await res.json()
    expect(error).not.toMatch(/syntax|timestamp|garbage/)
    expect(error).toBe('Please check the details and try again.')
  })

  it('answers a database failure with a fixed message', async () => {
    const { call } = app({ fh_book_appointment: () => { throw new Error('relation "public.fh_booking_types" does not exist') } })
    const res = await call(booking())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Something went wrong. Please try again.')
  })

  it('keeps the plain reasons a booking page shows', async () => {
    const taken = app({ fh_book_appointment: () => { throw new Error('slot no longer available') } })
    const res = await taken.call(booking())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('That time is no longer available.')
  })
})

describe('public-api unsubscribe link', () => {
  const tables = () => ({ fh_conversations: [{ id: 'conv-1', org_id: 'org-1', client_id: 'client-1', email_thread_token: 'tok-1' }] })
  const consentCalls = (state: FakeState) => state.log.filter((l) => l.op === 'rpc' && l.fn === 'fh_consent_set')

  it('opening the link changes nothing and shows a button that posts', async () => {
    const { state, call } = app({ fh_consent_set: () => null }, tables())
    const res = await call(new Request(`${BASE}/u/tok-1`))
    expect(res.status).toBe(200)
    const page = await res.text()
    expect(page).toMatch(/<form method="post"/)
    expect(page).toMatch(/<button[^>]*>Unsubscribe<\/button>/)
    expect(consentCalls(state)).toEqual([])
  })

  it('a POST opts the customer out of email', async () => {
    const { state, call } = app({ fh_consent_set: () => null }, tables())
    const res = await call(new Request(`${BASE}/u/tok-1`, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } }))
    expect(res.status).toBe(200)
    expect(await res.text()).toMatch(/You are unsubscribed/)
    expect(consentCalls(state).map((l) => [l.payload.p_client_id, l.payload.p_channel, l.payload.p_status])).toEqual([['client-1', 'email', 'opted_out']])
  })
})
