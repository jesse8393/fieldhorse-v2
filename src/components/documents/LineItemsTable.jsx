// src/components/documents/LineItemsTable.jsx
//
// Shared product/service table — dark header bar + multi-line
// description rows. Matches the reference Estimate layout.
//
// Columns: Product/Service | Description | Qty. | Unit Price | Total
//
// `rows` shape (unified across proposal + invoice surfaces):
//   { id, title, description?, descriptionLines?, qty, rate, amount, unit? }
// `descriptionLines` is rendered one per line — lets the contractor
// stack short specs ("12x14.5 concrete\n5x4 concrete") cleanly. Falls
// back to `description` (single line) when not provided.

import { DOC_COLORS, DOC_FONTS, resolveBrandGold } from './tokens.ts'
import { money } from './format.ts'

export default function LineItemsTable({ rows = [], company, showQty = true }) {
  const brand = resolveBrandGold(company)
  // Dark header bar — uses the brand accent. Default contractors get
  // gold; Parker (brand_accent_hex=#1A1814 example) gets near-black,
  // matching the reference. The brand color reads as a confident
  // identity anchor without overwhelming the document.
  const headerBg = brand

  return (
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontFamily: DOC_FONTS.body,
        fontSize: 13,
        color: DOC_COLORS.ink
      }}
    >
      <thead>
        <tr>
          <Th align="left"  bg={headerBg} style={{ width: '24%' }}>Product/Service</Th>
          <Th align="left"  bg={headerBg} style={{ width: '40%' }}>Description</Th>
          {showQty && <Th align="right" bg={headerBg} style={{ width: '8%' }}>Qty.</Th>}
          <Th align="right" bg={headerBg} style={{ width: '14%' }}>Unit Price</Th>
          <Th align="right" bg={headerBg} style={{ width: '14%' }}>Total</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const qty = Number(r.qty || 1)
          const rate = Number(r.rate || 0)
          const amount = Number(r.amount != null ? r.amount : qty * rate)
          const descLines = r.descriptionLines
            || (r.description ? String(r.description).split(/\n+/).map((s) => s.trim()).filter(Boolean) : [])

          return (
            <tr key={r.id || r.title}>
              <Td>
                <div style={{ fontWeight: 700, color: DOC_COLORS.ink }}>{r.title || '—'}</div>
                {r.subtitle && (
                  <div style={{ marginTop: 4, fontSize: 11, color: DOC_COLORS.inkMuted }}>
                    {r.subtitle}
                  </div>
                )}
              </Td>
              <Td>
                {descLines.length > 0 ? descLines.map((line, i) => (
                  <div key={i} style={{ marginTop: i === 0 ? 0 : 4 }}>
                    {line}
                  </div>
                )) : <span style={{ color: DOC_COLORS.inkFaint }}>—</span>}
              </Td>
              {showQty && (
                <Td align="right" mono>
                  {qty}{r.unit ? ` ${r.unit}` : ''}
                </Td>
              )}
              <Td align="right" mono>{money(rate, { cents: true })}</Td>
              <Td align="right" mono bold>{money(amount, { cents: true })}</Td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Th({ children, align = 'left', bg, style }) {
  return (
    <th
      scope="col"
      style={{
        background: bg,
        color: '#ffffff',
        textAlign: align,
        padding: '11px 14px',
        fontFamily: DOC_FONTS.body,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.02em',
        ...style
      }}
    >
      {children}
    </th>
  )
}

function Td({ children, align = 'left', mono = false, bold = false }) {
  return (
    <td
      style={{
        verticalAlign: 'top',
        padding: '14px',
        borderBottom: `1px solid ${DOC_COLORS.rule}`,
        textAlign: align,
        color: DOC_COLORS.ink,
        fontFamily: DOC_FONTS.body,
        fontSize: 13,
        fontVariantNumeric: mono ? 'tabular-nums' : undefined,
        fontWeight: bold ? 700 : undefined,
        lineHeight: 1.45
      }}
    >
      {children}
    </td>
  )
}
