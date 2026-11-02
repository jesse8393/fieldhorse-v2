import { describe, expect, it } from 'vitest'
import { fetchAllRows } from './fetchAllRows.ts'

describe('complete aggregate reads', () => {
  it('includes records after a full server page', async () => {
    const rows = Array.from({ length: 1001 }, (_, id) => ({ id }))
    const pages: number[][] = []
    const result = await fetchAllRows<{ id: number }>(async (from, to) => {
      pages.push([from, to])
      return { data: rows.slice(from, to + 1), error: null }
    })
    expect(result).toEqual(rows)
    expect(pages).toEqual([[0, 999], [1000, 1999]])
  })

  it('rejects incomplete totals when a later page fails', async () => {
    await expect(fetchAllRows(async from => from === 0
      ? { data: Array.from({ length: 1000 }, (_, id) => ({ id })), error: null }
      : { data: null, error: new Error('Second page unavailable') }
    )).rejects.toThrow('Second page unavailable')
  })
})
