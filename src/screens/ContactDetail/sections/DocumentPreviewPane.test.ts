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

// fh_payments for two jobs, the columns /api/public-link sends and more.
const PAYMENTS = [
  { id: 'p1', contact_id: 'job-1', amount: 9229, kind: 'deposit', paid_on: '2026-10-09', method: 'check', reference: '1042' },
  { id: 'p2', contact_id: 'job-2', amount: 500, kind: 'other', paid_on: '2026-10-01', method: 'cash', reference: null },
  { id: 'p3', contact_id: 'job-1', amount: 4000, kind: 'progress', paid_on: '2026-10-12', method: 'card', reference: null }
]

type PaymentRead = { columns: string; filters: Array<[string, unknown]> }
let paymentReads: PaymentRead[] = []
let paymentsFail = false

// A payments read that records what it asked for and honors eq.
function paymentsQuery() {
  const read: PaymentRead = { columns: '', filters: [] }
  paymentReads.push(read)
  const q: Record<string, unknown> = {
    select: (columns: string) => { read.columns = columns; return q },
    eq: (column: string, value: unknown) => { read.filters.push([column, value]); return q },
    order: () => q,
    then: (resolve: (v: unknown) => unknown) => {
      if (paymentsFail) return Promise.resolve({ data: null, error: { message: 'permission denied' } }).then(resolve)
      const columns = read.columns.split(',').map((c) => c.trim())
      const rows = PAYMENTS
        .filter((p) => read.filters.every(([column, value]) => (p as Record<string, unknown>)[column] === value))
        .map((p) => Object.fromEntries(columns.map((c) => [c, (p as Record<string, unknown>)[c]])))
      return Promise.resolve({ data: rows, error: null }).then(resolve)
    }
  }
  return q
}

vi.mock('../../../lib/supabase.ts', () => ({
  supabase: {
    from: (table: string) => (table === 'fh_payments' ? paymentsQuery() : query()),
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed/${path}` }, error: null })
      })
    }
  }
}))

const { loadPreviewPayments, loadPreviewPhotos, loadProjectPhotosForPdf } = await import('./DocumentPreviewPane.tsx')
const { buildPortalView } = await import('../../../lib/portalView.ts')

const NOW = new Date(2026, 9, 10, 9, 0, 0)
const coverOf = (photos: Array<{ url?: string | null }>) => buildPortalView({ kind: 'proposal', photos }, NOW).coverUrl

// What the customer page receives: the twelve oldest, signed.
function customerPagePhotos() {
  return ROWS.slice(0, 12).map((r) => ({ url: `https://signed/${r.storage_path}`, section_tag: null, caption: null }))
}

beforeEach(() => {
  limits = []
  paymentReads = []
  paymentsFail = false
})

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

// The customer page reads the job's payments (Deposit received, what is
// still owed, the steps after approval), so the Fieldhorse preview must
// read the same ones or it shows the contractor a page the customer never
// sees (Phase 8 follow up B review).
describe('the preview payments', () => {
  it('are the payments the customer page gets for the job, in the columns it reads', async () => {
    const payments = await loadPreviewPayments('job-1')
    expect(payments).toEqual([
      { id: 'p1', amount: 9229, kind: 'deposit', paid_on: '2026-10-09' },
      { id: 'p3', amount: 4000, kind: 'progress', paid_on: '2026-10-12' }
    ])
    expect(paymentReads).toEqual([{ columns: 'id, amount, kind, paid_on', filters: [['contact_id', 'job-1']] }])
  })

  it('are none without a job, read from nowhere', async () => {
    expect(await loadPreviewPayments(null)).toEqual([])
    expect(paymentReads).toEqual([])
  })

  // Read as none, a failed read drew the page as if nothing were paid: a
  // deposit to pay, "You pay the deposit." and no Deposit received chip
  // (Phase 8 follow up B, second review). It fails instead, so the pane
  // can say it could not read them and offer Try again.
  it('fail when the read fails, never read as none', async () => {
    paymentsFail = true
    await expect(loadPreviewPayments('job-1')).rejects.toThrow('permission denied')
  })
})
