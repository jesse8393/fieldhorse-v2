import { beforeEach, describe, expect, it, vi } from 'vitest'

// The in app preview ("Preview as Marco", the desktop Document view) says
// it is what the customer sees, and the Fieldhorse theme puts the newest
// photo the page has on the cover. So the preview must read the same
// photos /api/public-link sends the customer page: the twelve oldest, in
// upload order (netlify/functions/public-link.js).

// fh_job_files for a job with ten photos, uploaded September 1 to 10.
const ROWS = Array.from({ length: 10 }, (_, i) => ({
  id: `f${i + 1}`,
  storage_path: `u/job-1/photo-${i + 1}.jpg`,
  caption: null,
  section_tag: null,
  kind: 'photo',
  uploaded_at: new Date(Date.UTC(2026, 8, i + 1, 15)).toISOString()
}))

let limits: number[] = []

// A query that honors order and limit, as PostgREST does.
function query() {
  let ascending = true
  let limit = Infinity
  const q: Record<string, unknown> = {
    select: () => q,
    eq: () => q,
    order: (_column: string, opts: { ascending?: boolean } = {}) => { ascending = opts.ascending !== false; return q },
    limit: (n: number) => { limit = n; limits.push(n); return q },
    then: (resolve: (v: unknown) => unknown) => {
      const rows = ascending ? [...ROWS] : [...ROWS].reverse()
      return Promise.resolve({ data: rows.slice(0, limit), error: null }).then(resolve)
    }
  }
  return q
}

vi.mock('../../../lib/supabase.ts', () => ({
  supabase: {
    from: () => query(),
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed/${path}` }, error: null })
      })
    }
  }
}))

const { loadPreviewPhotos, loadProjectPhotosForPdf } = await import('./DocumentPreviewPane.tsx')
const { buildPortalView } = await import('../../../lib/portalView.ts')

const NOW = new Date(2026, 9, 10, 9, 0, 0)
const coverOf = (photos: Array<{ url?: string | null }>) => buildPortalView({ kind: 'proposal', photos }, NOW).coverUrl

// What the customer page receives: the twelve oldest, signed.
function customerPagePhotos() {
  return ROWS.slice(0, 12).map((r) => ({ url: `https://signed/${r.storage_path}`, section_tag: null, caption: null }))
}

beforeEach(() => { limits = [] })

describe('the preview photos', () => {
  it('are the photos the customer page gets, so the preview shows the same cover', async () => {
    // The loader drops photos that fail to sign, so none here is null.
    const preview = (await loadPreviewPhotos('job-1', 'user-1')) as Array<{ url: string }>
    expect(preview.map((p) => p.url)).toEqual(customerPagePhotos().map((p) => p.url))
    expect(coverOf(preview)).toBe(coverOf(customerPagePhotos()))
    expect(coverOf(preview)).toBe('https://signed/u/job-1/photo-10.jpg')
  })

  it('leave the PDF its eight photos', async () => {
    const pdf = await loadProjectPhotosForPdf('job-1', 'user-1')
    expect(pdf).toHaveLength(8)
    expect(limits).toEqual([8])
  })
})
