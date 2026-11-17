import { beforeEach, describe, expect, it, vi } from 'vitest'

// Chainable PostgREST fake: every call on a builder is recorded and the
// builder resolves to the next queued response for its table.
type Call = [string, ...unknown[]]
const responses = new Map<string, { data: unknown; error: unknown }[]>()
const builders: { table: string; calls: Call[] }[] = []

function builder(table: string): unknown {
  const calls: Call[] = []
  builders.push({ table, calls })
  const response = responses.get(table)?.shift() ?? { data: [], error: null }
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
    }
  })
  return proxy
}

const rpcCalls: { name: string; args: unknown }[] = []
let rpcAnswer: { data: unknown; error: unknown } = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
vi.mock('./supabase.ts', () => ({
  supabase: {
    from: (table: string) => builder(table),
    // A real client reads its own fields, so an unbound call fails here too.
    rpc(this: { from?: unknown } | undefined, name: string, args: unknown) {
      if (typeof this?.from !== 'function') throw new TypeError("Cannot read properties of undefined (reading 'rest')")
      rpcCalls.push({ name, args })
      return Promise.resolve(rpcAnswer)
    }
  }
}))

const { findDuplicateClusters, clientPairKey, planClientMerge, mergeClients, CLIENT_REFERENCES, MOVED_BY_APP } = await import('./clientMerge.ts')

function client(id: string, fields: Record<string, unknown> = {}): any {
  return {
    id,
    user_id: 'u1',
    org_id: 'org1',
    name: id,
    company_name: null,
    phone: null,
    email: null,
    address: null,
    notes: null,
    active_jobs_count: 0,
    total_lifetime_value: 0,
    last_activity_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...fields
  }
}

function queue(table: string, ...items: { data: unknown; error: unknown }[]) {
  responses.set(table, [...(responses.get(table) || []), ...items])
}

beforeEach(() => {
  responses.clear()
  builders.length = 0
  rpcCalls.length = 0
  rpcAnswer = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
})

describe('findDuplicateClusters', () => {
  const a = client('a', { phone: '(615) 555-0101' })
  const b = client('b', { phone: '615-555-0101', email: 'pm@office.com' })
  const c = client('c', { email: 'PM@office.com ' })

  it('links clients transitively through a shared phone or email', () => {
    const clusters = findDuplicateClusters([a, b, c])
    expect(clusters).toHaveLength(1)
    expect(clusters[0].members.map((m) => m.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('stops linking a pair marked as different clients', () => {
    const clusters = findDuplicateClusters([a, b, c], new Set([clientPairKey('b', 'a')]))
    expect(clusters).toHaveLength(1)
    expect(clusters[0].members.map((m) => m.id).sort()).toEqual(['b', 'c'])
  })

  it('checks every pair in a shared group, not just links to the first row', () => {
    const x = client('x', { phone: '6155550199' })
    const y = client('y', { phone: '6155550199' })
    const z = client('z', { phone: '6155550199' })
    const clusters = findDuplicateClusters([x, y, z], new Set([clientPairKey('x', 'y'), clientPairKey('x', 'z')]))
    expect(clusters.map((cl) => cl.members.map((m) => m.id).sort())).toEqual([['y', 'z']])
  })
})

describe('planClientMerge', () => {
  it('keeps every note and records contact details that did not survive', () => {
    const survivor = client('s', { phone: '6155550101', email: 'jane@work.com', notes: 'Gate code 4411' })
    const loser = client('l', {
      phone: '(615) 555-0101',
      email: 'jane@home.com',
      notes: 'Dog in yard, call first',
      address: '12 Oak St'
    })
    expect(planClientMerge(survivor, [loser])).toEqual({
      address: '12 Oak St',
      notes: 'Gate code 4411\n\nDog in yard, call first\n\nOther email: jane@home.com'
    })
  })

  it('fills blank fields first, so a filled value is not repeated in the notes', () => {
    const survivor = client('s')
    const loser = client('l', { phone: '6155550101', email: 'jane@home.com' })
    expect(planClientMerge(survivor, [loser])).toEqual({ phone: '6155550101', email: 'jane@home.com' })
  })

  it('does not repeat text the survivor already holds (a merge run twice)', () => {
    const survivor = client('s', { phone: '6155550101', notes: 'Gate code 4411\n\nDog in yard\n\nOther phone: 615 555 0199' })
    const loser = client('l', { phone: '615 555 0199', notes: 'Dog in yard' })
    expect(planClientMerge(survivor, [loser])).toEqual({})
  })

  it('lists one line per distinct alternate number across losers', () => {
    const survivor = client('s', { phone: '6155550101' })
    const older = client('l1', { phone: '(615) 555-0199', created_at: '2025-01-01T00:00:00Z' })
    const newer = client('l2', { phone: '615.555.0199' })
    expect(planClientMerge(survivor, [newer, older]).notes).toBe('Other phone: (615) 555-0199')
  })
})

describe('mergeClients', () => {
  const survivor = client('s', { notes: 'Gate code 4411' })
  const loser = client('l', { notes: 'Dog in yard' })

  it('saves the survivor first, moves every record the app writes, checks nothing is left, then deletes by id only', async () => {
    queue('fh_clients', { data: [{ id: 's' }], error: null }, { data: [{ id: 'l' }], error: null })
    queue('fh_contacts', { data: [{ id: 'job1' }, { id: 'job2' }], error: null })
    queue('fh_leads', { data: [{ id: 'lead1' }], error: null })
    queue('fh_quotes', { data: [{ id: 'q1' }, { id: 'q2' }], error: null })
    queue('fh_invoices', { data: [{ id: 'inv1' }], error: null })
    const result = await mergeClients({ userId: 'u1', survivor, losers: [loser] })

    const tables = builders.map((b) => b.table)
    // The survivor update comes first and the delete comes last.
    expect(tables[0]).toBe('fh_clients')
    expect(tables[tables.length - 1]).toBe('fh_clients')
    const update = builders[0].calls
    expect(update).toContainEqual(['update', { notes: 'Gate code 4411\n\nDog in yard' }])
    expect(update).toContainEqual(['eq', 'id', 's'])

    // Leads, quotes, invoices, follow ups, jobs, statement links and
    // selections all move to the survivor before the delete.
    const deleteAt = tables.length - 1
    for (const table of ['fh_contacts', 'fh_leads', 'fh_quotes', 'fh_invoices', 'fh_follow_ups', 'fh_public_links', 'fh_selections']) {
      const moved = builders.findIndex((b) => b.table === table && b.calls.some((c) => c[0] === 'update'))
      expect(moved, table).toBeGreaterThan(0)
      expect(moved, table).toBeLessThan(deleteAt)
      expect(builders[moved].calls).toContainEqual(['update', { client_id: 's' }])
      expect(builders[moved].calls).toContainEqual(['in', 'client_id', ['l']])
    }

    // Every table that points at a client is read for the duplicate before the delete.
    for (const table of CLIENT_REFERENCES.map((r) => r.table)) {
      const read = builders.findIndex((b) => b.table === table && b.calls.some((c) => c[0] === 'select') && !b.calls.some((c) => c[0] === 'update'))
      expect(read, table).toBeGreaterThan(0)
      expect(read, table).toBeLessThan(deleteAt)
      expect(builders[read].calls).toContainEqual(['in', 'client_id', ['l']])
    }

    const del = builders[deleteAt].calls
    expect(del).toContainEqual(['delete'])
    expect(del).toContainEqual(['in', 'id', ['l']])
    // No user_id filter anywhere: RLS scopes the company, and a teammate's
    // client must merge like the caller's own.
    for (const b of builders) expect(b.calls.some((c) => c[1] === 'user_id')).toBe(false)
    expect(result).toEqual({
      reassigned: 2,
      moved: { jobs: 2, leads: 1, quotes: 2, invoices: 1 },
      deletedCount: 1,
      patch: { notes: 'Gate code 4411\n\nDog in yard' }
    })
  })

  it('does not delete the duplicate while anything still points at it', async () => {
    queue('fh_clients', { data: [{ id: 's' }], error: null })
    // The move answers, but a read afterwards still finds a message on the duplicate.
    queue('fh_messages', { data: [{ client_id: 'l' }], error: null })
    await expect(mergeClients({ userId: 'u1', survivor, losers: [loser] })).rejects.toThrow(/still has messages.*not deleted/i)
    expect(builders.some((b) => b.calls.some((c) => c[0] === 'delete'))).toBe(false)
  })

  it('does not delete when the check cannot be read', async () => {
    queue('fh_clients', { data: [{ id: 's' }], error: null })
    queue('fh_reviews', { data: null, error: { message: 'TypeError: Failed to fetch' } })
    await expect(mergeClients({ userId: 'u1', survivor, losers: [loser] })).rejects.toThrow(/Nothing was deleted/)
    expect(builders.some((b) => b.calls.some((c) => c[0] === 'delete'))).toBe(false)
  })

  it('stops before deleting when a move fails, in plain words', async () => {
    queue('fh_clients', { data: [{ id: 's' }], error: null })
    queue('fh_quotes', { data: null, error: { message: 'TypeError: Failed to fetch' } })
    const err = await mergeClients({ userId: 'u1', survivor, losers: [loser] }).catch((e) => e)
    expect(err.message).toMatch(/quotes/)
    expect(err.message).not.toMatch(/TypeError/)
    expect(builders.some((b) => b.calls.some((c) => c[0] === 'delete'))).toBe(false)
  })

  it('uses the database merge when it exists, then still checks before deleting', async () => {
    rpcAnswer = { data: { jobs: 1, leads: 2, quotes: 1, invoices: 3 }, error: null }
    queue('fh_clients', { data: [{ id: 's' }], error: null }, { data: [{ id: 'l' }], error: null })
    // Tags the survivor already holds stay behind on the duplicate by design.
    queue('fh_client_tags', { data: [{ client_id: 'l' }], error: null })
    const result = await mergeClients({ userId: 'u1', survivor, losers: [loser] })
    expect(rpcCalls).toEqual([{ name: 'fh_merge_client_into', args: { p_survivor: 's', p_duplicates: ['l'] } }])
    expect(result.moved).toEqual({ jobs: 1, leads: 2, quotes: 1, invoices: 3 })
    expect(result.deletedCount).toBe(1)
  })

  it('stops on a database merge refusal without falling back or deleting', async () => {
    rpcAnswer = { data: null, error: { code: '42501', message: 'not allowed' } }
    queue('fh_clients', { data: [{ id: 's' }], error: null })
    await expect(mergeClients({ userId: 'u1', survivor, losers: [loser] })).rejects.toThrow(/Nothing was deleted/)
    expect(builders.some((b) => b.calls.some((c) => c[0] === 'delete'))).toBe(false)
  })

  it('stops before moving anything when the survivor update changes no row', async () => {
    queue('fh_clients', { data: [], error: null })
    await expect(mergeClients({ userId: 'u1', survivor, losers: [loser] })).rejects.toThrow(/client you're keeping/)
    expect(builders.map((b) => b.table)).toEqual(['fh_clients'])
  })

  it('reports a delete that removed nothing as a failure', async () => {
    queue('fh_clients', { data: [{ id: 's' }], error: null }, { data: [], error: null })
    await expect(mergeClients({ userId: 'u1', survivor, losers: [loser] })).rejects.toThrow(/duplicate records/)
  })
})

// Every table with a foreign key to fh_clients, from the generated types and
// from every migration file (including the captured production ones). A new
// reference that the merge does not know about fails here.
describe('CLIENT_REFERENCES', () => {
  it('lists every table that references a client', async () => {
    const { readFileSync, readdirSync } = await import('node:fs')
    const root = new URL('../../', import.meta.url)
    const found = new Set<string>()

    const types = readFileSync(new URL('src/lib/database.types.ts', root), 'utf8').split('\n')
    let section = ''
    let table = ''
    for (const line of types) {
      const sec = line.match(/^ {4}(Tables|Views|Functions|Enums|CompositeTypes): \{/)
      if (sec) { section = sec[1]; continue }
      const t = line.match(/^ {6}([a-z_0-9]+): \{/)
      if (t) { table = t[1]; continue }
      if (section === 'Tables' && line.includes('referencedRelation: "fh_clients"')) found.add(table)
    }

    for (const dir of ['supabase/migrations/', 'supabase/reference/deployed_migrations/']) {
      for (const file of readdirSync(new URL(dir, root))) {
        if (!file.endsWith('.sql')) continue
        const sql = readFileSync(new URL(dir + file, root), 'utf8')
        const blocks = sql.split(/(?=create table|alter table)/i)
        for (const block of blocks) {
          if (!/references\s+(public\.)?fh_clients\b/i.test(block)) continue
          const name = block.match(/^(?:create table(?: if not exists)?|alter table(?: only)?(?: if exists)?)\s+(?:public\.)?([a-z_0-9]+)/i)?.[1]
          if (name && name !== 'fh_clients') found.add(name)
        }
      }
    }

    expect(found.size).toBeGreaterThan(20)
    expect(CLIENT_REFERENCES.map((r) => r.table).sort()).toEqual([...found].sort())
    for (const t of MOVED_BY_APP) expect(found.has(t)).toBe(true)
  })
})
