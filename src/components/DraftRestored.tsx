// The quiet line a screen shows when it brought back changes that were
// typed earlier and not saved (useEditDraft). Discard asks with a second
// tap on the same button (D57), then forgets them.

import { Button } from './fh'
import { useSecondTap } from '../lib/secondTap.ts'
import './draft-restored.css'

export default function DraftRestored({ onDiscard, className }: { onDiscard: () => void; className?: string }) {
  const discardTap = useSecondTap()
  return (
    <div className={className ? `fh-draft-restored ${className}` : 'fh-draft-restored'} role="status">
      <span>Unsaved changes restored</span>
      <Button variant="quiet" size="mini" onClick={() => discardTap.tap(onDiscard)}>
        {discardTap.armed ? 'Tap again to discard' : 'Discard'}
      </Button>
    </div>
  )
}
