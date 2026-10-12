import { useId } from 'react'
import { DollarSign, FileDown, Send } from 'lucide-react'
import { Button, Chip, Sheet, formatMoney } from '../../components/fh'
import type { MoneyInvoiceRow } from '../../lib/moneyView.ts'
import { parseDateOnly } from '../../lib/dates.ts'
import type { IssuedInvoiceRow } from './types.ts'

// What a tap on an invoice row opens: the invoice's actions, the same four
// the old Money screen carried on every invoice card. Resend (Send on a
// draft), PDF, Mark paid and Void, with a link to the job. A paid or void
// invoice keeps only the link. Every button is secondary: the Money screen
// has no gold action of its own, and Void sits apart as the destructive one.
//
// Mark paid, PDF and Void close the sheet and hand over to the payment
// sheet, the download or the confirmation. Resend stays open while it
// sends and closes when the email has gone out.
//
// While an email of this invoice is going out (`sending`, a resend or a
// reminder), Mark paid and Void wait, and a line above the buttons says
// why: the email landing marks the invoice sent, and a payment or a void
// recorded meanwhile would read as sent again (review of Phase 8, task 6).
// The sheet sits on the bottom edge, so a line above the buttons grows it
// upward and leaves every button where the finger is.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function sentLine(issuedAt: string | null | undefined): string {
  const d = parseDateOnly(issuedAt)
  return d ? `sent ${MONTHS[d.getMonth()]} ${d.getDate()}` : ''
}

export type InvoiceSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The invoice being acted on; kept while the sheet closes. */
  issued: IssuedInvoiceRow | null
  row: MoneyInvoiceRow | null
  sending: boolean
  onResend: () => void
  onPdf: () => void
  onMarkPaid: () => void
  onVoid: () => void
}

export default function InvoiceSheet({
  open,
  onOpenChange,
  issued,
  row,
  sending,
  onResend,
  onPdf,
  onMarkPaid,
  onVoid
}: InvoiceSheetProps) {
  const waitId = useId()
  const invoice = issued?.invoice
  const title = (invoice?.title || '').trim() || (invoice ? `Invoice #${invoice.sequence_number}` : 'Invoice')
  const settled = row?.status === 'paid' || row?.status === 'void'
  const isDraft = row?.status === 'draft'
  const dates = [row?.note, sentLine(invoice?.issued_at) && row?.status !== 'draft' ? sentLine(invoice?.issued_at) : '']
    .filter(Boolean)
    .join(', ')

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
      {row && issued && (
        <div className="fhm-inv">
          <div className="fhm-inv__summary">
            <p className="fhm-inv__who">{row.title}</p>
            {row.subline && <p className="fhm-inv__sub">{row.subline}</p>}
            <p className="fhm-inv__amount">{formatMoney(row.amount)}</p>
            <div className="fhm-inv__status">
              {row.chip && <Chip label={row.chip.label} tone={row.chip.tone} />}
              {dates && <span className="fhm-inv__dates">{dates.charAt(0).toUpperCase() + dates.slice(1)}</span>}
            </div>
          </div>

          <div className="fhm-inv__actions">
            {/* Above the buttons, so none of them moves when it comes and goes. */}
            {!settled && sending && (
              <p className="fhm-helper" id={waitId}>Mark paid and Void are paused while the email goes out.</p>
            )}
            {!settled && (
              <>
                <Button variant="secondary" size="md" block icon={Send} loading={sending} onClick={onResend}>
                  {isDraft ? 'Send' : 'Resend'}
                </Button>
                <Button variant="secondary" size="md" block icon={FileDown} onClick={onPdf}>PDF</Button>
                <Button
                  variant="secondary"
                  size="md"
                  block
                  icon={DollarSign}
                  disabled={sending}
                  aria-describedby={sending ? waitId : undefined}
                  onClick={onMarkPaid}
                >
                  Mark paid
                </Button>
              </>
            )}
            <Button variant="quiet" size="md" block to={row.to}>Open job</Button>
            {!settled && (
              <Button
                variant="destructive"
                size="md"
                block
                disabled={sending}
                aria-describedby={sending ? waitId : undefined}
                onClick={onVoid}
              >
                Void
              </Button>
            )}
          </div>
        </div>
      )}
    </Sheet>
  )
}
