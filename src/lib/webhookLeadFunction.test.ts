import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// In memory stand in for the service role client the function builds:
// from(table) records inserts and answers lookups, rpc records its calls.
// A test that needs it fills `fake.tables` and reads `fake.inserts` and
// `fake.rpcs`; the guard tests above it never reach createClient.
const fake = vi.hoisted(() => {
  type Row = Record<string, any>
  const state = {
    tables: {} as Record<string, Row[]>,
    inserts: [] as Array<{ table: string; row: Row }>,
    rpcs: [] as Array<{ name: string; args: Row }>,
    rpcResult: null as any,
    // An error the next insert into this table answers with.
    failInsert: {} as Record<string, { code: string; message: string; details?: string }>,
    reset() { state.tables = {}; state.inserts = []; state.rpcs = []; state.rpcResult = null; state.failInsert = {} },
  }
  let nextId = 1
  function from(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    let inserted: Row[] | null = null
    let insertError: { code: string; message: string } | null = null
    const chain: any = {
      select() { return chain },
      eq(col: string, value: unknown) { filters.push((r) => r[col] === value); return chain },
      in(col: string, values: unknown[]) { filters.push((r) => values.includes(r[col])); return chain },
      is(col: string, value: unknown) { filters.push((r) => (r[col] ?? null) === value); return chain },
      gte(col: string, value: any) { filters.push((r) => r[col] >= value); return chain },
      order() { return chain },
      limit() { return chain },
      ilike(col: string, pattern: string) {
        const needle = pattern.replace(/%/g, '').toLowerCase()
        filters.push((r) => String(r[col] ?? '').toLowerCase().includes(needle))
        return chain
      },
      insert(payload: Row | Row[]) {
        const list = Array.isArray(payload) ? payload : [payload]
        if (state.failInsert[table]) {
          insertError = state.failInsert[table]
          return chain
        }
        // The primary key is unique, as in the database.
        if (list.some((p) => p.id && (state.tables[table] ?? []).some((r) => r.id === p.id))) {
          insertError = { code: '23505', message: 'duplicate key value violates unique constraint' }
          return chain
        }
        inserted = list.map((p) => {
          const row = { id: `${table}-${nextId++}`, created_at: new Date().toISOString(), ...p }
          state.inserts.push({ table, row })
          ;(state.tables[table] ||= []).push(row)
          return row
        })
        return chain
      },
      maybeSingle() { return Promise.resolve({ data: chain.rows()[0] ?? null, error: null }) },
      single() { return Promise.resolve({ data: chain.rows()[0] ?? null, error: null }) },
      rows() { return inserted ?? (state.tables[table] ?? []).filter((r) => filters.every((f) => f(r))) },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        if (insertError) return Promise.resolve({ data: null, error: insertError }).then(resolve, reject)
        return Promise.resolve({ data: chain.rows(), error: null }).then(resolve, reject)
      },
    }
    return chain
  }
  const client = {
    from,
    rpc(name: string, args: Row) {
      state.rpcs.push({ name, args })
      if (name === 'fh_resolve_client') return Promise.resolve({ data: state.rpcResult, error: null })
      return Promise.resolve({ data: [{ allowed: true, request_count: 1 }], error: null })
    },
  }
  return { state, client }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fake.client }))
vi.mock('../../netlify/functions/lib/push.js', () => ({ sendPushToUser: vi.fn(async () => undefined) }))

import handler, {
  fingerprintWebhookKey,
  getWebhookRateBucketStart,
  getWebhookRateLimitPerMinute,
  leadIdForIdempotencyKey,
  leadNotes
} from '../../netlify/functions/webhook-lead.js'
import { sendPushToUser } from '../../netlify/functions/lib/push.js'

const OLD_ENV = { ...process.env }

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key'
})

afterEach(() => {
  process.env = { ...OLD_ENV }
})

describe('webhook-lead function guards', () => {
  it('normalizes webhook rate-limit configuration', () => {
    expect(getWebhookRateLimitPerMinute(undefined)).toBe(60)
    expect(getWebhookRateLimitPerMinute('15')).toBe(15)
    expect(getWebhookRateLimitPerMinute('-4')).toBe(60)
    expect(getWebhookRateLimitPerMinute('5000')).toBe(1000)
  })

  it('hashes webhook keys without exposing the raw secret', () => {
    const hash = fingerprintWebhookKey('super-secret-webhook-key')
    expect(hash).toHaveLength(64)
    expect(hash).not.toContain('super-secret')
    expect(hash).toBe(fingerprintWebhookKey('super-secret-webhook-key'))
  })

  it('rounds rate-limit buckets to the configured window', () => {
    const bucket = getWebhookRateBucketStart(new Date('2026-06-18T12:34:56.789Z'), 60)
    expect(bucket).toBe('2026-06-18T12:34:00.000Z')
  })

  it('rejects oversized lead payloads before parsing or inserting', async () => {
    const request = new Request(`https://fieldhorse.test/api/webhook-lead?key=${'a'.repeat(16)}`, {
      method: 'POST',
      body: JSON.stringify({ name: 'A'.repeat(70 * 1024) }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await handler(request)
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error).toBe('payload_too_large')
  })
})

describe('webhook-lead writes the new records', () => {
  const key = 'k'.repeat(24)

  beforeEach(() => {
    fake.state.reset()
    fake.state.tables.profiles = [{ user_id: 'user-1', org_id: 'org-1', webhook_key: key }]
    fake.state.tables.org_members = [
      { user_id: 'user-1', org_id: 'org-1', role: 'owner', joined_at: '2026-01-01T00:00:00Z', revoked_at: null },
    ]
  })

  async function post(payload: Record<string, unknown>) {
    const request = new Request(`https://fieldhorse.test/api/webhook-lead?key=${key}`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler(request)
    return { status: response.status, body: await response.json() }
  }

  it('a webhook lead becomes a client and a lead', async () => {
    fake.state.rpcResult = [{ client_id: 'client-9', is_new: true }]
    const { status, body } = await post({
      name: 'Ana Ruiz', phone: '615-555-0142', email: 'ana@ruiz.com', address: '12 Oak St',
      job_title: 'Deck rebuild', job_type: 'Deck', amount: 4500, notes: 'Call after 5', source: 'website',
    })
    expect(status).toBe(200)
    // The client is matched or made by the database helper the inbound
    // text and email paths already use, inside the company.
    const resolve = fake.state.rpcs.find((r) => r.name === 'fh_resolve_client')
    expect(resolve?.args).toMatchObject({
      p_org_id: 'org-1', p_phone: '615-555-0142', p_email: 'ana@ruiz.com', p_name: 'Ana Ruiz', p_address: '12 Oak St', p_source: 'website',
    })
    // The lead lands in fh_leads pointing at that client; fh_contacts is never written.
    const tables = fake.state.inserts.map((i) => i.table)
    expect(tables).not.toContain('fh_contacts')
    const lead = fake.state.inserts.find((i) => i.table === 'fh_leads')?.row
    expect(lead).toMatchObject({
      user_id: 'user-1', org_id: 'org-1', client_id: 'client-9', status: 'open',
      title: 'Deck rebuild', job_type: 'Deck', source: 'website',
    })
    expect(lead?.notes).toContain('Call after 5')
    expect(lead?.notes).toContain('4,500')
    // The bell row opens the lead.
    const notification = fake.state.inserts.find((i) => i.table === 'fh_notifications')?.row
    expect(notification?.link).toBe(`/leads/${lead?.id}`)
    expect(notification?.kind).toBe('new_lead')
    expect(body).toMatchObject({ ok: true, id: lead?.id, client_id: 'client-9' })
  })

  it('a failed insert logs one line with no customer data in it', async () => {
    fake.state.rpcResult = [{ client_id: 'client-9', is_new: true }]
    fake.state.failInsert.fh_leads = { code: '23505', message: 'duplicate key value violates unique constraint "fh_leads_pkey"', details: 'Key (email)=(ana@ruiz.com) already exists.' }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { status } = await post({ name: 'Ana Ruiz', phone: '615-555-0142', email: 'ana@ruiz.com', job_title: 'Deck rebuild' })
    expect(status).toBe(500)
    const lines = spy.mock.calls.map((c) => c.map(String).join(' '))
    spy.mockRestore()
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toMatchObject({ scope: 'webhook-lead', what: 'insert failed', code: '23505', org_id: 'org-1' })
    expect(lines[0]).not.toMatch(/ana@ruiz|615-555|Ana Ruiz|Key \(/)
  })

  // The company comes from the key owner's active membership. profiles.org_id
  // is not kept up to date by anything, so it is only a tie breaker.
  const storedTables = () => fake.state.inserts.map((i) => i.table)

  it('a key whose owner has no active company gets 409 and nothing is stored', async () => {
    fake.state.tables.profiles = [{ user_id: 'user-1', org_id: null, webhook_key: key }]
    fake.state.tables.org_members = []
    const { status, body } = await post({ name: 'Ben Cole', phone: '615-555-0177' })
    expect(status).toBe(409)
    expect(body.error).toBe('no_company')
    expect(body.detail).toEqual(expect.any(String))
    expect(storedTables()).toEqual([])
    expect(fake.state.rpcs.find((r) => r.name === 'fh_resolve_client')).toBeUndefined()
  })

  it('a profile with no org_id still lands the lead in the company the owner belongs to', async () => {
    fake.state.tables.profiles = [{ user_id: 'user-1', org_id: null, webhook_key: key }]
    fake.state.rpcResult = [{ client_id: 'client-9', is_new: true }]
    const { status } = await post({ name: 'Ben Cole', phone: '615-555-0177' })
    expect(status).toBe(200)
    expect(fake.state.rpcs.find((r) => r.name === 'fh_resolve_client')?.args.p_org_id).toBe('org-1')
    expect(fake.state.inserts.find((i) => i.table === 'fh_leads')?.row.org_id).toBe('org-1')
    expect(fake.state.inserts.find((i) => i.table === 'fh_notifications')?.row.org_id).toBe('org-1')
  })

  it('a key whose owner was removed from the company no longer writes into it', async () => {
    fake.state.tables.org_members = [
      { user_id: 'user-1', org_id: 'org-1', role: 'crew', joined_at: '2026-01-01T00:00:00Z', revoked_at: '2026-11-01T00:00:00Z' },
    ]
    fake.state.rpcResult = [{ client_id: 'client-9', is_new: true }]
    const { status, body } = await post({ name: 'Pat Lee', phone: '555-010-2222', job_title: 'Patio' })
    expect(status).toBe(409)
    expect(body.error).toBe('no_company')
    expect(storedTables()).toEqual([])
    expect(fake.state.rpcs.find((r) => r.name === 'fh_resolve_client')).toBeUndefined()
  })

  it('with several companies it uses the one on the profile when the owner is still in it', async () => {
    fake.state.tables.profiles = [{ user_id: 'user-1', org_id: 'org-2', webhook_key: key }]
    fake.state.tables.org_members = [
      { user_id: 'user-1', org_id: 'org-1', role: 'owner', joined_at: '2026-01-01T00:00:00Z', revoked_at: null },
      { user_id: 'user-1', org_id: 'org-2', role: 'manager', joined_at: '2026-06-01T00:00:00Z', revoked_at: null },
    ]
    fake.state.rpcResult = [{ client_id: 'client-9', is_new: true }]
    expect((await post({ name: 'Ben Cole' })).status).toBe(200)
    expect(fake.state.inserts.find((i) => i.table === 'fh_leads')?.row.org_id).toBe('org-2')
  })

  it('with several companies and a profile pointing at none of them it uses the oldest membership', async () => {
    fake.state.tables.profiles = [{ user_id: 'user-1', org_id: 'org-gone', webhook_key: key }]
    fake.state.tables.org_members = [
      { user_id: 'user-1', org_id: 'org-2', role: 'manager', joined_at: '2026-06-01T00:00:00Z', revoked_at: null },
      { user_id: 'user-1', org_id: 'org-1', role: 'owner', joined_at: '2026-01-01T00:00:00Z', revoked_at: null },
      { user_id: 'user-1', org_id: 'org-gone', role: 'crew', joined_at: '2025-01-01T00:00:00Z', revoked_at: '2025-06-01T00:00:00Z' },
    ]
    fake.state.rpcResult = [{ client_id: 'client-9', is_new: true }]
    expect((await post({ name: 'Ben Cole' })).status).toBe(200)
    expect(fake.state.inserts.find((i) => i.table === 'fh_leads')?.row.org_id).toBe('org-1')
  })
})

describe('webhook-lead treats a repeated delivery as the same lead', () => {
  const key = 'k'.repeat(24)
  const pat = { name: 'Pat Lee', phone: '555-010-2222', job_title: 'Patio', source: 'facebook' }
  const push = vi.mocked(sendPushToUser)

  beforeEach(() => {
    fake.state.reset()
    fake.state.tables.profiles = [{ user_id: 'user-1', org_id: 'org-1', webhook_key: key }]
    fake.state.tables.org_members = [
      { user_id: 'user-1', org_id: 'org-1', role: 'owner', joined_at: '2026-01-01T00:00:00Z', revoked_at: null },
    ]
    fake.state.rpcResult = [{ client_id: 'client-9', is_new: false }]
    push.mockReset()
    push.mockImplementation(async () => undefined)
  })

  async function post(payload: Record<string, unknown>, headers: Record<string, string> = {}, context?: unknown) {
    const request = new Request(`https://fieldhorse.test/api/webhook-lead?key=${key}`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json', ...headers },
    })
    const response = await (handler as any)(request, context)
    return { status: response.status, body: await response.json() }
  }
  const leads = () => fake.state.tables.fh_leads ?? []
  const alerts = () => fake.state.inserts.filter((i) => i.table === 'fh_notifications')

  it('the same body posted twice makes one lead and one alert', async () => {
    const first = await post(pat)
    const second = await post(pat)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(leads()).toHaveLength(1)
    expect(second.body).toMatchObject({ ok: true, id: first.body.id, client_id: 'client-9', duplicate: true })
    expect(first.body.duplicate).toBeUndefined()
    expect(alerts()).toHaveLength(1)
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('without a key, a different job, a closed lead or an old lead is not a repeat', async () => {
    await post(pat)
    await post({ ...pat, job_title: 'Driveway' })
    expect(leads()).toHaveLength(2)
    await post({ ...pat, source: 'website' })
    expect(leads()).toHaveLength(3)
    // The first lead was worked and is no longer open: the customer asking again is new.
    leads()[0].status = 'quoted'
    await post(pat)
    expect(leads()).toHaveLength(4)
    // Eleven minutes later the same request is a new lead.
    leads()[3].created_at = new Date(Date.now() - 11 * 60_000).toISOString()
    await post(pat)
    expect(leads()).toHaveLength(5)
  })

  it('a lead with no title repeats only another lead with no title', async () => {
    const bare = { name: 'Pat Lee', phone: '555-010-2222' }
    await post(pat)
    await post(bare)
    await post(bare)
    expect(leads()).toHaveLength(2)
  })

  it('an Idempotency-Key header reuses the lead made with it, whatever the body and however late', async () => {
    const first = await post(pat, { 'Idempotency-Key': 'zap-run-881' })
    leads()[0].created_at = '2026-01-01T00:00:00.000Z'
    leads()[0].status = 'quoted'
    const second = await post({ ...pat, job_title: 'Patio (retry)' }, { 'Idempotency-Key': 'zap-run-881' })
    expect(leads()).toHaveLength(1)
    expect(second.body).toMatchObject({ ok: true, id: first.body.id, client_id: 'client-9', duplicate: true })
    expect(alerts()).toHaveLength(1)
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('an external_id in the body works the same way', async () => {
    const first = await post({ ...pat, external_id: 'fb-lead-4471' })
    const second = await post({ ...pat, external_id: 'fb-lead-4471' })
    const numeric = await post({ ...pat, external_id: 4471 })
    await post({ ...pat, external_id: 4471 })
    expect(second.body.id).toBe(first.body.id)
    expect(numeric.body.id).not.toBe(first.body.id)
    expect(leads()).toHaveLength(2)
  })

  it('derives a well formed, stable uuid from the company and the key', () => {
    const id = leadIdForIdempotencyKey('org-1', 'zap-run-881')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(leadIdForIdempotencyKey('org-1', 'zap-run-881')).toBe(id)
    expect(leadIdForIdempotencyKey('org-2', 'zap-run-881')).not.toBe(id)
  })

  it('two different keys are two leads even when the body is identical', async () => {
    await post(pat, { 'Idempotency-Key': 'delivery-1' })
    await post(pat, { 'Idempotency-Key': 'delivery-2' })
    expect(leads()).toHaveLength(2)
    expect(alerts()).toHaveLength(2)
  })

  it('the same key under two companies never points at the same lead', async () => {
    const first = await post(pat, { 'Idempotency-Key': 'shared-key' })
    fake.state.tables.org_members[0].org_id = 'org-2'
    const second = await post(pat, { 'Idempotency-Key': 'shared-key' })
    expect(second.body.id).not.toBe(first.body.id)
    expect(second.body.duplicate).toBeUndefined()
    expect(leads().map((l) => l.org_id)).toEqual(['org-1', 'org-2'])
  })

  it('answers without waiting for the push, and hands it to the platform to finish', async () => {
    push.mockImplementation(() => new Promise<void>(() => {}))
    const waitUntil = vi.fn()
    const result = await Promise.race([
      post(pat, {}, { waitUntil }),
      new Promise<'held'>((resolve) => setTimeout(() => resolve('held'), 500)),
    ])
    expect(result).not.toBe('held')
    expect((result as { status: number }).status).toBe(200)
    expect(push).toHaveBeenCalledTimes(1)
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise)
  })

  it('a push that fails does not fail the lead or leave an unhandled rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    push.mockImplementation(async () => { throw new Error('push service down') })
    const waitUntil = vi.fn()
    const { status } = await post(pat, {}, { waitUntil })
    expect(status).toBe(200)
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

// formats-7: the amount a webhook lead carries is saved into its notes as
// money, "$1,000.50", never "$1,000.5".
describe('webhook lead notes', () => {
  it('writes the estimated amount with cents', () => {
    expect(leadNotes('', 1000.5)).toBe('Estimated amount $1,000.50')
    expect(leadNotes('', 4500)).toBe('Estimated amount $4,500.00')
    expect(leadNotes('Call after 5', 127.5)).toBe('Call after 5\nEstimated amount $127.50')
    expect(leadNotes('', 0)).toBeNull()
  })
})
