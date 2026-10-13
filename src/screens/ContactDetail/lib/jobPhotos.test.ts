import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

// The job's photos for the phone header and the Spine (lib/jobPhotos.ts).
// Phase 8, Task 15: a signed URL is fresh for as long as the URL itself is,
// counted from when it was signed, not from when the photos were read. A
// read can reuse a URL the cache signed 45 minutes earlier, and that URL
// expires 15 minutes later however recent the read was.

const rows = [
  { id: 'p1', storage_path: 'u/job-1/p1.jpg', uploaded_at: '2026-10-10T12:00:00Z', caption: 'Forms and rebar in' }
]
let token = 0

vi.mock('../../../lib/supabase.ts', () => {
  function builder(): unknown {
    const proxy: unknown = new Proxy({}, {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve)
        }
        return () => proxy
      }
    })
    return proxy
  }
  return {
    supabase: {
      from: () => builder(),
      storage: {
        from: () => ({
          createSignedUrls: async (paths: string[]) => {
            token += 1
            return { data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}?token=${token}`, error: null })), error: null }
          }
        })
      }
    }
  }
})

const { fetchJobPhotos, jobPhotosView } = await import('./jobPhotos.ts')
const { signedUrlsFor } = await import('../../../lib/signedUrls.ts')

const MIN = 60_000
const T0 = Date.UTC(2026, 9, 10, 14, 0, 0)
let queryClient: QueryClient

beforeEach(() => {
  token = 0
  queryClient = new QueryClient()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('jobPhotosView', () => {
  it('hands out a fresh URL as the cover and the thumbnail', async () => {
    const data = await fetchJobPhotos(queryClient, 'job-1')
    const view = jobPhotosView(data, T0 + 5 * MIN)
    expect(view.count).toBe(1)
    expect(view.rows[0].url).toBe('https://signed/u/job-1/p1.jpg?token=1')
    expect(view.cover).toEqual({ url: 'https://signed/u/job-1/p1.jpg?token=1', alt: 'Forms and rebar in' })
  })

  it('stops handing out a reused URL once the URL itself is old, however recent the read', async () => {
    // The cache signs the photo at T0 (the Files tab, say).
    await signedUrlsFor(queryClient, 'job-photos', ['u/job-1/p1.jpg'])
    // 45 minutes later the Spine reads the photos and reuses that URL.
    vi.setSystemTime(T0 + 45 * MIN)
    const data = await fetchJobPhotos(queryClient, 'job-1')
    expect(token).toBe(1)
    expect(jobPhotosView(data, T0 + 45 * MIN).rows[0].url).toBe('https://signed/u/job-1/p1.jpg?token=1')
    // 20 minutes after the read, the URL is 65 minutes old and has expired.
    const later = jobPhotosView(data, T0 + 65 * MIN)
    expect(later.rows[0].url).toBeNull()
    expect(later.cover).toBeNull()
    // The photo still counts.
    expect(later.count).toBe(1)
  })

  it('hands out nothing from a copy saved before the signing times were kept', () => {
    const saved = { rows, urls: { p1: 'https://signed/u/job-1/p1.jpg?token=9' }, signedAt: T0 }
    const view = jobPhotosView(saved as unknown as Parameters<typeof jobPhotosView>[0], T0 + MIN)
    expect(view.count).toBe(1)
    expect(view.rows[0].url).toBeNull()
    expect(view.cover).toBeNull()
  })
})
