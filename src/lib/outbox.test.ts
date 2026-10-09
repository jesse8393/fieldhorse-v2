import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutboxEntry, OutboxStore } from './outbox.ts'

// Supabase fake: inserts fail like a dead zone (so writes get queued),
// upserts and updates answer from `serverAnswers` keyed by row id.
const serverAnswers = new Map<string, { message: string } | null>()
const drained: string[] = []
let sessionUser: string | null = 'user-a'

function answer(id: string) {
  drained.push(id)
  return { error: serverAnswers.has(id) ? serverAnswers.get(id) : null }
}

vi.mock('./supabase.ts', () => ({
  supabase: {
    from: () => ({
      insert: async () => ({ error: { message: 'TypeError: Failed to fetch' } }),
      upsert: async (row: { id: string }) => answer(row.id),
      update: () => ({ match: async (match: { id: string }) => answer(match.id) }),
    }),
    storage: {
      from: () => ({ upload: async (path: string) => ({ error: serverAnswers.get(path) ?? null }) }),
    },
    auth: {
      getSession: async () => ({ data: { session: sessionUser ? { user: { id: sessionUser } } : null } }),
    },
  },
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('./toast.ts', () => ({
  toastSuccess: (...args: unknown[]) => toastSuccess(...args),
  toastError: (...args: unknown[]) => toastError(...args),
}))
vi.mock('./stages.ts', () => ({ recalcCost: async () => {} }))

const outbox = await import('./outbox.ts')

function memoryStore() {
  const rows = new Map<string, OutboxEntry>()
  const store: OutboxStore & { rows: Map<string, OutboxEntry>; allCalls: number } = {
    rows,
    allCalls: 0,
    async all() { store.allCalls += 1; return Array.from(rows.values()) },
    async put(e) { rows.set(e.key, e) },
    async remove(key) { rows.delete(key) },
    async count() { return rows.size },
    async clear() { rows.clear() },
  }
  return store
}

let seq = 0
function entry(partial: Partial<OutboxEntry> & { id: string }): OutboxEntry {
  seq += 1
  const { id, ...rest } = partial
  return {
    key: `key-${id}`,
    kind: 'insert',
    table: 'fh_notes',
    row: { id, text: `note ${id}` },
    created_at: new Date(Date.UTC(2026, 9, 1, 0, 0, seq)).toISOString(),
    attempts: 0,
    ...rest,
  }
}

let store: ReturnType<typeof memoryStore>

beforeEach(() => {
  store = memoryStore()
  outbox.setOutboxStoreForTests(store)
  serverAnswers.clear()
  drained.length = 0
  sessionUser = 'user-a'
  toastSuccess.mockClear()
  toastError.mockClear()
})

afterEach(() => {
  outbox.setOutboxStoreForTests(null)
  vi.unstubAllGlobals()
})

describe('queueing offline writes', () => {
  beforeEach(() => vi.stubGlobal('navigator', { onLine: false }))

  it('tags each entry with the user who queued it', async () => {
    await outbox.resilientInsert('fh_notes', { user_id: 'user-a', text: 'pour footing' })
    await outbox.resilientInsert('fh_notes', { text: 'explicit owner' }, { userId: 'user-b' })
    await outbox.resilientUpdate('fh_job_todos', { id: 'todo-1', user_id: 'user-a' }, { done: true })
    await outbox.queuePhoto({ bucket: 'job-photos', path: 'p.jpg', blob: new Blob(['x']), contentType: 'image/jpeg', row: { id: 'photo-1', user_id: 'user-a' } })
    sessionUser = 'user-c'
    await outbox.resilientInsert('fh_notes', { text: 'no owner on the row' })

    const owners = Array.from(store.rows.values()).map((e) => e.userId).sort()
    expect(owners).toEqual(['user-a', 'user-a', 'user-a', 'user-b', 'user-c'])
  })

  it('checks the cap with a count instead of loading every queued blob', async () => {
    const result = await outbox.resilientInsert('fh_notes', { user_id: 'user-a', text: 'x' })
    expect(result.queued).toBe(true)
    expect(store.allCalls).toBe(0)

    store.count = async () => 500
    const full = await outbox.resilientInsert('fh_notes', { user_id: 'user-a', text: 'y' })
    expect(full.queued).toBe(false)
    expect(full.error?.message).toMatch(/full/)
  })
})

describe('flushOutbox', () => {
  beforeEach(() => vi.stubGlobal('navigator', { onLine: true }))

  it("drains only the signed in user's entries and leaves the rest queued", async () => {
    const mine = entry({ id: 'a1', userId: 'user-a' })
    const theirs = entry({ id: 'b1', userId: 'user-b' })
    // Queued before tagging: the row's user_id still says whose it is.
    const legacyTheirs = entry({ id: 'b2', row: { id: 'b2', user_id: 'user-b', text: 'b' } })
    // Queued before tagging with no owner hint at all: drains as before.
    const legacyUnknown = entry({ id: 'x1', kind: 'update', table: 'fh_job_todos', row: undefined, match: { id: 'x1' }, patch: { done: true } })
    for (const e of [mine, theirs, legacyTheirs, legacyUnknown]) store.rows.set(e.key, e)

    expect(await outbox.flushOutbox()).toBe(2)
    expect(drained).toEqual(['a1', 'x1'])
    expect(Array.from(store.rows.keys()).sort()).toEqual(['key-b1', 'key-b2'])
    expect(toastSuccess).toHaveBeenCalledWith('Back online', '2 offline items synced')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('reports rows the server rejects instead of counting them as synced', async () => {
    const ok = entry({ id: 'a1', userId: 'user-a' })
    const rejected = entry({ id: 'a2', userId: 'user-a', row: { id: 'a2', text: 'Pour the footing Tuesday morning' } })
    store.rows.set(ok.key, ok)
    store.rows.set(rejected.key, rejected)
    serverAnswers.set('a2', { message: 'new row violates check constraint' })

    expect(await outbox.flushOutbox()).toBe(1)
    // A permanent rejection leaves the queue so it cannot jam it.
    expect(store.rows.size).toBe(0)
    expect(toastSuccess).toHaveBeenCalledWith('Back online', '1 offline item synced')
    expect(toastError).toHaveBeenCalledTimes(1)
    const [title, description] = toastError.mock.calls[0]
    expect(title).toBe("1 offline item didn't sync")
    expect(description).toContain('1 note')
    expect(description).toContain('Pour the footing Tuesday morning')
  })

  it('counts a photo whose upload is refused as dropped, not synced', async () => {
    const photo = entry({ id: 'p1', userId: 'user-a', kind: 'photo', table: undefined, bucket: 'job-photos', path: 'too-big.jpg', blob: new Blob(['x']), row: { id: 'p1' } })
    store.rows.set(photo.key, photo)
    serverAnswers.set('too-big.jpg', { message: 'Payload too large' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await outbox.flushOutbox()).toBe(0)
    expect(store.rows.size).toBe(0)
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastError.mock.calls[0][1]).toContain('1 photo')
    warn.mockRestore()
  })

  it('stops at a network failure and keeps the rest for the next trigger', async () => {
    const first = entry({ id: 'a1', userId: 'user-a' })
    const second = entry({ id: 'a2', userId: 'user-a' })
    store.rows.set(first.key, first)
    store.rows.set(second.key, second)
    serverAnswers.set('a1', { message: 'TypeError: Failed to fetch' })

    expect(await outbox.flushOutbox()).toBe(0)
    expect(drained).toEqual(['a1'])
    expect(store.rows.size).toBe(2)
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('drains nothing without a session', async () => {
    sessionUser = null
    const e = entry({ id: 'a1', userId: 'user-a' })
    store.rows.set(e.key, e)
    expect(await outbox.flushOutbox()).toBe(0)
    expect(store.rows.size).toBe(1)
  })
})

describe('clearOutbox', () => {
  it('empties the queue for every user', async () => {
    for (const e of [entry({ id: 'a1', userId: 'user-a' }), entry({ id: 'b1', userId: 'user-b' })]) store.rows.set(e.key, e)
    await outbox.clearOutbox()
    expect(store.rows.size).toBe(0)
    expect(await outbox.outboxSize()).toBe(0)
  })
})

describe('drainQueue', () => {
  it('stops when the queue is cleared mid drain', async () => {
    const entries = [entry({ id: 'a1', userId: 'user-a' }), entry({ id: 'a2', userId: 'user-a' })]
    let cleared = false
    const removed: string[] = []
    const result = await outbox.drainQueue(entries, 'user-a', {
      drain: async () => { cleared = true; return 'ok' },
      remove: async (key) => { removed.push(key) },
      cancelled: () => cleared,
    })
    expect(result.synced.map((e) => e.key)).toEqual(['key-a1'])
    expect(removed).toEqual(['key-a1'])
  })

  it('treats a thrown non network error as dropped', async () => {
    const result = await outbox.drainQueue([entry({ id: 'a1', userId: 'user-a' })], 'user-a', {
      drain: async () => { throw new Error('malformed row') },
      remove: async () => {},
    })
    expect(result.dropped).toHaveLength(1)
    expect(result.synced).toHaveLength(0)
  })
})

describe('describeDropped', () => {
  it('summarises mixed rejections in plain words', () => {
    const { title, description } = outbox.describeDropped([
      entry({ id: 'a1' }),
      entry({ id: 'a2' }),
      entry({ id: 'p1', kind: 'photo', table: undefined }),
    ])
    expect(title).toBe("3 offline items didn't sync")
    expect(description).toBe('The server rejected 2 notes and 1 photo. Please enter them again.')
    expect(`${title} ${description}`).not.toMatch(/[\u2013\u2014]| - /)
  })
})
