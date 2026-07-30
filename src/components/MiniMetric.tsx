// Shared MiniMetric tile extracted from 17 inlined copies across the
// Snow*Build desktop screens and a few mobile screens (Team, Tasks,
// Timesheets, SubPortal, etc.). Uses the .fh-build-mini class from
// the LET'S BUILD design system, so it inherits its sizing /
// background / typography wherever it's dropped.
//
// Props:
//   label   Small caption under the value.
//   value   Pre-formatted display node. Format upstream, this
//           component is dumb so callers can pick money(), moneyFull(),
//           plain numbers, or a loading skeleton as appropriate.
//   accent  When true, paints the value in the brand gold so the tile
//           reads as a primary signal in a row of equal-weight tiles.
//   tone    Override colour for warning ('warn' → amber) or alert
//           ('bad' → red) signals. Wins over `accent` when set.
//
// Crew.tsx keeps its own inline copy because it has special
// capitalize-on-label='Your role' logic that doesn't generalize.

import type { ReactNode } from 'react'

type Tone = 'warn' | 'bad'

export default function MiniMetric({
  label,
  value,
  accent,
  tone,
}: {
  label: string
  value: ReactNode
  accent?: boolean
  tone?: Tone
}) {
  return (
    <div className="fh-build-mini">
      <strong
        style={{
          color:
            tone === 'bad'  ? 'var(--v3-danger-bright)'
          : tone === 'warn' ? '#C9963A'
          : accent          ? 'var(--v3-primary, #C9963A)'
          : undefined,
        }}
      >
        {value}
      </strong>
      <span>{label}</span>
    </div>
  )
}
