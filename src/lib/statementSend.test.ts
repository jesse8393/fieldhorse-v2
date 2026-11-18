import { afterEach, describe, expect, it, vi } from 'vitest'

// The statement email keeps one send id, and the PDF its first try
// uploaded, for every retry until the email goes out, so the server's
// provider key is the same and the customer gets one email (double-tap-7).

vi.mock('./supabase.ts', () => ({
  supabase: { storage: { from: () => ({ upload: async () => ({ data: { path: 'p' }, error: null }) }) } },
  authHeaders: async () => ({})
}))
vi.mock('./pdf.js', () => ({
  generateStatement: vi.fn(() => ({ doc: { output: () => new Blob(['%PDF']) }, filename: 'statement.pdf' })),
  downloadPdf: vi.fn()
}))

const { sendStatementEmail } = await import('./statement.ts')

const client = { id: 'cl-send', name: 'Jeff Roy', email: 'jeff@roy.com' }
const data = { lines: [{ contactId: 'j1', label: 'Driveway', balance: 6400 }], totalDue: 6400, notInvoiced: [] } as any

function bodies() {
  return vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)))
}

afterEach(() => { vi.unstubAllGlobals() })

describe('sendStatementEmail repeats a send that did not go out', () => {
  it('sends the same id and PDF on a retry, and a new id once it went out', async () => {
    const answers = [
      new Response(JSON.stringify({ error: 'send_failed' }), { status: 502 }),
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    ]
    vi.stubGlobal('fetch', vi.fn(async () => answers.shift()!))
    const args = { company: {}, client, data, userId: 'u-1', recipientEmail: 'jeff@roy.com' }
    expect((await sendStatementEmail(args)).ok).toBe(false)
    expect((await sendStatementEmail(args)).ok).toBe(true)
    expect((await sendStatementEmail(args)).ok).toBe(true)
    const [first, retry, next] = bodies()
    expect(first.send_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(retry.send_id).toBe(first.send_id)
    expect(retry.storage_path).toBe(first.storage_path)
    expect(next.send_id).not.toBe(first.send_id)
  })

  it('starts a new send when what the statement says changed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'send_failed' }), { status: 502 })))
    const args = { company: {}, client: { ...client, id: 'cl-changed' }, data, userId: 'u-1', recipientEmail: 'jeff@roy.com' }
    await sendStatementEmail(args)
    await sendStatementEmail({ ...args, data: { ...data, totalDue: 3200 } })
    const [first, changed] = bodies()
    expect(changed.send_id).not.toBe(first.send_id)
  })
})
