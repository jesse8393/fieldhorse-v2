import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  row: { id: 'quote-1', status: 'draft', sent_at: null as string | null, job_id: null as string | null },
  error: null as { message: string } | null,
  writes: 0,
  wrongConfirmation: false,
}))
vi.mock('../../lib/supabase.ts', () => ({
  authHeaders: vi.fn(),
  supabase: {
    from: () => {
      let payload: Record<string, unknown> = {}
      const matches: Array<() => boolean> = []
      const query = {
        update: (patch: Record<string, unknown>) => { payload = patch; return query },
        eq: (key: keyof typeof db.row, value: unknown) => { matches.push(() => db.row[key] === value); return query },
        is: (key: keyof typeof db.row, value: unknown) => { matches.push(() => db.row[key] === value); return query },
        select: () => query,
        maybeSingle: async () => {
          if (db.error) return { data: null, error: db.error }
          if (!matches.every((match) => match())) return { data: null, error: null }
          const previous = { ...db.row }
          Object.assign(db.row, payload)
          db.writes++
          return { data: db.wrongConfirmation ? previous : { ...db.row, sent_at: db.row.sent_at?.replace('Z', '+00:00') }, error: null }
        },
      }
      return query
    },
  },
}))
import { canMarkSent, markQuoteSent } from './quoteDocument.ts'

beforeEach(() => {
  db.row = { id: 'quote-1', status: 'draft', sent_at: null, job_id: null }
  db.error = null
  db.writes = 0
  db.wrongConfirmation = false
})

describe('manual quote delivery acknowledgement', () => {
  it.each(['draft', 'changes_requested'])('permits and confirms an unchanged %s', async (status) => {
    db.row.status = status
    expect(canMarkSent(status)).toBe(true)
    const saved = await markQuoteSent('quote-1', status)
    expect(saved).toMatchObject({ id: 'quote-1', status: 'sent', sent_at: expect.any(String) })
    expect(db.writes).toBe(1)
  })

  it.each([undefined, null, '', 'sent', 'viewed', 'approved', 'rejected', 'expired', 'lost'])('refuses an ineligible expected status %s', async (status) => {
    expect(canMarkSent(status)).toBe(false)
    await expect(markQuoteSent('quote-1', status)).rejects.toThrow('cannot be marked as sent')
    expect(db.writes).toBe(0)
  })

  it.each(['approved', 'rejected', 'expired', 'lost', 'sent', 'viewed', 'changes_requested'])('preserves a concurrent transition from draft to %s', async (currentStatus) => {
    db.row.status = currentStatus
    await expect(markQuoteSent('quote-1', 'draft')).rejects.toThrow('quote has changed')
    expect(db.row.status).toBe(currentStatus)
    expect(db.row.sent_at).toBeNull()
    expect(db.writes).toBe(0)
  })

  it('does not change another quote or a quote converted to a job', async () => {
    await expect(markQuoteSent('different-quote', 'draft')).rejects.toThrow('quote has changed')
    db.row.job_id = 'job-1'
    await expect(markQuoteSent('quote-1', 'draft')).rejects.toThrow('quote has changed')
    expect(db.writes).toBe(0)
  })

  it('propagates a database write error without confirming delivery', async () => {
    db.error = { message: 'Update rejected' }
    await expect(markQuoteSent('quote-1', 'draft')).rejects.toThrow('Update rejected')
    expect(db.row.status).toBe('draft')
    expect(db.writes).toBe(0)
  })

  it('rejects a response that does not confirm the written status', async () => {
    db.wrongConfirmation = true
    await expect(markQuoteSent('quote-1', 'draft')).rejects.toThrow('quote has changed')
  })
})
