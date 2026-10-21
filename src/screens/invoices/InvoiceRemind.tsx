// Send a reminder, /invoices/:id/remind (Phase 9, Task 12, decisions D6
// and D57). It sends the invoice email again, with the PDF attached, through
// the same send the invoice's Resend uses. No text messages. Nothing leaves
// the phone until Send reminder is tapped; opening this screen sends
// nothing.
//
// The screen shows who it goes to, which invoice and how much. Without an
// email on the customer, the button stays disabled and a line says why.
// Send reminder is the one gold button here. It shows busy while any
// email of this invoice is going out, from whichever screen started it,
// and once the email is out this screen leaves (back to where it came
// from), so a tap that lands as the email goes out sends nothing.

import { useEffect, useId, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { Button, IconButton, SkeletonRows, formatMoney } from '../../components/fh'
import DataErrorState from '../../components/DataErrorState.tsx'
import { onInvoiceSent } from '../../lib/invoiceSends.ts'
import { goBackFrom, useInvoiceScreen } from './useInvoiceScreen.ts'
import './invoices.css'

export default function InvoiceRemind() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { query, record, figures, sending, send } = useInvoiceScreen(id)
  const helperId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }) }, [])

  const back = () => goBackFrom(navigate, `/invoices/${id}`)

  // Once an email of this invoice has gone out, a reminder or a resend
  // started anywhere, this screen has done its job and leaves.
  const leaving = useRef(false)
  useEffect(() => onInvoiceSent((invoiceId) => {
    if (invoiceId !== id || leaving.current) return
    leaving.current = true
    goBackFrom(navigate, `/invoices/${id}`)
  }), [id, navigate])

  const header = (
    <header className="fhinv-head">
      <IconButton aria-label="Back" icon={ChevronLeft} variant="plain" size={44} onClick={back} />
      <h1 className="fhinv-title" ref={titleRef} tabIndex={-1}>Send a reminder</h1>
    </header>
  )

  if (query.isError) {
    return (
      <div className="v3-screen fhinv">
        {header}
        <div className="fhinv-state">
          <DataErrorState title="Couldn't load this invoice" message="Check your connection and try again." actionLabel="Try again" onRetry={() => void query.refetch()} />
        </div>
      </div>
    )
  }
  if (!record || !figures) {
    return (
      <div className="v3-screen fhinv">
        {header}
        <div className="fhinv-state"><SkeletonRows rows={3} label="Loading invoice" /></div>
      </div>
    )
  }

  const email = figures.to.email
  const canRemind = email !== '' && !figures.settled
  const subline = record.job?.job_title ? `${record.job.job_title}, ${figures.title}` : figures.title

  return (
    <div className="v3-screen fhinv" data-build-screen="InvoiceRemind">
      {header}
      <p className="fhinv-intro">Sends the invoice again by email, with the PDF attached.</p>
      <dl className="fhinv-facts">
        <div className="fhinv-fact">
          <dt>To</dt>
          <dd>{email || 'No email on file'}</dd>
        </div>
        <div className="fhinv-fact">
          <dt>Invoice</dt>
          <dd>
            <span>{figures.to.name || 'Customer'}</span>
            <span className="fhinv-fact__sub">{subline}</span>
          </dd>
        </div>
        <div className="fhinv-fact">
          <dt>Amount</dt>
          <dd className="fhinv-fact__amount">{formatMoney(figures.due)}</dd>
        </div>
      </dl>
      <div className="fhinv-actions">
        {!canRemind && (
          <p className="fhinv-helper" id={helperId}>
            {figures.settled ? 'This invoice is settled, so there is nothing to remind about.' : 'Add an email to send reminders.'}
          </p>
        )}
        <Button
          variant="primary"
          size="lg"
          block
          disabled={!canRemind}
          loading={sending}
          aria-describedby={canRemind ? undefined : helperId}
          onClick={() => { if (!leaving.current) void send({ reminder: true }) }}
        >
          Send reminder
        </Button>
        {!canRemind && figures.recordHref && (
          <Button variant="quiet" size="md" block to={figures.recordHref}>{figures.recordLabel}</Button>
        )}
      </div>
    </div>
  )
}
