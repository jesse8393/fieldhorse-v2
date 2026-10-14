import { beforeEach, describe, expect, it, vi } from 'vitest'

type NoteRow = { user_id: string; contact_id: string | null; text: string; category: string }
const inserted: NoteRow[] = []
const failTexts = new Set<string>()
// Jobs the database no longer has: a note filed on one breaks the foreign key.
const goneJobs = new Set<string>()
let sessionUser: string | null = 'user-a'

vi.mock('./supabase.ts', () => ({
  supabase: {
    from: () => ({
      insert: async (row: NoteRow) => {
        if ([...failTexts].some((t) => row.text.startsWith(t))) return { error: { message: 'rejected' } }
        if (row.contact_id && goneJobs.has(row.contact_id)) {
          return { error: { code: '23503', message: 'insert or update on table "fh_notes" violates foreign key constraint' } }
        }
        inserted.push(row)
        return { error: null }
      },
    }),
    auth: {
      getSession: async () => ({ data: { session: sessionUser ? { user: { id: sessionUser } } : null } }),
    },
  },
}))

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, String(value)) },
  removeItem: (key: string) => { storage.delete(key) },
})

const capture = await import('./captureOutbox.ts')

function queued(): { text: string; user_id?: string; job_id?: string }[] {
  return JSON.parse(storage.get('fh:capture-outbox') || '[]')
}

beforeEach(() => {
  storage.clear()
  inserted.length = 0
  failTexts.clear()
  goneJobs.clear()
  sessionUser = 'user-a'
})

describe('pushOutbox', () => {
  it('tags the capture with the user who took it', () => {
    expect(capture.pushOutbox('call the tile guy', 'user-a')).toBe(true)
    expect(queued()).toMatchObject([{ text: 'call the tile guy', user_id: 'user-a' }])
  })

  it('tags from the session when the caller passes no user', async () => {
    expect(capture.pushOutbox('measure the deck')).toBe(true)
    await vi.waitFor(() => expect(queued()[0]?.user_id).toBe('user-a'))
  })

  it('refuses a capture once 100 are queued instead of dropping the newest', () => {
    for (let i = 0; i < 100; i += 1) expect(capture.pushOutbox(`capture ${i}`, 'user-a')).toBe(true)
    expect(capture.pushOutbox('capture 100', 'user-a')).toBe(false)
    const items = queued()
    expect(items).toHaveLength(100)
    expect(items[0].text).toBe('capture 0')
    expect(items[99].text).toBe('capture 99')
  })

  it('reports a capture it could not store', () => {
    expect(capture.pushOutbox('   ', 'user-a')).toBe(false)
  })
})

describe('flushOutbox', () => {
  it("lands only the flushing user's captures and keeps the others", async () => {
    capture.pushOutbox('mine', 'user-a')
    capture.pushOutbox('theirs', 'user-b')
    // A capture queued before tagging existed goes to whoever flushes.
    storage.set('fh:capture-outbox', JSON.stringify([...queued(), { text: 'legacy', captured_at: new Date().toISOString() }]))

    expect(capture.outboxCount('user-a')).toBe(2)
    expect(capture.outboxCount()).toBe(3)
    expect(await capture.flushOutbox('user-a')).toBe(2)
    expect(inserted.map((r) => [r.user_id, r.text.split(' (')[0]])).toEqual([['user-a', 'mine'], ['user-a', 'legacy']])
    expect(queued()).toMatchObject([{ text: 'theirs', user_id: 'user-b' }])
  })

  it('counts only successful inserts and keeps failures queued', async () => {
    capture.pushOutbox('lands', 'user-a')
    capture.pushOutbox('bounces', 'user-a')
    failTexts.add('bounces')
    expect(await capture.flushOutbox('user-a')).toBe(1)
    expect(queued()).toMatchObject([{ text: 'bounces' }])
  })
})

describe('a capture taken on a job', () => {
  it('keeps the job on the queued capture and files the note on that job', async () => {
    expect(capture.pushOutbox('Rebar is four sticks short', 'user-a', 'c-job1')).toBe(true)
    expect(queued()).toMatchObject([{ text: 'Rebar is four sticks short', user_id: 'user-a', job_id: 'c-job1' }])

    expect(await capture.flushOutbox('user-a')).toBe(1)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ user_id: 'user-a', contact_id: 'c-job1', category: 'note' })
    expect(inserted[0].text.startsWith('Rebar is four sticks short (captured offline')).toBe(true)
    expect(queued()).toEqual([])
  })

  it('lands captures queued before the job was kept, with no job', async () => {
    const at = new Date().toISOString()
    storage.set('fh:capture-outbox', JSON.stringify([
      { text: 'tagged, no job', captured_at: at, user_id: 'user-a' },
      { text: 'untagged, no job', captured_at: at },
    ]))
    expect(await capture.flushOutbox('user-a')).toBe(2)
    expect(inserted.map((r) => [r.text.split(' (')[0], r.contact_id])).toEqual([
      ['tagged, no job', null],
      ['untagged, no job', null],
    ])
  })

  it('still lands the words when the job is gone, as a note on no job', async () => {
    capture.pushOutbox('Pump truck at seven', 'user-a', 'c-deleted')
    goneJobs.add('c-deleted')
    expect(await capture.flushOutbox('user-a')).toBe(1)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ contact_id: null })
    expect(inserted[0].text.startsWith('Pump truck at seven')).toBe(true)
    expect(queued()).toEqual([])
  })

  it('a capture with no job queues as before', () => {
    expect(capture.pushOutbox('measure the deck', 'user-a', null)).toBe(true)
    expect(queued()[0]).not.toHaveProperty('job_id')
  })
})

describe('clearCaptureOutbox', () => {
  it('drops every queued capture', () => {
    capture.pushOutbox('mine', 'user-a')
    capture.pushOutbox('theirs', 'user-b')
    capture.clearCaptureOutbox()
    expect(capture.outboxCount()).toBe(0)
  })
})
