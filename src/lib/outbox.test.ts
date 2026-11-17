import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutboxEntry, OutboxStore } from './outbox.ts'
import { webcrypto } from 'node:crypto'

// Supabase fake: inserts fail like a dead zone (so writes get queued),
// upserts and updates answer from `serverAnswers` keyed by row id. An
// answer's status is the HTTP status PostgREST would send with it; a
// storage answer keeps it on the error, as storage-js does.
type ServerAnswer = { message: string; status?: number; code?: string; statusCode?: string }
const serverAnswers = new Map<string, ServerAnswer | null>()
const drained: string[] = []
const invisibleRows = new Set<string>()
let sessionUser: string | null = 'user-a'
let activeOrg: string | null = 'org-a'
const applied: { id: string; patch: Record<string, unknown> }[] = []

function answer(id: string) {
  drained.push(id)
  const failure = serverAnswers.get(id) ?? null
  const { status, ...error } = failure ?? { status: 201 }
  return { data: invisibleRows.has(id) ? [] : [{ id }], error: failure ? error : null, status }
}

vi.mock('./supabase.ts', () => ({
  getActiveOrgId: () => activeOrg,
  supabase: {
    from: () => ({
      insert: async () => ({ error: { message: 'TypeError: Failed to fetch' } }),
      upsert: async (row: { id: string }) => answer(row.id),
      update: (patch: Record<string, unknown>) => ({ match: (match: { id: string }) => {
        applied.push({ id: match.id, patch })
        const result = Promise.resolve(answer(match.id))
        return Object.assign(result, { select: () => result })
      } }),
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
  invisibleRows.clear()
  drained.length = 0
  sessionUser = 'user-a'
  activeOrg = 'org-a'
  applied.length = 0
  toastSuccess.mockClear()
  toastError.mockClear()
})

afterEach(() => {
  outbox.setOutboxStoreForTests(null)
  vi.unstubAllGlobals()
})

describe('queueing offline writes', () => {
  beforeEach(() => vi.stubGlobal('navigator', { onLine: false }))

  it('keeps PostgreSQL UUID row identities without native randomUUID', async () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array<ArrayBuffer>) => webcrypto.getRandomValues(bytes) })
    const result = await outbox.resilientInsert('fh_job_todos', { user_id: 'user-a', text: 'Confirm visit' })
    expect(result.error).toBeNull()
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(Array.from(store.rows.values())[0].row?.id).toBe(result.id)
  })

  it('keeps queued rows in their original workspace after switching companies', async () => {
    await outbox.resilientInsert('fh_notes', { user_id: 'user-a', text: 'Company A note' })
    await outbox.queuePhoto({ bucket: 'job-photos', path: 'a.jpg', blob: new Blob(['x']), contentType: 'image/jpeg', row: { id: 'photo-a', user_id: 'user-a' } })
    activeOrg = 'org-b'
    expect(Array.from(store.rows.values()).map(e => e.row?.org_id)).toEqual(['org-a', 'org-a'])
  })

  it('never lets online Undo overtake an older offline completion', async () => {
    await outbox.resilientUpdate('fh_job_todos', { id: 'todo-order' }, { done: true }, { userId: 'user-a' })
    vi.stubGlobal('navigator', { onLine: true })
    await outbox.resilientUpdate('fh_job_todos', { id: 'todo-order' }, { done: false }, { userId: 'user-a' })
    await outbox.flushOutbox()
    await vi.waitFor(() => expect(store.rows.size).toBe(0))
    expect(applied.map(write => write.patch.done)).toEqual([true, false])
  })

  it('reports a transaction abort even after the IndexedDB put request succeeds', async () => {
    outbox.setOutboxStoreForTests(null)
    vi.stubGlobal('indexedDB', {
      open: () => {
        const open: any = {}
        open.result = {
          close: vi.fn(),
          transaction: () => {
            const transaction: any = {}
            const request = (abort: boolean) => {
              const req: any = { result: 0 }
              queueMicrotask(() => {
                req.onsuccess?.()
                queueMicrotask(() => {
                  if (abort) {
                    transaction.error = new Error('Storage quota exceeded')
                    transaction.onabort?.()
                  } else transaction.oncomplete?.()
                })
              })
              return req
            }
            transaction.objectStore = () => ({ count: () => request(false), put: () => request(true) })
            return transaction
          },
        }
        queueMicrotask(() => open.onsuccess?.())
        return open
      },
    })
    const result = await outbox.resilientInsert('fh_job_todos', { user_id: 'user-a', text: 'Must survive a reload' })
    expect(result.queued).toBe(false)
    expect(result.error?.message).toMatch(/didn't save/)
  })

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

  it('never counts an update hidden by RLS or removed meanwhile as synced', async () => {
    const queued = entry({ id: 'revoked-task', userId: 'user-a', kind: 'update', table: 'fh_job_todos', row: undefined, match: { id: 'revoked-task' }, patch: { done: true } })
    store.rows.set(queued.key, queued)
    invisibleRows.add('revoked-task')
    expect(await outbox.flushOutbox()).toBe(0)
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledTimes(1)
  })

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

  it.each([500, 502, 503, 504, 429, 408])('keeps queued work for a later retry when the server answers %i', async (status) => {
    const note = entry({ id: 'a1', userId: 'user-a', row: { id: 'a1', text: 'Pour the footing Tuesday' } })
    const later = entry({ id: 'a2', userId: 'user-a' })
    store.rows.set(note.key, note)
    store.rows.set(later.key, later)
    serverAnswers.set('a1', { message: 'Service Unavailable', status })

    expect(await outbox.flushOutbox()).toBe(0)
    // Nothing is thrown away and nothing later jumps the queue.
    expect(drained).toEqual(['a1'])
    expect(Array.from(store.rows.keys()).sort()).toEqual(['key-a1', 'key-a2'])
    expect(toastError).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
    const kept = store.rows.get('key-a1')!
    expect(kept.row?.text).toBe('Pour the footing Tuesday')
    expect(kept.attempts).toBe(1)
    expect(kept.retryAfter).toBeGreaterThan(Date.now())
  })

  it('keeps queued work through a 401 until the person signs in again', async () => {
    const note = entry({ id: 'a1', userId: 'user-a' })
    store.rows.set(note.key, note)
    serverAnswers.set('a1', { message: 'JWT expired', status: 401, code: 'PGRST303' })

    expect(await outbox.flushOutbox()).toBe(0)
    expect(store.rows.size).toBe(1)
    expect(toastError).not.toHaveBeenCalled()

    // Signed in again: the same entry lands.
    serverAnswers.delete('a1')
    expect(await outbox.flushOutbox()).toBe(1)
    expect(store.rows.size).toBe(0)
  })

  it('keeps a queued photo and its image when the upload meets a busy server or an expired token', async () => {
    const blob = new Blob(['jpeg bytes'])
    const photo = entry({ id: 'p1', userId: 'user-a', kind: 'photo', table: undefined, bucket: 'job-photos', path: 'site.jpg', blob, row: { id: 'p1' } })
    store.rows.set(photo.key, photo)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    serverAnswers.set('site.jpg', { message: 'Service Unavailable', status: 503, statusCode: '503' })
    expect(await outbox.flushOutbox({ ignoreBackoff: true })).toBe(0)
    expect(store.rows.get('key-p1')?.blob).toBe(blob)

    // Storage answers an expired token with a 400 that says so.
    serverAnswers.set('site.jpg', { message: 'jwt expired', status: 400, statusCode: '403' })
    expect(await outbox.flushOutbox({ ignoreBackoff: true })).toBe(0)
    expect(store.rows.get('key-p1')?.blob).toBe(blob)
    expect(toastError).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('drops a refusal a retry can never fix, and says what was not saved', async () => {
    const refused = entry({ id: 'a1', userId: 'user-a', row: { id: 'a1', text: 'Gate code 4471' } })
    const revoked = entry({ id: 'a2', userId: 'user-a', kind: 'insert', table: 'fh_job_todos', row: { id: 'a2', text: 'Order rebar' } })
    store.rows.set(refused.key, refused)
    store.rows.set(revoked.key, revoked)
    serverAnswers.set('a1', { message: 'new row violates check constraint', status: 400, code: '23514' })
    serverAnswers.set('a2', { message: 'new row violates row-level security policy', status: 403, code: '42501' })

    expect(await outbox.flushOutbox()).toBe(0)
    expect(store.rows.size).toBe(0)
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError.mock.calls[0][1]).toBe('The server rejected 1 note and 1 task. Please enter them again.')
  })

  it('waits out its backoff before resending, then retries on its own', async () => {
    vi.useFakeTimers()
    try {
      const note = entry({ id: 'a1', userId: 'user-a' })
      store.rows.set(note.key, note)
      serverAnswers.set('a1', { message: 'Too Many Requests', status: 429 })
      expect(await outbox.flushOutbox()).toBe(0)
      const wait = store.rows.get('key-a1')!.retryAfter! - Date.now()
      expect(wait).toBeGreaterThan(0)

      // A tab focus during the wait does not resend.
      expect(await outbox.flushOutbox()).toBe(0)
      expect(drained).toEqual(['a1'])

      serverAnswers.delete('a1')
      await vi.advanceTimersByTimeAsync(wait + 1)
      await vi.waitFor(() => expect(store.rows.size).toBe(0))
      expect(drained).toEqual(['a1', 'a1'])
      expect(toastSuccess).toHaveBeenCalledWith('Back online', '1 offline item synced')
    } finally {
      vi.useRealTimers()
    }
  })

  it('resends at once when the connection comes back, whatever the backoff', async () => {
    const note = entry({ id: 'a1', userId: 'user-a', attempts: 4, retryAfter: Date.now() + 60_000 })
    store.rows.set(note.key, note)
    expect(await outbox.flushOutbox()).toBe(0)
    expect(drained).toEqual([])
    expect(await outbox.flushOutbox({ ignoreBackoff: true })).toBe(1)
    expect(store.rows.size).toBe(0)
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

describe('retryDelayMs', () => {
  it('waits longer after each failed attempt, up to five minutes', () => {
    const delays = [1, 2, 3, 4, 5, 6, 7, 8, 20].map((n) => outbox.retryDelayMs(n, () => 0.5))
    for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1])
    expect(delays[0]).toBeGreaterThanOrEqual(1000)
    expect(delays[1]).toBeGreaterThan(delays[0])
    expect(Math.max(...delays)).toBeLessThanOrEqual(5 * 60 * 1000)
    expect(outbox.retryDelayMs(20, () => 1)).toBeLessThanOrEqual(5 * 60 * 1000)
  })
})

describe('drainOutcome', () => {
  it('keeps what a retry can fix and drops only real refusals', () => {
    expect(outbox.drainOutcome(null)).toBe('ok')
    expect(outbox.drainOutcome({ message: 'TypeError: Failed to fetch' }, 0)).toBe('retry')
    expect(outbox.drainOutcome({ message: 'AbortError: signal is aborted' }, 0)).toBe('retry')
    for (const status of [408, 425, 429, 500, 502, 503, 504]) expect(outbox.drainOutcome({ message: 'x' }, status)).toBe('retry')
    expect(outbox.drainOutcome({ message: 'Service Unavailable', status: 503 })).toBe('retry')
    expect(outbox.drainOutcome({ message: 'JWT expired', code: 'PGRST303' }, 401)).toBe('signin')
    expect(outbox.drainOutcome({ message: 'jwt expired', status: 400, statusCode: '403' })).toBe('signin')
    expect(outbox.drainOutcome({ message: 'new row violates check constraint', code: '23514' }, 400)).toBe('dropped')
    expect(outbox.drainOutcome({ message: 'new row violates row-level security policy', code: '42501' }, 403)).toBe('dropped')
    expect(outbox.drainOutcome({ message: 'Payload too large', status: 413 })).toBe('dropped')
    expect(outbox.drainOutcome(new Error('malformed row'))).toBe('dropped')
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
