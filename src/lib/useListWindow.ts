// Long lists draw their first 40 rows and a Load more button that adds 40
// at a time, the way Customers does (Clients.tsx). Five hundred rows at
// once stalled every search keystroke on a phone. How far a list was
// opened is kept with the history entry, so Back returns to the same rows.

import { useCallback } from 'react'
import { useHistoryEntryState } from './useHistoryEntryState.ts'

export const LIST_WINDOW = 40

const validWindow = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= LIST_WINDOW && Number(value) <= 100_000

/** How many rows of the named list to draw, and a way to draw 40 more. */
export function useListWindow(name: string) {
  const [count, setCount] = useHistoryEntryState(`list:${name}`, LIST_WINDOW, validWindow)
  const showMore = useCallback(() => setCount((n) => n + LIST_WINDOW), [setCount])
  return { count, showMore }
}
