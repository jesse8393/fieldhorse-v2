import { describe, expect, it, vi } from 'vitest'
import { edgeRuntime } from './edgeRuntimeTestUtils'

const row = { id: 'outbox', org_id: 'company', client_id: 'client', message_id: 'message', agent_run_id: 'run', payload: {}, attempts: 1 }
const inbound = (body: string, day: number) => ({ channel: 'sms', direction: 'inbound', body, created_at: `2026-10-${day}T12:00:00Z` })
function agentFixture(options: { history?: any[]; historyError?: boolean; countError?: boolean; escalation?: boolean } = {}) {
  const rpc = vi.fn(async (fn: string) => ({ data: fn === 'fh_client_ctx' ? { client: {}, job: {} } : 'fixture', error: null }))
  const writes: any[] = []
  const from = (table: string) => {
    let head = false
    let patch: any
    const query: any = {
      select: (_: string, opts: any) => { head = !!opts?.head; return query },
      update: (value: any) => { patch = value; writes.push(value); return query },
      eq: () => query, neq: () => query, order: () => query, gte: () => query, limit: () => query, single: () => query, maybeSingle: () => query,
      then: (resolve: any) => {
        if (patch) return Promise.resolve({ data: { id: "run" }, error: null }).then(resolve)
        if (table === 'fh_agent_runs') return Promise.resolve({ data: { id: 'run', org_id: 'company', client_id: 'client', agent_id: 'agent', status: 'pending', mode: 'auto' } }).then(resolve)
        if (table === 'fh_agents') return Promise.resolve({ data: { id: 'agent', status: 'active', name: 'Fixture', autonomy: 'auto', guardrails: { escalate_keywords: ['lawyer'], max_messages_per_client_per_day: 3 } } }).then(resolve)
        return Promise.resolve(head ? { count: options.countError ? null : 0, error: options.countError ? { message: 'unavailable' } : null } : {
          data: options.history ?? [inbound('hello', 31)], error: options.historyError ? { message: 'unavailable' } : null
        }).then(resolve)
      }
    }
    return query
  }
  const content = [{ type: 'tool_use', name: 'propose_message', input: { channel: 'sms', body: 'A draft reply' } }]
  if (options.escalation) content.push({ type: 'tool_use', name: 'escalate', input: { summary: 'Owner review required' } } as any)
  const fetch = vi.fn(async () => new Response(JSON.stringify({ content }), { status: 200 }))
  const runtime = edgeRuntime({ ANTHROPIC_API_KEY: 'fixture' }, { fetch })
  const worker = runtime.load('automation-worker/index.ts', { './lib.ts': runtime.shared }).sandbox
  return { worker, db: { from, rpc }, rpc, fetch, writes }
}

describe('automation worker guardrails', () => {
  it('checks the most recent client message without reversing the original history', async () => {
    const history = [inbound('Please speak to my lawyer', 31), inbound('Hello', 30)]
    const fixture = agentFixture({ history })
    const result = await fixture.worker.runAgent(fixture.db, row)
    expect(result.result).toEqual({ status: 'proposed', reason: 'escalation keyword in last client message' })
    expect(history[0].body).toContain('lawyer')
    expect(fixture.rpc.mock.calls.some(([name]) => name === 'fh_agent_run_approve')).toBe(false)
  })

  it('keeps a reply as a draft when the daily limit cannot be verified', async () => {
    const fixture = agentFixture({ countError: true })
    expect((await fixture.worker.runAgent(fixture.db, row)).result.reason).toBe('could not verify daily agent message cap')
    expect(fixture.rpc.mock.calls.some(([name]) => name === 'fh_agent_run_approve')).toBe(false)
  })

  it('does not call the model if conversation history fails to load', async () => {
    const fixture = agentFixture({ historyError: true })
    await expect(fixture.worker.runAgent(fixture.db, row)).rejects.toThrow('conversation lookup failed')
    expect(fixture.fetch).not.toHaveBeenCalled()
  })

  it('requires review when the model escalates alongside a proposed message', async () => {
    const fixture = agentFixture({ escalation: true })
    expect((await fixture.worker.runAgent(fixture.db, row)).result.reason).toBe('agent requested owner review')
    expect(fixture.rpc.mock.calls.some(([name]) => name === 'fh_agent_run_approve')).toBe(false)
  })

  it('retains the configured automatic path when all guards pass', async () => {
    const fixture = agentFixture()
    expect((await fixture.worker.runAgent(fixture.db, row)).result.status).toBe('auto_executed')
    expect(fixture.rpc.mock.calls.filter(([name]) => name === 'fh_agent_run_approve')).toHaveLength(1)
  })

  it('rejects a message from another company or customer before provider access', async () => {
    const runtime = edgeRuntime()
    const worker = runtime.load('automation-worker/index.ts', { './lib.ts': runtime.shared }).sandbox
    for (const message of [{ org_id: 'foreign', client_id: 'client' }, { org_id: 'company', client_id: 'other' }]) {
      const query: any = { select: () => query, eq: () => query, single: async () => ({ data: message, error: null }) }
      await expect(worker.loadMessage({ from: () => query }, row)).rejects.toThrow('outbox context')
    }
  })

  it('rejects unsigned worker requests before creating a service client', async () => {
    const runtime = edgeRuntime()
    const response = await runtime.endpoint('automation-worker')(new Request('https://example.test/worker', { method: 'POST' }))
    expect(response.status).toBe(401)
    expect(runtime.createClient).not.toHaveBeenCalled()
  })
})

describe('outbound webhook boundary', () => {
  function fixture() {
    const fetch = vi.fn(async () => new Response('x'.repeat(20_000)))
    const runtime = edgeRuntime({ AUTOMATION_WEBHOOK_HOSTS: 'hooks.example.test' }, { fetch })
    return { fetch, worker: runtime.load('automation-worker/index.ts', { './lib.ts': runtime.shared }).sandbox }
  }
  it.each(['http://hooks.example.test/', 'https://127.0.0.1/', 'https://hooks.example.test.evil.test/', 'https://user:pass@hooks.example.test/', 'https://hooks.example.test:8080/'])('rejects an unapproved destination: %s', async (url) => {
    const { fetch, worker } = fixture()
    await expect(worker.callWebhook({}, { ...row, payload: { url } })).rejects.toThrow('not approved')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('prevents redirects, sets a timeout and bounds the returned response', async () => {
    const { fetch, worker } = fixture()
    const result = await worker.callWebhook({}, { ...row, payload: { url: 'https://hooks.example.test/endpoint' } })
    expect(result.result.response).toHaveLength(500)
    expect(fetch).toHaveBeenCalledWith('https://hooks.example.test/endpoint', expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }))
  })
})
