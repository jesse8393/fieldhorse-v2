import type { ReactNode } from 'react'
import { formatMoney } from './money.ts'
import { cx } from './cx.ts'

// The vault card (spec 7, 9.7 and 9.11): an onyx card, radius 22, inside
// a paper tray, with the raised shadow. A label, the big number in
// Barlow Condensed 52/54, a gold hairline, then fact rows. Numbers are
// money and always print cents; pass a string for anything else
// ("27.4%"). An optional corner slot holds the company monogram.
//
// Facts lay out in columns (Money on a phone: Due this week, October so
// far, Margin) or in label and value rows (the desktop facts panel).

export type VaultFact = {
  label: ReactNode
  /** A number is money with cents. A string prints as given. */
  value: number | string
}

export type VaultCardProps = {
  label: ReactNode
  /** The big number. A number is money with cents. */
  amount: number | string
  facts?: VaultFact[]
  factsLayout?: 'columns' | 'rows'
  /** Top right corner, such as the company Monogram. */
  corner?: ReactNode
  as?: 'section' | 'div'
  'aria-label'?: string
  className?: string
}

function show(value: number | string): string {
  return typeof value === 'number' ? formatMoney(value) : value
}

export default function VaultCard({
  label,
  amount,
  facts,
  factsLayout = 'columns',
  corner,
  as: Tag = 'section',
  'aria-label': ariaLabel,
  className
}: VaultCardProps) {
  return (
    <Tag className={cx('fhc-vault', className)} aria-label={ariaLabel}>
      <div className="fhc-vault__card fh-onyx-scope fh-grain">
        <div className="fhc-vault__head">
          <p className="fhc-vault__label">{label}</p>
          {corner != null && <div className="fhc-vault__corner">{corner}</div>}
        </div>
        <p className="fhc-vault__amount">{show(amount)}</p>
        {facts && facts.length > 0 && (
          <>
            <span className="fhc-vault__rule" aria-hidden="true" />
            <dl className={cx('fhc-vault__facts', `fhc-vault__facts--${factsLayout}`)}>
              {facts.map((fact, i) => (
                <div key={i} className="fhc-vault__fact">
                  <dt>{fact.label}</dt>
                  <dd>{show(fact.value)}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </Tag>
  )
}
