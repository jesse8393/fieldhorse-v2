import { beforeEach, describe, expect, it, vi } from 'vitest'

// Crew home has to tell a failed clock read from "not clocked in"
// (Phase 8 follow up A, bullet 3), while every other caller keeps the old
// answer on a failed read: null for the active punch, an empty list for
// the recent ones. A stub client answers each read with `next`.

type Answer = { data: unknown; error: { message: string } | null }
let next: Answer = { data: null, error: null }

// Every call made on the stub, in order, so a test can read the query.
let calls: Array<[string, unknown[]]> = []

function builder() {
  const query: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'is', 'order', 'limit', 'update']) {
    query[method] = (...args: unknown[]) => { calls.push([method, args]); return query }
  }
  query.maybeSingle = () => { calls.push(['maybeSingle', []]); return Promise.resolve(next) }
  query.single = () => { calls.push(['single', []]); return Promise.resolve(next) }
  query.then = (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(next).then(resolve, reject)
  return query
}

vi.mock('./supabase.ts', () => ({ supabase: { from: () => builder() } }))

const { getActivePunch, listMyRecentPunches, punchOut, ALREADY_CLOCKED_OUT } = await import('./timePunches.ts')

const PUNCH = { id: 'p1', user_id: 'u1', punch_in_at: '2026-10-08T13:00:00Z', punch_out_at: null }
const FAILED: Answer = { data: null, error: { message: 'Server error' } }

beforeEach(() => {
  next = { data: null, error: null }
  calls = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('getActivePunch', () => {
  it('answers null on a failed read by default, as its other callers expect', async () => {
    next = FAILED
    await expect(getActivePunch('u1')).resolves.toBeNull()
  })

  it('throws the failed read when asked to, so a screen can say it could not check', async () => {
    next = FAILED
    await expect(getActivePunch('u1', { throwOnError: true })).rejects.toMatchObject({ message: 'Server error' })
  })

  it('returns the open punch, or null when there is none, either way', async () => {
    next = { data: PUNCH, error: null }
    await expect(getActivePunch('u1')).resolves.toEqual(PUNCH)
    await expect(getActivePunch('u1', { throwOnError: true })).resolves.toEqual(PUNCH)
    next = { data: null, error: null }
    await expect(getActivePunch('u1', { throwOnError: true })).resolves.toBeNull()
  })
})

describe('listMyRecentPunches', () => {
  it('answers an empty list on a failed read by default', async () => {
    next = FAILED
    await expect(listMyRecentPunches('u1', 10)).resolves.toEqual([])
  })

  it('throws the failed read when asked to', async () => {
    next = FAILED
    await expect(listMyRecentPunches('u1', 10, { throwOnError: true })).rejects.toMatchObject({ message: 'Server error' })
  })

  it('returns the punches either way', async () => {
    next = { data: [PUNCH], error: null }
    await expect(listMyRecentPunches('u1', 10)).resolves.toEqual([PUNCH])
    await expect(listMyRecentPunches('u1', 10, { throwOnError: true })).resolves.toEqual([PUNCH])
  })
})

// Clock out ends only a shift that is still open (Phase 8 follow up A,
// lead review): a second clock out, from an older screen or a tap after the
// shift ended elsewhere, never moves an ended shift's end time.
describe('punchOut', () => {
  it('updates the punch only while it is still open', async () => {
    next = { data: { ...PUNCH, punch_out_at: '2026-10-08T21:00:00Z' }, error: null }
    await punchOut({ punchId: 'p1' })
    expect(calls).toContainEqual(['eq', ['id', 'p1']])
    expect(calls).toContainEqual(['is', ['punch_out_at', null]])
    // maybeSingle, not single: PostgREST answers an update that matched no
    // row with an empty list, which single() turns into a 406 error.
    expect(calls).toContainEqual(['maybeSingle', []])
    expect(calls.some(([method]) => method === 'single')).toBe(false)
  })

  it('says the shift was already clocked out when no open punch matched', async () => {
    next = { data: null, error: null }
    await expect(punchOut({ punchId: 'p1' })).rejects.toMatchObject({ message: ALREADY_CLOCKED_OUT })
  })

  it('still throws a failed write as it is', async () => {
    next = FAILED
    await expect(punchOut({ punchId: 'p1' })).rejects.toMatchObject({ message: 'Server error' })
  })
})
