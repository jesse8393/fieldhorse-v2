// The five segment stage rail (spec section 7, "Stage rule").
//
// Pipeline v2 (migration 047) retired 'invoice' as a stage: invoices are
// fh_invoices rows against a job, and 'invoice' survives only as a legacy
// alias of 'job' (lib/stages.ts). The rail still draws an Invoice
// segment, derived from completed_at ("work done, money out"):
//
//   stage lead                                   Lead
//   stage quote                                  Quote
//   stage job or invoice, completed_at empty     Job
//   stage job or invoice, completed_at set       Invoice
//   stage closed                                 Closed
//   stage lost                                   no current segment, a
//                                                neutral "Lost" chip
//
// Anything else (no stage, a value this table does not know) gets no
// current segment and no chip, so the rail never claims a stage the
// record is not in.

export type RailSegmentId = 'lead' | 'quote' | 'job' | 'invoice' | 'closed'

export type RailSegment = { id: RailSegmentId; label: string }

export const RAIL_SEGMENTS: readonly RailSegment[] = [
  { id: 'lead', label: 'Lead' },
  { id: 'quote', label: 'Quote' },
  { id: 'job', label: 'Job' },
  { id: 'invoice', label: 'Invoice' },
  { id: 'closed', label: 'Closed' }
]

export type RailRecord = {
  stage?: string | null
  completed_at?: string | Date | null
}

export type RailState = {
  /** The segment the record is in now, or null (lost, or no known stage). */
  current: RailSegmentId | null
  /** Index of `current` in RAIL_SEGMENTS, or -1 when there is none. */
  currentIndex: number
  /** True when the record is lost: the rail shows a neutral "Lost" chip. */
  lost: boolean
}

function isSet(value: RailRecord['completed_at']): boolean {
  if (value == null) return false
  if (value instanceof Date) return !Number.isNaN(value.getTime())
  return String(value).trim() !== ''
}

function segment(current: RailSegmentId | null, lost = false): RailState {
  return {
    current,
    currentIndex: current ? RAIL_SEGMENTS.findIndex((s) => s.id === current) : -1,
    lost
  }
}

/** Which rail segment a lead, quote or job record sits in. */
export function railStage({ stage, completed_at }: RailRecord): RailState {
  const id = String(stage ?? '').trim().toLowerCase()
  switch (id) {
    case 'lead':
      return segment('lead')
    case 'quote':
      return segment('quote')
    case 'job':
    case 'invoice':
      return segment(isSet(completed_at) ? 'invoice' : 'job')
    case 'closed':
      return segment('closed')
    case 'lost':
      return segment(null, true)
    default:
      return segment(null)
  }
}

export type RailSegmentStatus = 'done' | 'current' | 'future'

/** Done, current or future, for the segment at `index`. */
export function segmentStatus(state: RailState, index: number): RailSegmentStatus {
  if (state.currentIndex < 0) return 'future'
  if (index < state.currentIndex) return 'done'
  if (index === state.currentIndex) return 'current'
  return 'future'
}
