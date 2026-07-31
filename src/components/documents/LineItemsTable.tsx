// src/components/documents/LineItemsTable.tsx
//
// Shared items table for customer documents. Editorial treatment:
// small-caps column labels over a strong hairline, per-row hairlines,
// right-aligned tabular-number money, no colored header bars.
//
// Three layouts:
//
//   'grouped'  , the proposal workhorse. `groups` prop:
//                 [{ title, items: [{description, qty, unit, rate, amount}], subtotal }]
//                 Section name rows break up the itemized rows; each
//                 section closes with a right-aligned subtotal.
//   'detailed' , flat rows with Description | Qty | Rate | Amount.
//   'sectioned', legacy roll-up (one lump-sum row per section) kept
//                 for callers that still pass pre-rolled rows.
//
// `rows` shape (detailed/sectioned):
//   { id, title, description?, descriptionLines?, qty, rate, amount, unit? }

import { DOC_COLORS, DOC_FONTS } from './tokens.ts'
import { money } from './format.ts'

export default function LineItemsTable({
  rows = [],
  groups = [],
  company,
  showQty = true,
  layout = 'detailed',
  amountHeading = 'Amount'
}: {
  rows?: any[]
  groups?: any[]
  company?: any
  showQty?: boolean
  layout?: 'detailed' | 'sectioned' | 'grouped'
  amountHeading?: string
}) {
  if (layout === 'grouped') {
    return (
      <table style={tableStyle()}>
        <thead>
          <HeadRow showQty={showQty} amountHeading={amountHeading} />
        </thead>
        <tbody>
          {groups.map((g: any, gi: number) => {
            const items = g.items || []
            const subtotal = g.subtotal != null
              ? Number(g.subtotal)
              : items.reduce((s: number, it: any) => s + itemAmount(it), 0)
            return [
              <tr key={`g-${gi}`}>
                <td
                  colSpan={showQty ? 4 : 2}
                  style={{
                    paddingTop: gi === 0 ? 14 : 22,
                    paddingBottom: 8,
                    fontFamily: DOC_FONTS.body,
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: 0,
                    textTransform: 'uppercase',
                    color: DOC_COLORS.inkMuted
                  }}
                >
                  {g.title || 'General'}
                </td>
              </tr>,
              ...items.map((it: any, i: number) => (
                <ItemRow key={`g-${gi}-i-${i}`} item={it} showQty={showQty} />
              )),
              items.length > 1 && (
                <tr key={`g-${gi}-sub`}>
                  <td colSpan={showQty ? 3 : 1} style={{ padding: '8px 12px 8px 0', textAlign: 'right', fontSize: 12, color: DOC_COLORS.inkFaint }}>
                    {g.title} subtotal
                  </td>
                  <td style={{ padding: '8px 0', textAlign: 'right', fontSize: 12, fontWeight: 600, color: DOC_COLORS.inkMuted, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {money(subtotal, { cents: true })}
                  </td>
                </tr>
              )
            ]
          })}
        </tbody>
      </table>
    )
  }

  if (layout === 'sectioned') {
    return (
      <table style={tableStyle()}>
        <thead>
          <tr>
            <Th style={{ width: '30%' }}>Scope of work</Th>
            <Th style={{ width: '52%' }}>Description</Th>
            <Th align="right" style={{ width: '18%' }}>{amountHeading}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const descLines = r.descriptionLines
              || (r.description ? String(r.description).split(/\n+/).map((s) => s.trim()).filter(Boolean) : [])
            const amount = Number(r.amount != null ? r.amount : Number(r.qty || 1) * Number(r.rate || 0))
            return (
              <tr key={r.id || r.title}>
                <Td><span style={{ fontWeight: 700, color: DOC_COLORS.ink }}>{r.title || '\u2003'}</span></Td>
                <Td>
                  {descLines.length > 0 ? descLines.map((line: string, i: number) => (
                    <div key={i} style={{ marginTop: i === 0 ? 0 : 5, color: DOC_COLORS.inkMid }}>
                      {line}
                    </div>
                  )) : <span style={{ color: DOC_COLORS.inkFaint }}>:</span>}
                </Td>
                <Td align="right" mono bold>{money(amount, { cents: true })}</Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  // 'detailed', flat itemized rows.
  return (
    <table style={tableStyle()}>
      <thead>
        <HeadRow showQty={showQty} amountHeading={amountHeading} />
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <ItemRow
            key={r.id || i}
            item={{
              description: r.title || r.description || '\u2003',
              detailLines: r.descriptionLines
                || (r.description && r.title ? String(r.description).split(/\n+/).map((s: string) => s.trim()).filter(Boolean) : []),
              qty: r.qty,
              unit: r.unit,
              rate: r.rate,
              amount: r.amount
            }}
            showQty={showQty}
          />
        ))}
      </tbody>
    </table>
  )
}

/* ─── Shared row/cell pieces ─── */

function tableStyle() {
  return {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontFamily: DOC_FONTS.body,
    fontSize: 14,
    color: DOC_COLORS.ink
  }
}

function itemAmount(it: any) {
  return Number(it.amount != null ? it.amount : Number(it.qty || 1) * Number(it.rate || 0))
}

function HeadRow({ showQty, amountHeading }: any) {
  return (
    <tr>
      <Th style={{ width: showQty ? '58%' : '80%' }}>Description</Th>
      {showQty && <Th align="right" style={{ width: '12%' }}>Qty</Th>}
      {showQty && <Th align="right" style={{ width: '14%' }}>Rate</Th>}
      <Th align="right" style={{ width: showQty ? '16%' : '20%' }}>{amountHeading}</Th>
    </tr>
  )
}

function ItemRow({ item, showQty }: any) {
  const qty = Number(item.qty || 1)
  const unit = (item.unit || '').trim()
  const rate = Number(item.rate || 0)
  const amount = itemAmount(item)
  const detailLines = item.detailLines || []
  return (
    <tr>
      <Td>
        <span style={{ color: DOC_COLORS.ink }}>{item.description || '\u2003'}</span>
        {detailLines.map((line: string, i: number) => (
          <div key={i} style={{ marginTop: 3, fontSize: 12, color: DOC_COLORS.inkMuted }}>
            {line}
          </div>
        ))}
      </Td>
      {showQty && (
        <Td align="right" mono muted>
          {qty}{unit ? ` ${unit}` : ''}
        </Td>
      )}
      {showQty && (
        <Td align="right" mono muted>{money(rate, { cents: true })}</Td>
      )}
      <Td align="right" mono bold>{money(amount, { cents: true })}</Td>
    </tr>
  )
}

function Th({ children, align = 'left', style }: { children?: import('react').ReactNode; align?: any; style?: import('react').CSSProperties }) {
  return (
    <th
      scope="col"
      style={{
        textAlign: align,
        padding: align === 'left' ? '0 12px 8px 0' : '0 0 8px 12px',
        borderBottom: `2px solid ${DOC_COLORS.ink}`,
        fontFamily: DOC_FONTS.body,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0,
        textTransform: 'uppercase',
        color: DOC_COLORS.inkMuted,
        ...style
      }}
    >
      {children}
    </th>
  )
}

function Td({ children, align = 'left', mono = false, bold = false, muted = false }: { children?: import('react').ReactNode; align?: any; mono?: boolean; bold?: boolean; muted?: boolean }) {
  return (
    <td
      style={{
        verticalAlign: 'top',
        padding: align === 'left' ? '12px 12px 12px 0' : '12px 0 12px 12px',
        borderBottom: `1px solid ${DOC_COLORS.rule}`,
        textAlign: align,
        color: muted ? DOC_COLORS.inkMuted : DOC_COLORS.ink,
        fontFamily: DOC_FONTS.body,
        fontSize: 14,
        fontVariantNumeric: mono ? 'tabular-nums' : undefined,
        fontWeight: bold ? 700 : undefined,
        lineHeight: 1.45,
        whiteSpace: mono ? 'nowrap' : undefined
      }}
    >
      {children}
    </td>
  )
}
