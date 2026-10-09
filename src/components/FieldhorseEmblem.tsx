// FieldhorseEmblem, the canonical brand mark.
//
// Renders /icon-192.png as an <img>. scripts/build-icons.mjs generates
// it, the 512 icon and the iOS apple-touch-icon from the same
// operator-provided artwork (design/icon-source.png), so the in-app
// badge and the install icon never drift.
//
// Props:
//   size , pixel side length (defaults to 28 for inline use; pass 96+
//           for hero contexts)
//   title, accessible name (set null to make decorative)

import type { CSSProperties } from 'react'

type Props = {
  size?: number
  title?: string | null
  style?: CSSProperties
  className?: string
}

export default function FieldhorseEmblem({
  size = 28,
  title = 'Fieldhorse',
  style,
  className,
}: Props) {
  const isDecorative = title == null
  return (
    <img
      // Plain URL, no version query: it has to match the service worker
      // precache entry exactly, or an offline cold start shows a broken
      // image. The precache revision already picks up a regenerated PNG.
      src="/icon-192.png"
      width={size}
      height={size}
      alt={isDecorative ? '' : title}
      aria-hidden={isDecorative ? true : undefined}
      role={isDecorative ? 'presentation' : 'img'}
      draggable={false}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        // The PNG already has its rounded-square plate baked in, but
        // a subtle border-radius keeps anti-aliasing clean at tiny
        // sizes and prevents stray edge pixels on dark backgrounds.
        borderRadius: Math.round(size * 0.22),
        ...style,
      }}
      className={className}
    />
  )
}
