// src/components/documents/ScopeSectionCard.tsx
//
// Reusable card for a proposal scope section. Sits on the proposal
// "Scope of Work" page. One card per trade, e.g. Demolition, Roofing,
// Exterior, Interior, Concrete, Electrical, Allowances, Exclusions,
// Warranty. The contractor's existing fh_quote_items.section column
// drives grouping; this card just renders one group's data.
//
// Supports:
//   - title       (e.g. "Roofing")
//   - description (free-text paragraph; markdown not parsed, pre-baked)
//   - bullets     (array of strings rendered as a clean dot list)
//   - items       optional [{ description, qty, unit, rate, amount,
//                              is_optional, is_excluded, notes }]
//   - photos      optional [{ url, caption }]  rendered as a small grid
//   - internalNote (only shown when showInternalNotes=true; never on
//                     customer facing exports)
//   - showPricing (false by default, Scope page leans editorial;
//                  Pricing Summary page is where the money lives)
//
// Drag reorder is intentionally out of scope here (spec said "do not
// overbuild now"); section ordering comes from the array passed by
// the template's parent.

import { DOC_COLORS, typeStyle } from './tokens.ts'
import { money } from './format.ts'

export default function ScopeSectionCard({
  title,
  description,
  bullets = [],
  items = [],
  photos = [],
  internalNote,
  showPricing = false,
  showInternalNotes = false
}: any) {
  const visibleItems = items.filter((it: any) => !it?.is_excluded)
  const hasBody = description || bullets.length > 0 || visibleItems.length > 0 || photos.length > 0

  return (
    <section
      style={{
        padding: '16px 24px',
        border: `1px solid ${DOC_COLORS.rule}`,
        borderRadius: 10,
        background: DOC_COLORS.paper,
        breakInside: 'avoid'
      }}
    >
      <h3
        style={{
          ...typeStyle('h3'),
          color: DOC_COLORS.ink,
          margin: 0,
          marginBottom: hasBody ? 10 : 0
        }}
      >
        {title || 'Untitled section'}
      </h3>

      {description && (
        <p
          style={{
            ...typeStyle('body'),
            color: DOC_COLORS.inkMid,
            margin: '0 0 10px',
            whiteSpace: 'pre-wrap'
          }}
        >
          {description}
        </p>
      )}

      {bullets.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '0 0 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          {bullets.map((b: any, i: any) => (
            <li
              key={i}
              style={{
                ...typeStyle('body'),
                color: DOC_COLORS.inkMid,
                display: 'grid',
                gridTemplateColumns: '14px 1fr',
                gap: 8,
                alignItems: 'baseline'
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-block',
                  width: 4,
                  height: 4,
                  borderRadius: 10,
                  background: DOC_COLORS.gold,
                  marginTop: 6
                }}
              />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}

      {visibleItems.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '10px 0 0',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {visibleItems.map((it: any, i: any) => {
            const qty = Number(it.qty || 1)
            const rate = Number(it.rate || 0)
            const amount = Number(it.amount != null ? it.amount : qty * rate)
            const subline = [
              qty !== 1 ? `${qty}${it.unit ? ` ${it.unit}` : ''} × ${money(rate, { cents: true })}` : '',
              it.notes
            ].filter(Boolean).join(' · ')
            return (
              <li
                key={it.id || i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: showPricing ? '1fr auto' : '1fr',
                  gap: 16,
                  padding: '12px 0',
                  borderTop: i > 0 ? `1px solid ${DOC_COLORS.rule}` : 'none'
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ ...typeStyle('bodyBold'), color: DOC_COLORS.ink }}>
                    {it.description || '\u2003'}
                    {it.is_optional && (
                      <span
                        style={{
                          ...typeStyle('label'),
                          color: DOC_COLORS.gold,
                          marginLeft: 8
                        }}
                      >
                        UPGRADE
                      </span>
                    )}
                  </div>
                  {subline && (
                    <div style={{ ...typeStyle('sub'), color: DOC_COLORS.inkMuted, marginTop: 3 }}>
                      {subline}
                    </div>
                  )}
                </div>
                {showPricing && (
                  <div
                    style={{
                      ...typeStyle('stamp'),
                      color: DOC_COLORS.ink,
                      alignSelf: 'center',
                      textAlign: 'right',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {money(amount)}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {photos.length > 0 && (
        <div
          style={{
            marginTop: 14,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
            gap: 8
          }}
        >
          {photos.slice(0, 6).map((p: any, i: any) => (
            <figure key={p.id || i} style={{ margin: 0 }}>
              <div
                style={{
                  width: '100%',
                  aspectRatio: '4 / 3',
                  background: DOC_COLORS.paperSoft,
                  border: `1px solid ${DOC_COLORS.rule}`,
                  borderRadius: 10,
                  overflow: 'hidden'
                }}
              >
                {p.url && (
                  <img loading="lazy"src={p.url}
                    alt={p.caption || ''}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    onError={(e) => { e.currentTarget.style.opacity = '0' }}
                  />
                )}
              </div>
              {p.caption && (
                <figcaption style={{ ...typeStyle('sub'), color: DOC_COLORS.inkMuted, marginTop: 4 }}>
                  {p.caption}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      )}

      {showInternalNotes && internalNote && (
        <div
          style={{
            marginTop: 14,
            padding: '12px 12px',
            background: DOC_COLORS.paperSoft,
            border: `1px dashed ${DOC_COLORS.ruleStrong}`,
            borderRadius: 10,
            ...typeStyle('sub'),
            color: DOC_COLORS.inkMuted
          }}
        >
          <span style={{ ...typeStyle('label'), color: DOC_COLORS.inkFaint, marginRight: 6 }}>
            INTERNAL
          </span>
          {internalNote}
        </div>
      )}
    </section>
  )
}
