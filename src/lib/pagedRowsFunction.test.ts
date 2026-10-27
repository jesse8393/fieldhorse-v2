import { describe, expect, it, vi } from 'vitest'
import { readAllRows } from '../../netlify/functions/lib/pagedRows.js'

describe('complete service roster reads', () => {
  it('includes the last page beyond the response limit', async () => {
    const rows = Array.from({ length: 1003 }, (_, id) => ({ id }))
    const build = vi.fn(async (from, to) => ({ data: rows.slice(from, to + 1), error: null }))
    expect((await readAllRows(build)).data).toHaveLength(1003)
    expect(build).toHaveBeenCalledTimes(3)
  })
  it('refuses to label a partial result complete after a later page fails', async () => {
    const error = { message: 'unavailable' }
    const result = await readAllRows(async (from: number) => from === 0 ? { data: [1, 2], error: null } : { data: null, error }, 2)
    expect(result).toEqual({ data: null, error })
  })
})
