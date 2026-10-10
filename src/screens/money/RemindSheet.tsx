import { useId } from 'react'
import { Button, Sheet, formatMoney } from '../../components/fh'
import type { MoneyRow } from '../../lib/moneyView.ts'

// "Remind" on an overdue invoice (decision D6): it sends the invoice email
// again, with the PDF attached, through the same sendInvoiceEmail the
// invoice's Resend uses. No text messages. Nothing leaves the phone until
// "Send reminder" is tapped; opening this sheet sends nothing.
//
// The sheet shows who it goes to, which invoice and how much. Without an
// email on the customer, the button stays disabled and the helper says why.
// This is the one brushed gold action on the Money screen.

export type RemindSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The overdue row being chased; kept while the sheet closes. */
  row: MoneyRow | null
  /** The customer's email, or empty when there is none. */
  email: string
  sending: boolean
  onSend: () => void
}

export default function RemindSheet({ open, onOpenChange, row, email, sending, onSend }: RemindSheetProps) {
  const helperId = useId()
  const canRemind = Boolean(row?.canRemind) && email !== ''

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Send a reminder"
      description="Sends the invoice again by email, with the PDF attached."
      footer={
        <Button
          variant="primary"
          size="lg"
          block
          disabled={!canRemind}
          loading={sending}
          aria-describedby={canRemind ? undefined : helperId}
          onClick={onSend}
        >
          Send reminder
        </Button>
      }
    >
      {row && (
        <div className="fhm-remind">
          <dl className="fhm-remind__facts">
            <div className="fhm-remind__fact">
              <dt>To</dt>
              <dd>{email || 'No email on file'}</dd>
            </div>
            <div className="fhm-remind__fact">
              <dt>Invoice</dt>
              <dd>
                <span className="fhm-remind__who">{row.title}</span>
                {row.subline && <span className="fhm-remind__sub">{row.subline}</span>}
              </dd>
            </div>
            <div className="fhm-remind__fact">
              <dt>Amount</dt>
              <dd className="fhm-remind__amount">{formatMoney(row.amount)}</dd>
            </div>
          </dl>
          {!canRemind && (
            <div className="fhm-remind__help">
              <p className="fhm-helper" id={helperId}>Add an email to send reminders.</p>
              <Button variant="quiet" size="mini" to={row.to}>Open job</Button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}
