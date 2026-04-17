// Fieldhorse monogram — FH mark for app icon, push, loaders.
// Scales from 16 → 1024. Gold on onyx with subtle radial glow.

export default function Monogram({ size = 48, variant = 'dark', glow = true }) {
  const bg = variant === 'dark' ? '#0B0B0B' : '#F2EDE4'
  const ink = variant === 'dark' ? '#F2EDE4' : '#0B0B0B'
  const gold = '#C7A45A'
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      aria-label="Fieldhorse"
      role="img"
    >
      <defs>
        <radialGradient id="fh-glow" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor={gold} stopOpacity="0.35" />
          <stop offset="60%" stopColor={gold} stopOpacity="0.05" />
          <stop offset="100%" stopColor={gold} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="fh-bar" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={gold} stopOpacity="0.1" />
          <stop offset="50%" stopColor={gold} stopOpacity="1" />
          <stop offset="100%" stopColor={gold} stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="96" fill={bg} />
      {glow && <rect width="512" height="512" rx="96" fill="url(#fh-glow)" />}
      {/* FH monogram — geometric, Bebas-inspired */}
      <g stroke={gold} strokeWidth="0" fill={gold}>
        {/* F */}
        <rect x="120" y="150" width="28" height="220" />
        <rect x="120" y="150" width="130" height="28" />
        <rect x="120" y="248" width="100" height="24" />
        {/* H */}
        <rect x="300" y="150" width="28" height="220" fill={ink} />
        <rect x="364" y="150" width="28" height="220" fill={ink} />
        <rect x="300" y="248" width="92" height="24" fill={ink} />
      </g>
      {/* gold bar */}
      <rect x="120" y="398" width="272" height="6" fill="url(#fh-bar)" />
      {/* corner mark */}
      <polygon points="458,54 478,54 478,74" fill={gold} />
    </svg>
  )
}
