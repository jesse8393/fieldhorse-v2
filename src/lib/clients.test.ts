import { beforeEach, describe, expect, it, vi } from 'vitest'

// Chainable PostgREST fake: every call on a builder is recorded and the
// builder resolves to the next queued response.
type Call = [string, ...unknown[]]
const responses: { data: unknown; error: unknown }[] = []
const builders: Call[][] = []

function builder(): unknown {
  const calls: Call[] = []
  builders.push(calls)
  const response = responses.shift() ?? { data: [], error: null }
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
    },
  })
  return proxy
}

vi.mock('./supabase.ts', () => ({ supabase: { from: () => builder() } }))

const { findOrCreateClient, escapeLike, phoneLikePattern } = await import('./clients.ts')

function callsOf(index: number, method: string) {
  return builders[index].filter((c) => c[0] === method)
}

beforeEach(() => {
  responses.length = 0
  builders.length = 0
})

describe('helpers', () => {
  it('escapes LIKE wildcards so typed values match literally', () => {
    expect(escapeLike('j_smith@x.com')).toBe('j\\_smith@x.com')
    expect(escapeLike('100%')).toBe('100\\%')
    expect(escapeLike('a\\b')).toBe('a\\\\b')
  })

  it('builds a phone pattern that tolerates formatting between digits', () => {
    expect(phoneLikePattern('6155550101')).toBe('%6%1%5%5%5%5%0%1%0%1%')
  })
})

describe('findOrCreateClient', () => {
  it('links to an existing client even when duplicates share the phone', async () => {
    responses.push({
      data: [
        { id: 'other', name: 'Someone', phone: '(615) 555-0199', email: null },
        { id: 'newest-dupe', name: 'Jane', phone: '615.555.0101', email: null },
        { id: 'older-dupe', name: 'Jane', phone: '6155550101', email: null },
      ],
      error: null,
    })
    expect(await findOrCreateClient('user-1', { name: 'Jane Doe', phone: '(615) 555-0101' })).toBe('newest-dupe')
    expect(builders).toHaveLength(1) // no email/name lookups, no insert
    expect(callsOf(0, 'ilike')).toEqual([['ilike', 'phone', '%6%1%5%5%5%5%0%1%0%1%']])
    expect(callsOf(0, 'eq')).toEqual([['eq', 'user_id', 'user-1']])
  })

  it('does not treat an underscore in an email as a wildcard', async () => {
    responses.push({ data: [{ id: 'wrong', name: 'J', phone: null, email: 'jasmith@x.com' }], error: null }) // email lookup
    responses.push({ data: [], error: null }) // name lookup
    responses.push({ data: { id: 'created' }, error: null }) // insert
    expect(await findOrCreateClient('user-1', { name: 'J Smith', email: 'J_Smith@x.com' })).toBe('created')
    expect(callsOf(0, 'ilike')).toEqual([['ilike', 'email', 'j\\_smith@x.com']])
  })

  it('aborts instead of creating a duplicate when a lookup fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    responses.push({ data: null, error: { message: 'timeout' } })
    expect(await findOrCreateClient('user-1', { name: 'Jane', phone: '6155550101' })).toBeNull()
    expect(builders).toHaveLength(1)
    expect(builders[0].some((c) => c[0] === 'insert')).toBe(false)
    warn.mockRestore()
  })

  it('matches across the org and stamps new clients with it when given an org', async () => {
    responses.push({ data: [], error: null }) // name lookup
    responses.push({ data: { id: 'created' }, error: null }) // insert
    expect(await findOrCreateClient('user-1', { name: 'New Client' }, 'org-1')).toBe('created')
    expect(callsOf(0, 'eq')).toEqual([['eq', 'org_id', 'org-1']])
    expect(callsOf(1, 'insert')[0][1]).toMatchObject({ user_id: 'user-1', org_id: 'org-1', name: 'New Client' })
  })
})
