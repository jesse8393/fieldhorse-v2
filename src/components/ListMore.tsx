import { Button } from './fh'
import { LIST_WINDOW } from '../lib/useListWindow.ts'

/**
 * The foot of a list drawn 40 rows at a time (lib/useListWindow.ts): how
 * many of how many show, and Load more while some are still hidden.
 * Nothing shows for a list short enough to draw whole.
 */
export default function ListMore({ shown, total, noun, onMore }: { shown: number; total: number; noun: string; onMore: () => void }) {
  if (total <= LIST_WINDOW) return null
  return (
    <div className="fh-list-more">
      <p aria-live="polite">Showing {shown} of {total} {noun}.</p>
      {shown < total && <Button variant="secondary" size="md" onClick={onMore}>Load more {noun}</Button>}
    </div>
  )
}
