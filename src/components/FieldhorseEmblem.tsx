// FieldhorseEmblem — the glassy gold app emblem.
//
// Stylized "F" letterform with a swooshing wing detail cutting through
// the middle bar, set on a rounded-square plate. Modeled on the
// reference splash mark the user shared (originally orange) — recolored
// to brand gold, with a top-down glass highlight and subtle inner
// bevel.
//
// Self-contained SVG; no external font dependency. Renders crisp at
// any size because every shape is path / rect geometry.
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
  // Stable IDs so multiple emblems on one page don't collide on the
  // <defs> gradient references.
  const goldId = 'fh-emblem-gold'
  const glossId = 'fh-emblem-gloss'
  const bevelId = 'fh-emblem-bevel'
  const wingId = 'fh-emblem-wing'

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 200 200"
      role={title ? 'img' : 'presentation'}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
      style={style}
      className={className}
    >
      <defs>
        {/* Gold body — slight diagonal warm-to-deeper gradient so the
            plate doesn't read as a flat swatch. */}
        <linearGradient id={goldId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#E8B04C" />
          <stop offset="55%" stopColor="#C9963A" />
          <stop offset="100%" stopColor="#A77A28" />
        </linearGradient>

        {/* Glass gloss highlight — top half soft white wash that fades
            to transparent, sells the "wet glass" finish. */}
        <linearGradient id={glossId} x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.42" />
          <stop offset="48%" stopColor="#FFFFFF" stopOpacity="0.08" />
          <stop offset="55%" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.10" />
        </linearGradient>

        {/* Inner bevel — 1px lighter inner stroke at top, darker at
            bottom, gives the icon a faint embossed edge. */}
        <linearGradient id={bevelId} x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.35" />
          <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.25" />
        </linearGradient>

        {/* White wing — slight top-to-bottom fade to give the swoosh
            its own subtle depth instead of reading as paper-flat. */}
        <linearGradient id={wingId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#F3EFE6" />
        </linearGradient>
      </defs>

      {/* Rounded-square plate. Corner radius ~22% of side matches the
          iOS app-icon squircle proportion the reference uses. */}
      <rect x="0" y="0" width="200" height="200" rx="44" ry="44" fill={`url(#${goldId})`} />

      {/* F letterform — left stem + top bar with a black "sail" wedge
          biting into it from the top edge. The wedge is what gives
          the top bar its slanted profile in the reference. */}
      <g fill="#0E0E10">
        {/* Vertical stem */}
        <rect x="50" y="50" width="32" height="110" rx="4" ry="4" />
        {/* Sail wedge — clipped polygon eating into the top bar so the
            top bar reads as a thick curved arc rather than a flat
            rectangle. Approximated with a path. */}
        <path d="M 50 50 L 158 50 L 152 88 Q 128 76 96 80 L 50 80 Z" />
      </g>

      {/* White wing swoosh through the middle. Sweeps from the stem
          out to the right and curls down, finishing the "F" as a
          stylized winged form. */}
      <path
        d="M 50 96
           L 132 96
           Q 152 96 152 116
           Q 152 144 122 158
           Q 96 168 78 162
           Q 96 156 110 142
           Q 122 128 122 116
           Q 122 110 116 110
           L 50 110 Z"
        fill={`url(#${wingId})`}
      />

      {/* Glass gloss on top, slight darken at bottom. Sits ABOVE the
          letterform so the F reads as embedded in glass. */}
      <rect x="0" y="0" width="200" height="200" rx="44" ry="44" fill={`url(#${glossId})`} />

      {/* Inner bevel stroke — 1.5px stroke on a slightly inset rect,
          gradient stroke fakes the bevel without filters. */}
      <rect
        x="1.5"
        y="1.5"
        width="197"
        height="197"
        rx="43"
        ry="43"
        fill="none"
        stroke={`url(#${bevelId})`}
        strokeWidth="1.5"
      />
    </svg>
  )
}
