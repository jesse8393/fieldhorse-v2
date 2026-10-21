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
    reset() { state.tables = {}; state.inserts = []; state.rpcs = []; state.rpcResult = null },
  }
  let nextId = 1
  function from(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    let inserted: Row[] | null = null
    const chain: any = {
      select() { return chain },
      eq(col: string, value: unknown) { filters.push((r) => r[col] === value); return chain },
      in(col: string, values: unknown[]) { filters.push((r) => values.includes(r[col])); return chain },
      order() { return chain },
      limit() { return chain },
      ilike(col: string, pattern: string) {
        const needle = pattern.replace(/%/g, '').toLowerCase()
        filters.push((r) => String(r[col] ?? '').toLowerCase().includes(needle))
        return chain
      },
      insert(payload: Row | Row[]) {
        inserted = (Array.isArray(payload) ? payload : [payload]).map((p) => {
          const row = { id: `${table}-${nextId++}`, ...p }
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
  getWebhookRateLimitPerMinute
} from '../../netlify/functions/webhook-lead.js'

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

  it('with no organization on the profile the client is written straight to fh_clients', async () => {
    fake.state.tables.profiles = [{ user_id: 'user-1', org_id: null, webhook_key: key }]
    const { status } = await post({ name: 'Ben Cole', phone: '615-555-0177' })
    expect(status).toBe(200)
    expect(fake.state.rpcs.find((r) => r.name === 'fh_resolve_client')).toBeUndefined()
    const client = fake.state.inserts.find((i) => i.table === 'fh_clients')?.row
    expect(client).toMatchObject({ user_id: 'user-1', name: 'Ben Cole', phone: '615-555-0177' })
    const lead = fake.state.inserts.find((i) => i.table === 'fh_leads')?.row
    expect(lead?.client_id).toBe(client?.id)
  })
})
