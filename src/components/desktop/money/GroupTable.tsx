// One Money group on a desktop as a table (spec 9.7, plan task 4.6): a
// title with its note, then rows with the columns Customer, Job, Amount,
// Status and Action. The same four groups and the same rows as the phone
// (lib/moneyView.ts), so the numbers cannot differ.
//
// A click anywhere on a row does what the row's Open button does: an
// invoice opens its actions sheet, a quote or a payment opens its job.
// Overdue rows carry Remind in the Action column (decision D6); it opens
// the Remind sheet and sends nothing until Send reminder is pressed there.
// The Action buttons are the keyboard way in. On an overdue row the
// customer name is a button too, because Remind is the only control the
// column holds there.

import type { MouseEvent } from 'react'
import { Button, Chip, formatMoney } from '../../fh'
import type { MoneyRow } from '../../../lib/moneyView.ts'

export type GroupTableProps = {
  id: string
  title: string
  /** The gray line beside the title: a count, a total, "Last 10 days". */
  note: string
  rows: MoneyRow[]
  /** An invoice row opens the invoice's actions. */
  onOpenInvoice: (invoiceId: string) => void
  /** A quote or payment row opens its job. */
  onOpenJob: (to: string) => void
  /** Present on the Overdue group only. */
  onRemind?: (row: MoneyRow) => void
}

// Clicks on the row's own controls do their own thing.
function fromControl(e: MouseEvent): boolean {
  return (e.target as HTMLElement).closest('button, a') !== null
}

export default function GroupTable({ id, title, note, rows, onOpenInvoice, onOpenJob, onRemind }: GroupTableProps) {
  const headingId = `fhmd-group-${id}`

  return (
    <section className="fhmd-group" aria-labelledby={headingId}>
      <div className="fhmd-group__head">
        <h2 className="fhmd-group__title" id={headingId}>{title}</h2>
        <p className="fhmd-group__note">{note}</p>
      </div>
      <table className="fhmd-table" aria-labelledby={headingId}>
        <colgroup>
          <col className="fhmd-col--customer" />
          <col className="fhmd-col--job" />
          <col className="fhmd-col--amount" />
          <col className="fhmd-col--status" />
          <col className="fhmd-col--action" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Customer</th>
            <th scope="col">Job</th>
            <th scope="col" className="fhmd-num">Amount</th>
            <th scope="col">Status</th>
            <th scope="col" className="fhmd-end">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const invoiceId = r.invoiceId
            const open = () => (invoiceId ? onOpenInvoice(invoiceId) : onOpenJob(r.to))
            const label = r.subline ? `${r.title}, ${r.subline}` : r.title
            return (
              <tr
                key={r.id}
                className="fhmd-row is-click"
                onClick={(e) => { if (!fromControl(e)) open() }}
              >
                <td className="fhmd-cell--customer">
                  {onRemind && invoiceId ? (
                    <button type="button" className="fhmd-name" onClick={open}>{r.title}</button>
                  ) : (
                    <span className="fhmd-name">{r.title}</span>
                  )}
                </td>
                <td className="fhmd-cell--job">{r.subline}</td>
                <td className="fhmd-num fhmd-cell--amount">{formatMoney(r.amount)}</td>
                <td>
                  <div className="fhmd-status">
                    {r.chip && <Chip label={r.chip.label} tone={r.chip.tone} />}
                    {r.note && <span className={r.chip ? 'fhmd-status__sub' : 'fhmd-status__main'}>{r.note}</span>}
                  </div>
                </td>
                <td className="fhmd-end">
                  {onRemind && invoiceId ? (
                    <Button
                      variant="secondary"
                      size="mini"
                      aria-label={`Remind ${r.title}`}
                      onClick={() => onRemind(r)}
                    >
                      Remind
                    </Button>
                  ) : invoiceId ? (
                    <Button variant="quiet" size="mini" aria-label={`Open ${label}`} onClick={open}>Open</Button>
                  ) : (
                    <Button variant="quiet" size="mini" to={r.to} aria-label={`Open ${label}`}>Open</Button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
