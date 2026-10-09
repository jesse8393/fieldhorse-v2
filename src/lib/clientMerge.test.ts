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

vi.mock('./supabase.ts', () => ({ supabase: { from: (table: string) => builder(table) } }))

const { findDuplicateClusters, clientPairKey, planClientMerge, mergeClients } = await import('./clientMerge.ts')

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

  it('saves the survivor first, repoints jobs, links and selections, then deletes by id only', async () => {
    queue('fh_clients', { data: [{ id: 's' }], error: null }, { data: [{ id: 'l' }], error: null })
    queue('fh_contacts', { data: [{ id: 'job1' }, { id: 'job2' }], error: null })
    const result = await mergeClients({ userId: 'u1', survivor, losers: [loser] })

    expect(builders.map((b) => b.table)).toEqual([
      'fh_clients', 'fh_contacts', 'fh_public_links', 'fh_selections', 'fh_clients'
    ])
    const [update, jobs, links, selections, del] = builders.map((b) => b.calls)
    expect(update).toContainEqual(['update', { notes: 'Gate code 4411\n\nDog in yard' }])
    expect(update).toContainEqual(['eq', 'id', 's'])
    for (const calls of [jobs, links, selections]) {
      expect(calls).toContainEqual(['update', { client_id: 's' }])
      expect(calls).toContainEqual(['in', 'client_id', ['l']])
    }
    expect(del).toContainEqual(['delete'])
    expect(del).toContainEqual(['in', 'id', ['l']])
    // No user_id filter anywhere: RLS scopes the company, and a teammate's
    // client must merge like the caller's own.
    for (const b of builders) expect(b.calls.some((c) => c[1] === 'user_id')).toBe(false)
    expect(result).toEqual({ reassigned: 2, deletedCount: 1, patch: { notes: 'Gate code 4411\n\nDog in yard' } })
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
