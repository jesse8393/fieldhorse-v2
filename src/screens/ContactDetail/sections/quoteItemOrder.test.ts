import { describe, it, expect } from 'vitest'
import { planReorder } from './quoteItemOrder.ts'

const ids = (rows: { id: string }[]) => rows.map((r) => r.id)

describe('planReorder', () => {
  it('swaps neighbours when every sort_order is distinct', () => {
    const rows = [
      { id: 'a', sort_order: 0 },
      { id: 'b', sort_order: 1 },
      { id: 'c', sort_order: 5 }
    ]
    const plan = planReorder(rows, 2, -1)!
    expect(ids(plan.rows)).toEqual(['a', 'c', 'b'])
    expect(plan.rows.map((r) => r.sort_order)).toEqual([0, 1, 5])
    expect(plan.updates).toEqual([
      { id: 'c', sort_order: 1 },
      { id: 'b', sort_order: 5 }
    ])
  })

  it('renumbers rows that share a sort_order so the move sticks', () => {
    const rows = [
      { id: 'a', sort_order: 0 },
      { id: 'b', sort_order: 0 },
      { id: 'c', sort_order: 0 }
    ]
    const plan = planReorder(rows, 0, 1)!
    expect(ids(plan.rows)).toEqual(['b', 'a', 'c'])
    expect(plan.rows.map((r) => r.sort_order)).toEqual([0, 1, 2])
    // a and c change, b already sits at 0 in its new slot.
    expect(plan.updates).toEqual([
      { id: 'a', sort_order: 1 },
      { id: 'c', sort_order: 2 }
    ])
  })

  it('renumbers when duplicates exist elsewhere in the list', () => {
    const rows = [
      { id: 'a', sort_order: 0 },
      { id: 'b', sort_order: 0 },
      { id: 'c', sort_order: 3 },
      { id: 'd', sort_order: 4 }
    ]
    const plan = planReorder(rows, 3, -1)!
    expect(ids(plan.rows)).toEqual(['a', 'b', 'd', 'c'])
    expect(plan.rows.map((r) => r.sort_order)).toEqual([0, 1, 2, 3])
  })

  it('treats a missing sort_order as a value that needs writing', () => {
    const rows = [
      { id: 'a', sort_order: null },
      { id: 'b', sort_order: null }
    ]
    const plan = planReorder(rows, 1, -1)!
    expect(ids(plan.rows)).toEqual(['b', 'a'])
    expect(plan.updates).toEqual([
      { id: 'b', sort_order: 0 },
      { id: 'a', sort_order: 1 }
    ])
  })

  it('returns null for moves past either end', () => {
    const rows = [{ id: 'a', sort_order: 0 }, { id: 'b', sort_order: 1 }]
    expect(planReorder(rows, 0, -1)).toBeNull()
    expect(planReorder(rows, 1, 1)).toBeNull()
    expect(planReorder(rows, 5, -1)).toBeNull()
    expect(planReorder(rows, 0, 0)).toBeNull()
  })
})
