import { useState } from 'react'

// Company badge (spec section 7): the company's logo on an onyx tile,
// or its initials in gold with a gold edge when there is no logo or it
// fails to load. Tenant logos are usually drawn for dark grounds (cream
// or white marks), so the tile is onyx in both themes.
export type MonogramSize = 32 | 40 | 48

type MonogramProps = {
  name?: string | null
  logoUrl?: string | null
  size?: MonogramSize
  className?: string
}

/** Up to two initials: "Parker Construction" gives "PC", "Shyld" gives "S". */
export function initialsFor(name?: string | null): string {
  const words = (name || '').trim().split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w))
  if (words.length === 0) return 'FH'
  const letters = words.slice(0, 2).map((w) => w.match(/[A-Za-z0-9]/)?.[0] ?? '')
  return letters.join('').toUpperCase()
}

export default function Monogram({ name, logoUrl, size = 40, className }: MonogramProps) {
  // The logo URL that failed (expired signed URL, deleted object,
  // offline cold start). Keyed by URL so a new upload is tried again.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showLogo = Boolean(logoUrl) && logoUrl !== failedSrc
  return (
    <span
      className={`fhc-monogram fhc-monogram--${size}${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    >
      {showLogo ? (
        <img src={logoUrl as string} alt="" onError={() => setFailedSrc(logoUrl as string)} />
      ) : (
        <span className="fhc-monogram__initials">{initialsFor(name)}</span>
      )}
    </span>
  )
}
