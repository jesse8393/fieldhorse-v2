// Pure planner for moving a quote line item up or down.
//
// The editor lists rows by sort_order (then created_at). Swapping the two
// neighbours' sort_order values is enough while every value is distinct,
// but rows that share a value (the sibling mobile app inserts without a
// sort_order, so each row gets the column default 0) would swap equal
// numbers and never move. When any value repeats, the whole list is
// renumbered 0..n-1 in its new visual order and only the rows whose
// number changed are written back.

export type OrderedRow = { id: string; sort_order?: number | null }

export type ReorderPlan<T extends OrderedRow> = {
  rows: T[]
  updates: { id: string; sort_order: number }[]
}

function orderOf(row: OrderedRow) {
  return Number(row.sort_order) || 0
}

/**
 * Move rows[index] by direction (-1 up, +1 down). Returns the rows in
 * their new visual order with sort_order applied, plus the writes needed
 * to persist it, or null when the move is out of range.
 */
export function planReorder<T extends OrderedRow>(rows: T[], index: number, direction: number): ReorderPlan<T> | null {
  const target = index + direction
  if (direction === 0) return null
  if (index < 0 || index >= rows.length || target < 0 || target >= rows.length) return null

  const orders = rows.map(orderOf)
  const hasDuplicates = new Set(orders).size !== orders.length

  if (!hasDuplicates) {
    const a = rows[index]
    const b = rows[target]
    const next = rows.slice()
    next[target] = { ...a, sort_order: orderOf(b) }
    next[index] = { ...b, sort_order: orderOf(a) }
    return {
      rows: next,
      updates: [
        { id: a.id, sort_order: orderOf(b) },
        { id: b.id, sort_order: orderOf(a) }
      ]
    }
  }

  const moved = rows.slice()
  const [row] = moved.splice(index, 1)
  moved.splice(target, 0, row)
  const updates: { id: string; sort_order: number }[] = []
  const next = moved.map((r, i) => {
    if (r.sort_order != null && orderOf(r) === i) return r
    updates.push({ id: r.id, sort_order: i })
    return { ...r, sort_order: i }
  })
  return { rows: next, updates }
}
