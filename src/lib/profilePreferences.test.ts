import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ from: vi.fn(), reads: [] as unknown[], writes: [] as unknown[], snapshots: [] as unknown[] }))
vi.mock('./supabase.ts', () => ({ supabase: { from: mock.from } }))
import { updateProfilePreferences } from './profilePreferences.ts'

beforeEach(() => {
  mock.reads = []; mock.writes = []; mock.snapshots = []; mock.from.mockReset()
  mock.from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ single: async () => mock.reads.shift() }) }),
    update: (patch: unknown) => {
      mock.snapshots.push(patch)
      const query = { eq: vi.fn(() => query), is: vi.fn(() => query), select: () => ({ maybeSingle: async () => mock.writes.shift() }) }
      return query
    }
  }))
})

describe('profile preference concurrency', () => {
  it('reapplies changes to a fresh snapshot after a concurrent update', async () => {
    mock.reads.push({ data: { preferences: { notification: true } } }, { data: { preferences: { notification: false, new_setting: 7 } } })
    mock.writes.push({ data: null }, { data: { user_id: 'me' } })
    await updateProfilePreferences('me', current => ({ ...current, favorite: true }))
    expect(mock.snapshots).toEqual([{ preferences: { notification: true, favorite: true } }, { preferences: { notification: false, new_setting: 7, favorite: true } }])
  })
  it('never reports a rejected write as a saved favorite', async () => {
    mock.reads.push({ data: { preferences: {} } })
    mock.writes.push({ data: null, error: { message: 'Permission denied' } })
    await expect(updateProfilePreferences('me', current => current)).rejects.toThrow('Permission denied')
  })
  it('bounds repeated conflicts and preserves the caller draft', async () => {
    for (let i = 0; i < 3; i++) { mock.reads.push({ data: { preferences: {} } }); mock.writes.push({ data: null }) }
    await expect(updateProfilePreferences('me', current => ({ ...current, favorite: true }))).rejects.toThrow('changed elsewhere')
    expect(mock.snapshots).toHaveLength(3)
  })
})
