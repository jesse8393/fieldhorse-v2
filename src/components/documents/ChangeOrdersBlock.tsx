// src/components/documents/ChangeOrdersBlock.tsx
//
// Renders the list of change orders on a proposal or invoice document.
// Each row stamps CO # · title · description · amount, with an
// approved-on date when the contractor captured one.
//
// Auto-hides when the changeOrders array is empty so cash jobs with no
// amendments don't get a vestigial section header.
//
// Schema: fh_change_orders (migration 019). Approved COs bump the
// contract total used by InvoiceBalanceBlock; the parent template
// composes that math.

import { DOC_COLORS, typeStyle, resolveBrandGold } from './tokens.ts'
import { money, shortDate } from './format.ts'

export default function ChangeOrdersBlock({ changeOrders = [], company }: { changeOrders?: any[]; company?: any }) {
  const gold = resolveBrandGold(company)
  const items = (changeOrders || []).filter((co) => co?.status !== 'void')
  if (items.length === 0) return null

  return (
    <ul
      style={{
        listStyle: 'none',
        padding: 0,
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        border: `1px solid ${DOC_COLORS.rule}`,
        borderRadius: 6,
        overflow: 'hidden'
      }}
    >
      {items.map((co, i) => {
        const amt = Number(co.amount || 0)
        const isCredit = amt < 0
        return (
          <li
            key={co.id || i}
            style={{
              display: 'grid',
              gridTemplateColumns: '70px 1fr auto',
              gap: 16,
              alignItems: 'flex-start',
              padding: '14px 18px',
              borderTop: i > 0 ? `1px solid ${DOC_COLORS.rule}` : 'none',
              background: DOC_COLORS.paper
            }}
          >
            <div
              style={{
                ...typeStyle('stamp'),
                color: gold,
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '0.04em'
              }}
            >
              CO #{co.sequence_number || (i + 1)}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ ...typeStyle('bodyBold'), color: DOC_COLORS.ink }}>
                {co.title || 'Change order'}
                {co.status === 'draft' && (
                  <span
                    style={{
                      ...typeStyle('label'),
                      color: DOC_COLORS.inkFaint,
                      marginLeft: 8
                    }}
                  >
                    DRAFT
                  </span>
                )}
                {co.status === 'approved' && co.approved_at && (
                  <span
                    style={{
                      ...typeStyle('label'),
                      color: DOC_COLORS.signalGreen,
                      marginLeft: 8
                    }}
                  >
                    APPROVED · {shortDate(co.approved_at)}
                  </span>
                )}
              </div>
              {co.description && (
                <div
                  style={{
                    ...typeStyle('sub'),
                    color: DOC_COLORS.inkMuted,
                    marginTop: 3,
                    whiteSpace: 'pre-wrap'
                  }}
                >
                  {co.description}
                </div>
              )}
            </div>
            <div
              style={{
                ...typeStyle('stamp'),
                color: isCredit ? DOC_COLORS.signalGreen : DOC_COLORS.ink,
                whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums'
              }}
            >
              {isCredit ? `−${money(Math.abs(amt))}` : `+${money(amt)}`}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
