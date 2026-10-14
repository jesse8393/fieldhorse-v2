import { useId } from 'react'
import { Sheet } from '../../components/fh'
import { hapticTap } from '../../lib/haptics.ts'
import type { JobsSort } from '../../lib/jobsList.ts'

// The Jobs filter (spec 9.3, decision D3). Lost jobs live here, behind
// "Show lost jobs", and so does the sort. Sorting by amount is offered
// only to roles that may see money. Every change applies at once, so
// the sheet needs no Save.

export type JobsFilterSheetProps = {
  /** "Filter and sort", or "Filter" when there is no sort to offer. */
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  showLost: boolean
  onShowLostChange: (next: boolean) => void
  sort: JobsSort
  onSortChange: (next: JobsSort) => void
  /** Money roles only: offer "Amount" as a sort. */
  canSortByAmount: boolean
}

const SORTS: { id: JobsSort; label: string }[] = [
  { id: 'next', label: 'Next step' },
  { id: 'amount', label: 'Amount' }
]

export default function JobsFilterSheet({
  title,
  open,
  onOpenChange,
  showLost,
  onShowLostChange,
  sort,
  onSortChange,
  canSortByAmount
}: JobsFilterSheetProps) {
  const id = useId()
  const switchId = `${id}-lost`
  const hintId = `${id}-lost-hint`
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
      <div className="fhjl-filter">
        <div className="fhjl-filter__switch">
          <div className="fhjl-filter__switch-text">
            <label className="fhjl-filter__label" htmlFor={switchId}>Show lost jobs</label>
            <p className="fhjl-filter__hint" id={hintId}>They show at the end of the list and never count toward the tabs.</p>
          </div>
          <button
            type="button"
            id={switchId}
            role="switch"
            aria-checked={showLost}
            aria-describedby={hintId}
            className="fhjl-switch"
            onClick={() => { hapticTap(); onShowLostChange(!showLost) }}
          >
            <span className="fhjl-switch__thumb" aria-hidden="true" />
          </button>
        </div>

        {canSortByAmount && (
          <fieldset className="fhjl-filter__sort">
            <legend className="fhjl-filter__legend">Sort by</legend>
            <div className="fhjl-seg">
              {SORTS.map((s) => (
                <label key={s.id} className="fhjl-seg__option">
                  <input
                    type="radio"
                    name={`${id}-sort`}
                    value={s.id}
                    checked={sort === s.id}
                    onChange={() => { hapticTap(); onSortChange(s.id) }}
                  />
                  <span className="fhjl-seg__face">{s.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>
    </Sheet>
  )
}
