import type { ReactNode } from 'react'
import { cx } from './cx.ts'

// One entry on the Spine, the job timeline (spec 7 and 9.4): a time
// column (two lines allowed, "7:12" over "today"), the line and its
// marker, then the title, a subline and optional photo thumbnails. The
// marker is filled green for passed and paid events (tone success) and
// neutral otherwise; the words say which. Thumbnails reserve their box
// with aspect-ratio and load lazily. Entries that follow each other draw
// one continuous line; the last entry stops at its marker.

export type SpinePhoto = { src: string; alt: string }

export type SpineEntryProps = {
  /** First line of the time column, such as "7:12" or "Sep 30". */
  time: ReactNode
  /** Optional second line, such as "today" or "Wed". */
  day?: ReactNode
  /** Machine readable time for the <time> element. */
  dateTime?: string
  title: ReactNode
  subline?: ReactNode
  /** Green filled marker for passed and paid events. */
  tone?: 'success' | 'neutral'
  photos?: SpinePhoto[]
  /** How many thumbnails to show before "+N". */
  maxPhotos?: number
  /** Render as a list item inside an <ol>. */
  as?: 'div' | 'li'
  className?: string
}

export default function SpineEntry({
  time,
  day,
  dateTime,
  title,
  subline,
  tone = 'neutral',
  photos,
  maxPhotos = 3,
  as: Tag = 'div',
  className
}: SpineEntryProps) {
  const shown = photos?.slice(0, Math.max(1, maxPhotos)) ?? []
  const more = (photos?.length ?? 0) - shown.length

  return (
    <Tag className={cx('fhc-spine', `fhc-spine--${tone}`, className)}>
      <time className="fhc-spine__time" dateTime={dateTime}>
        <span>{time}</span>
        {day != null && day !== false && <span>{day}</span>}
      </time>
      <span className="fhc-spine__rail" aria-hidden="true">
        <span className="fhc-spine__marker" />
      </span>
      <div className="fhc-spine__body">
        <p className="fhc-spine__title">{title}</p>
        {subline != null && subline !== false && <p className="fhc-spine__sub">{subline}</p>}
        {shown.length > 0 && (
          <ul className="fhc-spine__photos">
            {shown.map((photo, i) => (
              <li key={`${photo.src}-${i}`} className="fhc-spine__photo">
                <img src={photo.src} alt={photo.alt} loading="lazy" decoding="async" />
                {more > 0 && i === shown.length - 1 && (
                  <span className="fhc-spine__more">
                    <span aria-hidden="true">+{more}</span>
                    <span className="fhc-vh">and {more} more {more === 1 ? 'photo' : 'photos'}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Tag>
  )
}
