// FieldhorseEmblem — the glassy gold app emblem.
//
// Brushed-gold "F" with a horse-head silhouette punched through it as
// negative space, set on a black rounded plate with a thin gold inner
// ring. Geometry mirrors /public/icon.svg so the in-app badge and the
// home-screen icon never drift.
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
  const plateId = 'fh-emblem-plate'
  const goldId = 'fh-emblem-gold'
  const ringId = 'fh-emblem-ring'
  const glossId = 'fh-emblem-gloss'
  const shineId = 'fh-emblem-shine'

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
        <linearGradient id={plateId} x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#15110b" />
          <stop offset="55%" stopColor="#0c0b09" />
          <stop offset="100%" stopColor="#070605" />
        </linearGradient>

        <linearGradient id={goldId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#F0CC78" />
          <stop offset="38%" stopColor="#D9A648" />
          <stop offset="72%" stopColor="#A77A28" />
          <stop offset="100%" stopColor="#6B4D16" />
        </linearGradient>

        <linearGradient id={ringId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#D9A648" />
          <stop offset="100%" stopColor="#7A5A1F" />
        </linearGradient>

        <linearGradient id={glossId} x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.18" />
          <stop offset="35%" stopColor="#FFFFFF" stopOpacity="0.04" />
          <stop offset="55%" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.18" />
        </linearGradient>

        <linearGradient id={shineId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.32" />
          <stop offset="22%" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="78%" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.22" />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width="200" height="200" rx="44" ry="44" fill={`url(#${plateId})`} />

      <rect x="9" y="9" width="182" height="182" rx="36" ry="36"
            fill="none" stroke={`url(#${ringId})`} strokeWidth="1.6" opacity="0.9" />
      <rect x="13" y="13" width="174" height="174" rx="33" ry="33"
            fill="none" stroke={`url(#${ringId})`} strokeWidth="0.6" opacity="0.5" />

      <path
        fill={`url(#${goldId})`}
        fillRule="evenodd"
        d="
          M 56 38
          L 158 38
          Q 162 38 162 42
          L 162 70
          Q 162 74 158 74
          L 108 74
          L 108 92
          L 146 92
          Q 150 92 150 96
          L 150 122
          Q 150 126 146 126
          L 108 126
          L 108 162
          Q 108 166 104 166
          L 60 166
          Q 56 166 56 162
          Z

          M 90 62
          L 96 56 L 100 64
          Q 104 70 110 76
          Q 122 86 132 96
          Q 138 104 132 104
          L 124 104
          Q 122 100 118 98
          Q 116 102 116 106
          Q 116 110 113 110
          Q 110 110 108 107
          L 108 92
          L 100 92
          Q 96 92 92 88
          Q 88 84 86 80
          Q 82 78 78 86
          Q 74 96 74 110
          Q 74 124 76 134
          Q 78 142 82 146
          Q 78 148 74 144
          Q 66 134 64 120
          Q 60 104 64 90
          Q 68 76 78 70
          Q 84 66 90 62
          Z
        "
      />

      <rect x="0" y="0" width="200" height="200" rx="44" ry="44"
            fill={`url(#${shineId})`} pointerEvents="none" />
      <rect x="0" y="0" width="200" height="200" rx="44" ry="44"
            fill={`url(#${glossId})`} pointerEvents="none" />
    </svg>
  )
}
