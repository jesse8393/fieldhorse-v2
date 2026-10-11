import type { HTMLAttributes } from 'react'
import { cx } from './cx.ts'

// Status chip (spec 5.4): jewel tone fill and ink, radius 7, 13/16 500.
// Every status color travels with a word, so the label is required and
// is plain text. Red is only for late money or failed safety.
//
//   success  On site, Paid, Passed, Approved, Done
//   info     Scheduled, New, Starts Mon, Truck 7:10
//   danger   6 days overdue, Inspection failed
//   neutral  Lead, Draft, Sent yesterday

export type ChipTone = 'success' | 'info' | 'danger' | 'neutral'

export type ChipProps = {
  /** The word the status color travels with. Required. */
  label: string
  tone?: ChipTone
  /** A small leading dot in the tone's dot color. */
  dot?: boolean
  className?: string
} & Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'className'>

export default function Chip({ label, tone = 'neutral', dot = false, className, ...rest }: ChipProps) {
  return (
    <span {...rest} className={cx('fhc-chip', `fhc-chip--${tone}`, className)}>
      {dot && <span className="fhc-chip__dot" aria-hidden="true" />}
      {label}
    </span>
  )
}
