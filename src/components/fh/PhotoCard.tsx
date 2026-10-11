import { useState } from 'react'
import type { ReactNode } from 'react'
import { cx } from './cx.ts'

// A job photo in a paper tray (spec 7 and 11): 6 px of paper around the
// photo with a hairline edge, radius 18, and the raised shadow. Text sits
// in linen on --fh-scrim at the bottom, with an optional action such as a
// "Navigate" pill. The photo box is reserved with aspect-ratio and loads
// lazily. With no photo, or one that fails to load, the frame falls back
// to the onyx stage look with the same text.

type PhotoCardOwnProps = {
  /** Small line above the title, such as "Next stop, 7:30 am". */
  eyebrow?: ReactNode
  title: ReactNode
  /** One control at the bottom right, such as a Navigate Button. */
  action?: ReactNode
  /** CSS aspect ratio of the photo box. */
  ratio?: string
  /** Heading level for the title, or a plain paragraph. */
  titleAs?: 'h2' | 'h3' | 'p'
  /** Load the photo right away, for a card at the top of the first screen. */
  eager?: boolean
  className?: string
}

export type PhotoCardWithPhotoProps = PhotoCardOwnProps & {
  src: string
  /** Required with a photo: what it shows. */
  alt: string
}
export type PhotoCardWithoutPhotoProps = PhotoCardOwnProps & { src?: null; alt?: undefined }

export type PhotoCardProps = PhotoCardWithPhotoProps | PhotoCardWithoutPhotoProps

export default function PhotoCard({
  src,
  alt,
  eyebrow,
  title,
  action,
  ratio = '16 / 9',
  titleAs: Title = 'h3',
  eager = false,
  className
}: PhotoCardProps) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const hasPhoto = Boolean(src) && src !== failedSrc

  return (
    <div className={cx('fhc-photo', !hasPhoto && 'fhc-photo--empty', className)}>
      <div
        className={cx('fhc-photo__frame', !hasPhoto && 'fh-grain')}
        style={{ aspectRatio: ratio }}
      >
        {hasPhoto && (
          <img
            className={cx('fhc-photo__img', loadedSrc === src && 'is-loaded')}
            src={src as string}
            alt={alt}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            onLoad={() => setLoadedSrc(src as string)}
            onError={() => setFailedSrc(src as string)}
          />
        )}
        <div className="fhc-photo__overlay fh-onyx-scope">
          <div className="fhc-photo__text">
            {eyebrow != null && eyebrow !== false && <p className="fhc-photo__eyebrow">{eyebrow}</p>}
            <Title className="fhc-photo__title">{title}</Title>
          </div>
          {action != null && <div className="fhc-photo__action">{action}</div>}
        </div>
      </div>
    </div>
  )
}
