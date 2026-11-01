import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { edgeRuntime } from './edgeRuntimeTestUtils'

describe('recovered Jobber integration', () => {
  it('rejects unsigned webhook requests before accessing data', async () => {
    const runtime = edgeRuntime({ JOBBER_CLIENT_SECRET: 'test-only' })
    const response = await runtime.endpoint('jobber')(new Request('https://example.test/functions/v1/jobber/webhook', { method: 'POST', body: '{}' }))
    expect(response.status).toBe(403)
    expect(runtime.createClient).not.toHaveBeenCalled()
  })
  it('validates the exact webhook body', async () => {
    const runtime = edgeRuntime()
    const body = '{"test":true}'
    const signature = createHmac('sha256', 'test-only').update(body).digest('base64')
    const req = new Request('https://example.test', { headers: { 'x-jobber-hmac-sha256': signature } })
    expect(await runtime.shared.jobberSignatureOk(req, body, 'test-only')).toBe(true)
    expect(await runtime.shared.jobberSignatureOk(req, body + ' ', 'test-only')).toBe(false)
  })
  it('never exchanges a rotating refresh token while another worker holds its lease', async () => {
    const fetch = vi.fn()
    const runtime = edgeRuntime({}, { fetch, setTimeout: (fn: () => void) => { fn(); return 0 } })
    const jobber = runtime.load('jobber/index.ts', { './lib.ts': runtime.shared, 'jsr:@supabase/supabase-js@2': {} }).sandbox
    const rpc = vi.fn(async (name: string) => ({ error: null, data: name === 'fh_jobber_refresh_lease' ? false : {
      status: 'connected', access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_at: '2020-01-01T00:00:00Z'
    } }))
    await expect(jobber.accessToken({ rpc }, 'integration', true)).rejects.toThrow('refresh in progress')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not rotate valid tokens merely because the provider throttles a request', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 429 })).mockResolvedValueOnce(new Response('{"data":{"ok":true}}'))
    const runtime = edgeRuntime({}, { fetch, setTimeout: (fn: () => void) => { fn(); return 0 } })
    const jobber = runtime.load('jobber/index.ts', { './lib.ts': runtime.shared, 'jsr:@supabase/supabase-js@2': {} }).sandbox
    const rpc = vi.fn(async (name: string) => {
      if (name !== 'fh_jobber_tokens_get') throw new Error('Unexpected refresh')
      return { error: null, data: { status: 'connected', access_token: 'fixture-access', expires_at: new Date(Date.now() + 3600_000).toISOString() } }
    })
    expect((await jobber.gql({ rpc }, 'integration', 'query { fixture }', {})).data).toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('builds a valid empty acknowledgement for provider callbacks', () => {
    const { shared } = edgeRuntime()
    const response = shared.text('', 204)
    expect(response.status).toBe(204)
    expect(response.body).toBeNull()
  })
})
