import { beforeEach, describe, expect, it, vi } from 'vitest'

// PostgREST fake that answers by table and records every request in order.
type Req = { table: string; calls: [string, ...unknown[]][] }
const requests: Req[] = []
let existingClients: { id: string; name: string; phone: string | null; email: string | null }[] = []
let failLeadInsertAt = -1

function builder(table: string): unknown {
  const req: Req = { table, calls: [] }
  requests.push(req)
  const proxy: unknown = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          const insert = req.calls.find((c) => c[0] === 'insert')
          let response: { data: unknown; error: unknown; count?: number }
          if (!insert) {
            const range = req.calls.find((c) => c[0] === 'range') as [string, number, number] | undefined
            const rows = table === 'fh_clients' ? existingClients : []
            response = { data: range ? rows.slice(range[1], range[2] + 1) : rows, error: null }
          } else if (table === 'fh_leads') {
            const index = requests.filter((r) => r.table === 'fh_leads' && r.calls.some((c) => c[0] === 'insert')).indexOf(req)
            const rows = insert[1] as unknown[]
            response = index === failLeadInsertAt
              ? { data: null, error: { message: 'boom' } }
              : { data: null, error: null, count: rows.length }
          } else {
            const rows = (Array.isArray(insert[1]) ? insert[1] : [insert[1]]) as { id?: string }[]
            const withIds = rows.map((r, i) => ({ ...r, id: r.id ?? `made-${requests.length}-${i}` }))
            response = { data: Array.isArray(insert[1]) ? withIds : withIds[0], error: null }
          }
          return Promise.resolve(response).then(resolve, reject)
        }
      }
      return (...args: unknown[]) => { req.calls.push([String(prop), ...args]); return proxy }
    },
  })
  return proxy
}

vi.mock('./supabase.ts', () => ({ supabase: { from: (t: string) => builder(t) } }))
vi.mock('./queryClient.ts', () => ({ queryClient: { invalidateQueries: () => Promise.resolve() } }))

const { runImport } = await import('./importRun.ts')

function rec(name: string, phone: string | null = null, email: string | null = null, job_title: string | null = null) {
  return { name, phone, email, address: null, job_title, job_type: null, amount: 0 }
}

function inserts(table: string) {
  return requests.filter((r) => r.table === table && r.calls.some((c) => c[0] === 'insert'))
    .map((r) => r.calls.find((c) => c[0] === 'insert')![1] as Record<string, unknown>[] | Record<string, unknown>)
}

let n = 0
const newId = () => `new-${++n}`

beforeEach(() => {
  requests.length = 0
  existingClients = []
  failLeadInsertAt = -1
  n = 0
})

describe('runImport (D12)', () => {
  it('reads clients once and writes clients and leads in chunks, not one request per row', async () => {
    const records = Array.from({ length: 450 }, (_, i) => rec(`Person ${i}`, `615555${String(i).padStart(4, '0')}`))
    const res = await runImport({ userId: 'u1', orgId: 'o1', records, chunk: 200, newId })
    expect(res.error).toBeNull()
    expect(res.landed).toBe(450)
    // One client read, then per chunk one client insert and one lead insert.
    expect(requests.length).toBe(1 + 3 * 2)
    expect(inserts('fh_leads').map((b) => (b as unknown[]).length)).toEqual([200, 200, 50])
  })

  it('matches clients already on file by phone, then email, then name, in memory', async () => {
    existingClients = [
      { id: 'c-phone', name: 'Ada', phone: '(615) 555-0111', email: null },
      { id: 'c-email', name: 'Ben', phone: null, email: 'ben@ortiz.com' },
      { id: 'c-name', name: 'Cy Moss', phone: null, email: null },
    ]
    await runImport({
      userId: 'u1', orgId: 'o1', newId,
      records: [rec('Ada Stone', '615.555.0111'), rec('B Ortiz', null, 'BEN@ortiz.com'), rec('cy moss'), rec('Dee New')],
    })
    expect((inserts('fh_clients')[0] as unknown[]).length).toBe(1)
    expect((inserts('fh_leads')[0] as { client_id: string }[]).map((l) => l.client_id)).toEqual(['c-phone', 'c-email', 'c-name', 'new-1'])
  })

  it('gives rows in one file that name the same person one new client', async () => {
    await runImport({ userId: 'u1', orgId: null, newId, records: [rec('Ada', '6155550111', null, 'A'), rec('Ada S', '615-555-0111', null, 'B')] })
    expect((inserts('fh_clients')[0] as unknown[]).length).toBe(1)
    expect((inserts('fh_leads')[0] as { client_id: string }[]).map((l) => l.client_id)).toEqual(['new-1', 'new-1'])
  })

  it('writes the clients and leads of each chunk together, so a failure leaves earlier chunks whole', async () => {
    failLeadInsertAt = 1
    const records = Array.from({ length: 5 }, (_, i) => rec(`P${i}`, `61555500${i}0`))
    const res = await runImport({ userId: 'u1', orgId: 'o1', records, chunk: 2, newId })
    expect(res.landed).toBe(2)
    expect(res.error?.message).toBe('boom')
    expect(requests.map((r) => r.table)).toEqual(['fh_clients', 'fh_clients', 'fh_leads', 'fh_clients', 'fh_leads'])
  })
})
