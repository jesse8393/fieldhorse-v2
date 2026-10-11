import type { HTMLAttributes } from 'react'
import { cx } from './cx.ts'

// Small key label for desktop shortcuts (spec 7, 9.11 and 9.12): 12 px on
// paper with an edge, radius 7, drawn as <kbd>. Pass `label` when the
// glyph does not read well aloud ("⌘K" is read as "Command K").

export type KeyCapProps = {
  /** The keys as printed, such as "⌘K", "esc" or "I". */
  children: string
  /** What a screen reader says instead of the glyph. */
  label?: string
  className?: string
} & Omit<HTMLAttributes<HTMLElement>, 'children' | 'className'>

export default function KeyCap({ children, label, className, ...rest }: KeyCapProps) {
  return (
    <kbd {...rest} className={cx('fhc-keycap', className)}>
      {label ? (
        <>
          <span aria-hidden="true">{children}</span>
          <span className="fhc-vh">{label}</span>
        </>
      ) : (
        children
      )}
    </kbd>
  )
}
