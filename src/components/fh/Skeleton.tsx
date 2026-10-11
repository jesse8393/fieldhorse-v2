import type { CSSProperties } from 'react'
import { cx } from './cx.ts'

// Loading placeholders shaped like the data they stand in for (spec 7 and
// 9.13). No spinners. A slow, faint shimmer that holds still under
// prefers-reduced-motion. Every piece is aria-hidden; wrap a loading
// region in SkeletonRows, or give it role="status" and a hidden
// "Loading" line yourself.

export type SkeletonShape = 'line' | 'block' | 'circle'

export type SkeletonProps = {
  shape?: SkeletonShape
  /** Width, in px or any CSS length. Lines and blocks default to the full width. */
  width?: number | string
  /** Height, in px or any CSS length. Lines default to 12, blocks to 64. */
  height?: number | string
  /** Diameter of a circle. */
  size?: number
  className?: string
  style?: CSSProperties
}

function len(value: number | string | undefined): string | undefined {
  return typeof value === 'number' ? `${value}px` : value
}

export default function Skeleton({ shape = 'line', width, height, size = 40, className, style }: SkeletonProps) {
  const box: CSSProperties = shape === 'circle'
    ? { width: len(size), height: len(size) }
    : { width: len(width), height: len(height) }
  return (
    <span
      className={cx('fhc-skel', `fhc-skel--${shape}`, className)}
      style={{ ...box, ...style }}
      aria-hidden="true"
    />
  )
}

/** A placeholder shaped like a Row: title and subline left, money and next right. */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cx('fhc-skel-row', className)} aria-hidden="true">
      <span className="fhc-skel-row__left">
        <Skeleton width="62%" height={14} />
        <Skeleton width="44%" height={12} />
      </span>
      <span className="fhc-skel-row__right">
        <Skeleton width={84} height={14} />
        <Skeleton width={56} height={12} />
      </span>
    </div>
  )
}

export type SkeletonRowsProps = {
  rows?: number
  /** What a screen reader hears while it loads. */
  label?: string
  className?: string
}

/** A loading list: Row shaped placeholders in a polite status region. */
export function SkeletonRows({ rows = 3, label = 'Loading', className }: SkeletonRowsProps) {
  return (
    <div className={cx('fhc-skel-rows', className)} role="status" aria-live="polite" aria-busy="true">
      <span className="fhc-vh">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  )
}
