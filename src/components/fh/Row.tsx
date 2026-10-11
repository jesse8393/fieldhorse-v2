import type { MouseEventHandler, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { To } from 'react-router-dom'
import type { ChipTone } from './Chip.tsx'
import { formatMoney } from './money.ts'
import { cx } from './cx.ts'

// Hairline list row (spec section 7): who and what on the left, money and
// what happens next on the right. 64 px minimum. The whole row is one
// link (`to`) or one button (`onClick`); an optional trailing `action`
// (a mini Button such as Remind) sits beside it, never inside it, so
// there is no control nested in a control. Rows that sit next to each
// other get a hairline between them, never after the last one.

export type RowOwnProps = {
  title: ReactNode
  subline?: ReactNode
  /** A number is money and always prints cents. A string prints as given. */
  money?: number | string | null
  /** A Chip, or a short gray line such as "Sent yesterday". */
  next?: ReactNode
  /** Leading status dot. The title carries the meaning. */
  dot?: ChipTone
  /** One trailing control, such as a mini "Remind" Button. */
  action?: ReactNode
  /** Render as a list item inside a <ul> or <ol>. */
  as?: 'div' | 'li'
  className?: string
}

export type RowLinkProps = RowOwnProps & {
  to: To
  onClick?: MouseEventHandler<HTMLAnchorElement>
  replace?: boolean
  state?: unknown
  'aria-label'?: string
}
export type RowButtonProps = RowOwnProps & {
  to?: undefined
  onClick: MouseEventHandler<HTMLButtonElement>
  disabled?: boolean
  'aria-label'?: string
}
export type RowStaticProps = RowOwnProps & { to?: undefined; onClick?: undefined }

export type RowProps = RowLinkProps | RowButtonProps | RowStaticProps

export default function Row(props: RowProps) {
  const { title, subline, money, next, dot, action, as: Tag = 'div', className } = props
  const amount = typeof money === 'number' ? formatMoney(money) : money

  const body = (
    <>
      {dot && <span className={cx('fhc-row__dot', `fhc-row__dot--${dot}`)} aria-hidden="true" />}
      <span className="fhc-row__body">
        <span className="fhc-row__title">{title}</span>
        {subline != null && subline !== false && <span className="fhc-row__sub">{subline}</span>}
      </span>
      {(amount != null || (next != null && next !== false)) && (
        <span className="fhc-row__end">
          {amount != null && amount !== '' && <span className="fhc-row__money">{amount}</span>}
          {next != null && next !== false && (
            typeof next === 'string' || typeof next === 'number'
              ? <span className="fhc-row__next">{next}</span>
              : next
          )}
        </span>
      )}
    </>
  )

  let main: ReactNode
  if (props.to !== undefined) {
    main = (
      <Link
        className="fhc-row__main is-interactive"
        to={props.to}
        onClick={props.onClick}
        replace={props.replace}
        state={props.state}
        aria-label={props['aria-label']}
      >
        {body}
      </Link>
    )
  } else if (props.onClick) {
    const { onClick, disabled } = props as RowButtonProps
    main = (
      <button
        type="button"
        className="fhc-row__main is-interactive"
        onClick={onClick}
        disabled={disabled}
        aria-label={(props as RowButtonProps)['aria-label']}
      >
        {body}
      </button>
    )
  } else {
    main = <div className="fhc-row__main">{body}</div>
  }

  return (
    <Tag className={cx('fhc-row', action != null && 'has-action', className)}>
      {main}
      {action != null && <div className="fhc-row__action">{action}</div>}
    </Tag>
  )
}
