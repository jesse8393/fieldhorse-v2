// FieldhorseEmblem — the canonical brand mark.
//
// Renders the operator-provided artwork (/public/icon-source.png)
// as an <img>. The PNG is the source of truth — same file the PWA
// home-screen icons (192/512) and the iOS apple-touch-icon are
// generated from in scripts/build-icons.mjs — so the in-app badge
// and the install icon never drift.
//
// Props:
//   size  — pixel side length (defaults to 28 for inline use; pass 96+
//           for hero contexts)
//   title — accessible name (set null to make decorative)

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
      // Versioned query string busts the iOS Safari + service worker
      // cache when the underlying PNG changes. Bump the number when
      // /public/icon-192.png is regenerated from a new icon-source.png.
      src="/icon-192.png?v=2"
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
