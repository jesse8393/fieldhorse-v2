// src/components/documents/PaymentTermsBlock.tsx
//
// Renders the payment schedule on a proposal.
//
// Defaults to the contractor-standard 50 / 40 / 10 schedule:
//   50% Deposit Due Upon Approval
//   40% Due At Material Delivery or Midpoint
//   10% Due Upon Substantial Completion
//
// Per-document overrides come through the `schedule` prop, pass an
// array of { pct, label, sub? } and the block renders that instead.
// Each row stamps the percent + dollar amount derived from `total`,
// so the customer sees real money next to each milestone rather than
// having to math it out themselves.

import { DOC_COLORS, typeStyle, resolveBrandGold } from './tokens.ts'
import { money } from './format.ts'

export const DEFAULT_PAYMENT_SCHEDULE = [
  { pct: 50, label: 'Deposit due upon approval',         sub: 'Before crew mobilizes' },
  { pct: 40, label: 'Due at material delivery / midpoint', sub: 'Materials staged on site' },
  { pct: 10, label: 'Due upon substantial completion',    sub: 'After punch list approval' }
]

export default function PaymentTermsBlock({
  total = 0,
  schedule = DEFAULT_PAYMENT_SCHEDULE,
  company
}: { total?: number; schedule?: any[]; company?: any }) {
  const gold = resolveBrandGold(company)
  const grand = Number(total || 0)

  return (
    <ul
      style={{
        listStyle: 'none',
        padding: 0,
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        border: `1px solid ${DOC_COLORS.rule}`,
        borderRadius: 10,
        overflow: 'hidden'
      }}
    >
      {schedule.map((row, i) => {
        const pct = Number(row.pct || 0)
        const amt = Math.round(grand * (pct / 100))
        return (
          <li
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '64px 1fr auto',
              gap: 16,
              alignItems: 'center',
              padding: '12px 16px',
              borderTop: i > 0 ? `1px solid ${DOC_COLORS.rule}` : 'none',
              background: DOC_COLORS.paper
            }}
          >
            <div
              style={{
                ...typeStyle('stamp'),
                color: gold,
                fontSize: 20,
                letterSpacing: 0
              }}
            >
              {pct}%
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ ...typeStyle('bodyBold'), color: DOC_COLORS.ink }}>
                {row.label}
              </div>
              {row.sub && (
                <div style={{ ...typeStyle('sub'), color: DOC_COLORS.inkMuted, marginTop: 2 }}>
                  {row.sub}
                </div>
              )}
            </div>
            <div
              style={{
                ...typeStyle('stamp'),
                color: DOC_COLORS.ink,
                whiteSpace: 'nowrap'
              }}
            >
              {money(amt)}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
