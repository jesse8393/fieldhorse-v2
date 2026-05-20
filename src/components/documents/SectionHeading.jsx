// src/components/documents/SectionHeading.jsx
//
// Small reusable header pattern used inside every document section.
// Eyebrow on top (gold, letter-spaced, uppercase), title under it,
// optional right-aligned meta on the same baseline as the title.
//
// Pure presentation. No data, no state. Shared so the visual cadence
// from "Scope of Work" → "Pricing Summary" → "Payment Terms" stays
// consistent across both proposal + invoice templates.

import { DOC_COLORS, typeStyle, resolveBrandGold } from './tokens.ts'

export default function SectionHeading({ eyebrow, title, meta, company }) {
  const gold = resolveBrandGold(company)
  return (
    <header style={{ marginBottom: 14 }}>
      {eyebrow && (
        <div style={{ ...typeStyle('eyebrow'), color: gold, marginBottom: 6 }}>
          {eyebrow}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap'
        }}
      >
        {title && (
          <h2 style={{ ...typeStyle('h2'), color: DOC_COLORS.ink, margin: 0 }}>
            {title}
          </h2>
        )}
        {meta && (
          <div style={{ ...typeStyle('sub'), color: DOC_COLORS.inkMuted }}>
            {meta}
          </div>
        )}
      </div>
      <div
        style={{
          marginTop: 10,
          height: 1,
          background: DOC_COLORS.rule
        }}
        aria-hidden="true"
      />
    </header>
  )
}
