// LoadingValue, a number or a short line that has not been read yet.
//
// The fh Skeleton stands where the value will go, inside a polite busy
// region with a hidden line, as SkeletonRows does for a list, so a count,
// a total or a status never reads as zero, empty or "all clear" before the
// read that fills it has landed (Phase 8 follow up A). It never prints a
// number or a dash.
//
// The inline styles keep the placeholder's own box: the build screens
// style every span inside their tiles and rail cards (display block, a top
// margin), and this one sits in those spans' place.

import Skeleton from './fh/Skeleton.tsx'

export type LoadingValueProps = {
  /** What a screen reader hears while the value loads. */
  label?: string
  /** The placeholder's width, in px or any CSS length. */
  width?: number | string
  /** The placeholder's height, in px or any CSS length. */
  height?: number | string
  className?: string
}

export default function LoadingValue({ label = 'Loading', width = 64, height = 16, className }: LoadingValueProps) {
  return (
    <span
      className={className}
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{ display: 'inline-block', maxWidth: '100%', margin: 0, verticalAlign: 'middle' }}
    >
      <span className="fhc-vh">{label}</span>
      <Skeleton width={width} height={height} style={{ display: 'block', margin: 0 }} />
    </span>
  )
}
