// src/components/documents/PaymentHistoryBlock.jsx
//
// Reverse-chronological list of payments applied to a job. Surfaces
// on the invoice template under "Payment history" so the customer can
// see exactly what they've already paid, when, and via what method.
//
// Empty state suppressed by the parent — render the block only when
// payments.length > 0.

import { DOC_COLORS, typeStyle } from './tokens.js'
import { money, shortDate } from './format.js'

function methodLabel(m) {
  if (!m) return 'Payment'
  const lower = String(m).toLowerCase()
  if (lower === 'ach') return 'ACH'
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

export default function PaymentHistoryBlock({ payments = [] }) {
  if (!payments?.length) return null

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
      {payments.map((p, i) => (
        <li
          key={p.id || i}
          style={{
            display: 'grid',
            gridTemplateColumns: '110px 1fr auto',
            gap: 16,
            alignItems: 'center',
            padding: '12px 18px',
            borderTop: i > 0 ? `1px solid ${DOC_COLORS.rule}` : 'none',
            background: DOC_COLORS.paper
          }}
        >
          <div
            style={{
              ...typeStyle('stamp'),
              color: DOC_COLORS.inkMuted,
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {shortDate(p.paid_on || p.created_at)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...typeStyle('bodyBold'), color: DOC_COLORS.ink }}>
              {methodLabel(p.method)}
              {p.reference && (
                <span
                  style={{
                    ...typeStyle('sub'),
                    color: DOC_COLORS.inkMuted,
                    marginLeft: 8,
                    fontWeight: 400
                  }}
                >
                  · {p.reference}
                </span>
              )}
            </div>
            {p.note && (
              <div style={{ ...typeStyle('sub'), color: DOC_COLORS.inkMuted, marginTop: 2 }}>
                {p.note}
              </div>
            )}
          </div>
          <div
            style={{
              ...typeStyle('stamp'),
              color: DOC_COLORS.signalGreen,
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {money(Number(p.amount || 0), { cents: true })}
          </div>
        </li>
      ))}
    </ul>
  )
}
