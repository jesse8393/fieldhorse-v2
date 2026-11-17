import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHandler } from '../../netlify/functions/client-error.js'
import { cleanErrorReport } from './errorReport.js'

// /api/client-error is the one place a crash on a phone reaches anyone.
// It must log one short line with no customer data in it, and a flood
// must not be able to fill the logs.

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://app.local/api/client-error', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': '203.0.113.9', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })
}

function handlerWith({ allowed = true }: { allowed?: boolean } = {}) {
  const rpc = vi.fn(async () => ({ data: [{ request_count: 1, allowed }], error: null }))
  const handler = createHandler({
    env: { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' },
    createClient: () => ({ rpc }) as any
  })
  return { handler, rpc }
}

afterEach(() => vi.restoreAllMocks())

describe('cleanErrorReport', () => {
  it('keeps the four fields, trimmed and capped', () => {
    const out = cleanErrorReport({ route: '/invoices', build: 'abc123 · 2026-11-17', message: `  ${'x'.repeat(900)}  `, kind: 'route', extra: 'dropped' })
    expect(Object.keys(out).sort()).toEqual(['build', 'kind', 'message', 'route'])
    expect(out.message.length).toBeLessThanOrEqual(300)
    expect(out.route).toBe('/invoices')
    expect(out.kind).toBe('route')
  })

  it('drops record ids, link tokens, query strings and anything after the first line', () => {
    expect(cleanErrorReport({ route: '/jobs/2f1c9a7e-1b2c-4d5e-8f90-123456789abc/complete?x=1#y' }).route).toBe('/jobs/:id/complete')
    expect(cleanErrorReport({ route: '/p/Zx81kQ2mT0aBcDeFgHiJkLmNoP' }).route).toBe('/p/:id')
    expect(cleanErrorReport({ route: 'https://evil.example/x' }).route).toBe('')
    expect(cleanErrorReport({ message: 'Boom\n    at render (Invoices.tsx:12)' }).message).toBe('Boom')
  })

  it('removes customer data a database error can carry', () => {
    const { message } = cleanErrorReport({
      message: 'duplicate key value violates unique constraint "fh_clients_email_key" Key (email)=(jeff@roy.com) phone 555-0101 amount 2960.50'
    })
    expect(message).not.toContain('jeff@roy.com')
    expect(message).not.toContain('555-0101')
    expect(message).not.toContain('2960')
    expect(message).toContain('duplicate key value violates unique constraint')
  })

  it('reads an unknown kind as other and a missing field as empty', () => {
    expect(cleanErrorReport({ kind: 'drop table' })).toEqual({ route: '', build: '', message: '', kind: 'other' })
    expect(cleanErrorReport(null)).toEqual({ route: '', build: '', message: '', kind: 'other' })
  })
})

describe('client-error function', () => {
  it('logs one structured line and answers 204', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { handler, rpc } = handlerWith()
    const res = await handler(post({ route: '/invoices', build: 'abc123', message: "Cannot read properties of undefined (reading 'slice')", kind: 'route', row: { name: 'Jeff Roy' } }))
    expect(res.status).toBe(204)
    expect(log).toHaveBeenCalledTimes(1)
    const [line] = log.mock.calls[0]
    expect(JSON.parse(line as string)).toEqual({
      at: 'client-error', kind: 'route', route: '/invoices', build: 'abc123', message: "Cannot read properties of undefined (reading 'slice')"
    })
    expect(line).not.toContain('Jeff')
    expect(rpc).toHaveBeenCalledWith('fh_increment_rate_limit', expect.objectContaining({ p_scope: 'client-error' }))
  })

  it('logs nothing and answers 429 once the caller is over the limit', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { handler } = handlerWith({ allowed: false })
    const res = await handler(post({ message: 'x', kind: 'window' }))
    expect(res.status).toBe(429)
    expect(log).not.toHaveBeenCalled()
  })

  it('refuses other methods, bad JSON and oversized bodies without logging', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { handler, rpc } = handlerWith()
    expect((await handler(new Request('https://app.local/api/client-error'))).status).toBe(405)
    expect((await handler(post('{not json'))).status).toBe(400)
    expect((await handler(post({ message: 'x'.repeat(5000) }))).status).toBe(413)
    expect(log).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('answers 500 without logging the report when the server has no database keys', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handler = createHandler({ env: {}, createClient: () => { throw new Error('not reached') } })
    expect((await handler(post({ message: 'x' }))).status).toBe(500)
    expect(log).not.toHaveBeenCalled()
  })
})
