import type { ReactNode } from 'react'
import { RAIL_SEGMENTS, railStage, segmentStatus } from '../../lib/stageRail.ts'
import type { RailRecord, RailSegmentId } from '../../lib/stageRail.ts'
import Chip from './Chip.tsx'
import { cx } from './cx.ts'

// Five segment stage rail (spec section 7): Lead, Quote, Job, Invoice,
// Closed. Done segments are --fh-ink-4, the current one is gold with a
// bold ink label (the label carries the meaning, gold alone is 2.2 to 1),
// future ones are hairline. A lost record has no current segment and a
// neutral "Lost" chip beside the rail. The segment comes from
// railStage() in lib/stageRail.ts, which follows the stage rule table.
//
// An ordered list, with aria-current="step" on the current segment. Notes
// under each label (dates, balances) show on desktop widths only.

export type StageRailProps = {
  /** The lead, quote or job record: its stage and completed_at. */
  record: RailRecord
  /** Optional note line per segment, such as "Approved Sep 28". Desktop only. */
  notes?: Partial<Record<RailSegmentId, ReactNode>>
  /** Names the list for screen readers. */
  'aria-label'?: string
  className?: string
}

const SPOKEN_STATUS = { done: ', done', current: '', future: '' } as const

export default function StageRail({ record, notes, className, 'aria-label': ariaLabel = 'Stage' }: StageRailProps) {
  const state = railStage(record)

  return (
    <div className={cx('fhc-rail', notes && 'has-notes', state.lost && 'is-lost', className)}>
      <ol className="fhc-rail__list" aria-label={ariaLabel}>
        {RAIL_SEGMENTS.map((segment, index) => {
          const status = segmentStatus(state, index)
          const note = notes?.[segment.id]
          return (
            <li
              key={segment.id}
              className={cx('fhc-rail__seg', `is-${status}`)}
              aria-current={status === 'current' ? 'step' : undefined}
            >
              <span className="fhc-rail__bar" aria-hidden="true" />
              <span className="fhc-rail__label">
                {segment.label}
                {SPOKEN_STATUS[status] && <span className="fhc-vh">{SPOKEN_STATUS[status]}</span>}
              </span>
              {note != null && note !== false && <span className="fhc-rail__note">{note}</span>}
            </li>
          )
        })}
      </ol>
      {state.lost && <Chip className="fhc-rail__lost" tone="neutral" label="Lost" />}
    </div>
  )
}
