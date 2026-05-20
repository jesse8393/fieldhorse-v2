// src/components/documents/PricingSummaryCard.tsx
//
// "Pricing Summary" card used on proposal preview. Spec-driven layout:
//   - Base scope total
//   - Upgrade total      (sum of fh_quote_items where is_optional=true)
//   - Discounts          (negative; suppressed when 0)
//   - Tax                (suppressed when 0)
//   - Project Investment hero — large, premium, brand-accent gold
//
// "Project Investment" is the headline; the other rows are subordinated
// stamps under a hairline. The contractor sees ONE number that matters.

import { DOC_COLORS, DOC_FONTS, typeStyle, resolveBrandGold } from './tokens.ts'
import { money } from './format.ts'

/**
 * @param {object} props
 * @param {number} props.baseTotal      sum of non-optional, non-excluded items
 * @param {number} [props.upgradeTotal] sum of optional items (displayed when > 0)
 * @param {number} [props.discount]     positive number; rendered as a negative row
 * @param {number} [props.taxRate]      decimal (e.g. 0.0725)
 * @param {object} [props.company]      for brand accent resolution
 * @param {string} [props.heroLabel]    overrides "Project investment" copy
 */
export default function PricingSummaryCard({
  baseTotal = 0,
  upgradeTotal = 0,
  discount = 0,
  taxRate = 0,
  company,
  heroLabel = 'Project investment'
}: any) {
  const gold = resolveBrandGold(company)
  const base = Number(baseTotal || 0)
  const upgrade = Number(upgradeTotal || 0)
  const disc = Math.max(0, Number(discount || 0))
  const preTax = Math.max(0, base + upgrade - disc)
  const tax = preTax * Number(taxRate || 0)
  const total = preTax + tax

  const rows = [
    { label: 'Base scope', value: money(base) },
    upgrade > 0 ? { label: 'Selected upgrades', value: money(upgrade) } : null,
    disc > 0    ? { label: 'Discount', value: `−${money(disc)}`, muted: true } : null,
    taxRate > 0 ? { label: `Tax · ${(taxRate * 100).toFixed(2)}%`, value: money(tax) } : null
  ].filter(Boolean) as Array<{ label: string; value: string; muted?: boolean }>

  return (
    <section
      style={{
        padding: '24px 26px',
        background: DOC_COLORS.paperSoft,
        border: `1px solid ${DOC_COLORS.ruleStrong}`,
        borderRadius: 6,
        breakInside: 'avoid'
      }}
    >
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {rows.map((r, i) => (
          <li
            key={r.label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              padding: '8px 0',
              borderTop: i > 0 ? `1px solid ${DOC_COLORS.rule}` : 'none'
            }}
          >
            <span style={{ ...typeStyle('body'), color: DOC_COLORS.inkMuted }}>
              {r.label}
            </span>
            <span
              style={{
                ...typeStyle('stamp'),
                color: r.muted ? DOC_COLORS.inkMuted : DOC_COLORS.ink
              }}
            >
              {r.value}
            </span>
          </li>
        ))}
      </ul>

      <div
        style={{
          marginTop: 16,
          paddingTop: 18,
          borderTop: `1px solid ${DOC_COLORS.ruleStrong}`,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap'
        }}
      >
        <div>
          <div style={{ ...typeStyle('label'), color: DOC_COLORS.inkMuted, marginBottom: 6 }}>
            {heroLabel.toUpperCase()}
          </div>
          <div
            style={{
              ...typeStyle('hero'),
              color: gold,
              fontFamily: DOC_FONTS.serif,
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {money(total)}
          </div>
        </div>
        <div
          style={{
            ...typeStyle('sub'),
            color: DOC_COLORS.inkMuted,
            textAlign: 'right',
            maxWidth: 260
          }}
        >
          USD · all materials, labor, project coordination, and cleanup included unless noted under Exclusions.
        </div>
      </div>
    </section>
  )
}
