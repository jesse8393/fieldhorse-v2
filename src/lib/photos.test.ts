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

const { fetchCoverPhotosByJob } = await import('./photos.ts')

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
