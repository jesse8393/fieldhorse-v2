import { beforeEach, describe, expect, it, vi } from 'vitest'

// AUTO-18: marking a notification read must say when the write failed, so
// the screen can put the row back instead of disagreeing with the bell.
let failWith: { message: string } | null = null
const writes: string[][] = []

vi.mock('./supabase.ts', () => ({
  supabase: {
    from: () => ({
      update: () => {
        const filters: string[] = []
        const chain = {
          eq: (col: string, v: string) => { filters.push(`${col}=${v}`); return chain },
          is: (col: string) => { filters.push(`${col} is null`); return chain },
          in: (col: string, v: string[]) => { filters.push(`${col} in ${v.join(',')}`); return chain },
          then: (resolve: (r: unknown) => void) => {
            writes.push(filters)
            resolve({ data: null, error: failWith })
          }
        }
        return chain
      }
    })
  }
}))

const { markAllRead, markIdsRead, markRead } = await import('./notifications.ts')

beforeEach(() => { failWith = null; writes.length = 0 })

describe('markRead and markAllRead', () => {
  it('write the caller\'s rows and resolve when the write lands', async () => {
    await expect(markRead('n1', 'u1')).resolves.toBeUndefined()
    await expect(markAllRead('u1')).resolves.toBeUndefined()
    expect(writes).toEqual([['id=n1', 'user_id=u1'], ['user_id=u1', 'read_at is null']])
  })

  it('throw when the write fails', async () => {
    failWith = { message: 'Server error' }
    await expect(markRead('n1', 'u1')).rejects.toMatchObject({ message: 'Server error' })
    await expect(markAllRead('u1')).rejects.toMatchObject({ message: 'Server error' })
  })
})

// DATA-16: Mark all read on the screen marks only the rows it shows.
describe('markIdsRead', () => {
  it('writes only the given unread rows of the caller, and nothing for none', async () => {
    await expect(markIdsRead(['n1', 'n2'], 'u1')).resolves.toBeUndefined()
    await expect(markIdsRead([], 'u1')).resolves.toBeUndefined()
    expect(writes).toEqual([['user_id=u1', 'id in n1,n2', 'read_at is null']])
  })

  it('throws when the write fails', async () => {
    failWith = { message: 'Server error' }
    await expect(markIdsRead(['n1'], 'u1')).rejects.toMatchObject({ message: 'Server error' })
  })
})
