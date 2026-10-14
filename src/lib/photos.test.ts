import { beforeEach, describe, expect, it, vi } from 'vitest'

type Call = [string, ...unknown[]]
const calls: Call[] = []
let rows: unknown[] = []
const signed: string[][] = []

function builder(): unknown {
  const proxy: unknown = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve)
      }
      return (...args: unknown[]) => {
        calls.push([String(prop), ...args])
        return proxy
      }
    },
  })
  return proxy
}

vi.mock('./supabase.ts', () => ({
  supabase: {
    from: (table: string) => {
      calls.push(['from', table])
      return builder()
    },
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => {
          signed.push(paths)
          return { data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}`, error: null })), error: null }
        },
      }),
    },
  },
}))

const { fetchCoverPhotos, fetchCoverPhotosByJob, freshCoverUrls } = await import('./photos.ts')

beforeEach(() => {
  calls.length = 0
  signed.length = 0
  rows = []
})

describe('fetchCoverPhotosByJob', () => {
  it('asks for nothing when no job is on screen', async () => {
    expect(await fetchCoverPhotosByJob([])).toEqual({})
    expect(calls).toEqual([])
  })

  it('reads one newest photo per requested job and signs them in one call', async () => {
    rows = [
      { id: 'job-1', fh_job_files: [{ storage_path: 'u/job-1/new.jpg', uploaded_at: '2026-10-01T00:00:00Z' }] },
      { id: 'job-2', fh_job_files: [] },
      // Defensive: if more than one row ever comes back, the newest wins.
      { id: 'job-3', fh_job_files: [
        { storage_path: 'u/job-3/old.jpg', uploaded_at: '2026-01-01T00:00:00Z' },
        { storage_path: 'u/job-3/new.jpg', uploaded_at: '2026-09-01T00:00:00Z' },
      ] },
    ]
    const covers = await fetchCoverPhotosByJob(['job-1', 'job-2', 'job-3', 'job-1'])
    expect(covers).toEqual({
      'job-1': 'https://signed/u/job-1/new.jpg',
      'job-3': 'https://signed/u/job-3/new.jpg',
    })
    expect(calls).toContainEqual(['in', 'id', ['job-1', 'job-2', 'job-3']])
    expect(calls).toContainEqual(['eq', 'fh_job_files.kind', 'photo'])
    expect(calls).toContainEqual(['limit', 1, { referencedTable: 'fh_job_files' }])
    expect(signed).toEqual([['u/job-1/new.jpg', 'u/job-3/new.jpg']])
  })
})

// Phase 8, Task 15: Today's cover photos are saved in the offline cache
// with the rest of the dashboard, so a cold open hours later used to hand
// the card an expired link. The covers now carry when they were signed,
// and only fresh ones reach the screen.
describe('fetchCoverPhotos', () => {
  it('records when the cover URLs were signed', async () => {
    rows = [{ id: 'job-1', fh_job_files: [{ storage_path: 'u/job-1/new.jpg', uploaded_at: '2026-10-01T00:00:00Z' }] }]
    expect(await fetchCoverPhotos(['job-1'], 5_000)).toEqual({ urls: { 'job-1': 'https://signed/u/job-1/new.jpg' }, signedAt: 5_000 })
    expect(await fetchCoverPhotos([], 5_000)).toEqual({ urls: {}, signedAt: 5_000 })
  })
})

describe('freshCoverUrls', () => {
  it('hands out the covers only while their links are fresh', () => {
    const covers = { urls: { 'job-1': 'https://signed/a.jpg' }, signedAt: 1_000 }
    expect(freshCoverUrls(covers, 1_000 + 49 * 60_000)).toEqual({ 'job-1': 'https://signed/a.jpg' })
    expect(freshCoverUrls(covers, 1_000 + 50 * 60_000)).toBeNull()
    expect(freshCoverUrls(undefined, 1_000)).toBeNull()
    // A copy saved before the signing time was kept: a bare map of links.
    expect(freshCoverUrls({ 'job-1': 'https://signed/a.jpg' }, 1_000)).toBeNull()
  })
})
