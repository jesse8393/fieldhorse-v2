import { invoiceReference } from '../../lib/invoiceReference.ts'
// The invoice screen, /invoices/:id, where :id is an fh_invoices row (Phase
// 9, Task 12, decisions D57 and D62). One invoice: who it bills (a job, or
// a client with no job), what it still owes, its description, its actions
// and the payments on it. Every action is a button or a link on this
// screen; nothing opens a sheet. Collect payment, Remind and Edit are
// screens of their own under this route.
//
// Collect payment is the one gold button. Send (Resend once it has gone
// out) emails the invoice with its PDF; Remind sends the same email again
// from its own screen (decision D6); PDF downloads it; Share link mints a
// customer link. Void confirms with a second tap on the same button within
// 4 seconds (D57). While an email of this invoice is going out, Collect
// payment and Void wait, and a line above the buttons says why: the email
// landing marks the invoice sent, so a payment or a void recorded meanwhile
// would read as sent again (review of Phase 8, task 6). The line sits under
// the buttons so none of them moves when it comes and goes.
//
// The Description field edits in place: it saves when it loses focus and
// prints in the PDF Description column and the email (D62).

import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BellRing, ChevronLeft, DollarSign, FileDown, Link as LinkIcon, Send } from 'lucide-react'
import { Button, Chip, Field, IconButton, Row, SkeletonRows, formatMoney } from '../../components/fh'
import type { ChipTone } from '../../components/fh'
import DataErrorState from '../../components/DataErrorState.tsx'
import InvoiceBillingReview from '../../components/InvoiceBillingReview.tsx'
import { buildInvoicePdf, setInvoiceStatus } from '../../lib/invoices.ts'
import { mintPublicLink } from '../../lib/publicLink.ts'
import { supabase } from '../../lib/supabase.ts'
import { hapticTap } from '../../lib/haptics.ts'
import { toastError, toastSuccess } from '../../lib/toast.ts'
import { parseDateOnly } from '../../lib/dates.ts'
import { goBackFrom, shortDate, useInvoiceScreen } from './useInvoiceScreen.ts'
import './invoices.css'

// pdf.js pulls in jspdf. Load it on the first PDF tap only.
const loadPdf = () => import('../../lib/pdf.js')

const VOID_ARMED_MS = 4000

function methodLabel(m: string | null | undefined): string {
  const lower = String(m || '').toLowerCase()
  if (!lower) return 'Payment'
  if (lower === 'ach') return 'ACH'
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function statusChip(standing: { status: string; daysLate: number }): { label: string; tone: ChipTone } {
  switch (standing.status) {
    case 'overdue': return { label: `${standing.daysLate} ${standing.daysLate === 1 ? 'day' : 'days'} overdue`, tone: 'danger' }
    case 'sent': return { label: 'Sent', tone: 'neutral' }
    case 'paid': return { label: 'Paid', tone: 'success' }
    case 'void': return { label: 'Void', tone: 'neutral' }
    default: return { label: 'Draft', tone: 'neutral' }
  }
}

export default function InvoiceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, query, record, figures, billingReview, company, now, sending, refresh, patchInvoice, send } = useInvoiceScreen(id)
  const waitId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }) }, [])

  const [duplicateReviewed, setDuplicateReviewed] = useState(false)
  useEffect(() => { setDuplicateReviewed(false) }, [id, record])
  const [downloading, setDownloading] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [voidArmed, setVoidArmed] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const voidTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (voidTimer.current) clearTimeout(voidTimer.current) }, [])

  // The description as typed; saved when the field loses focus.
  const [description, setDescription] = useState<string | null>(null)
  const [savingDescription, setSavingDescription] = useState(false)
  const invoice = record?.invoice ?? null
  const shownDescription = description ?? invoice?.description ?? ''

  async function saveDescription() {
    if (!invoice || description === null) return
    const next = description.trim() || null
    if (next === (invoice.description ?? null)) { setDescription(null); return }
    setSavingDescription(true)
    const { error } = await supabase.from('fh_invoices').update({ description: next }).eq('id', invoice.id)
    setSavingDescription(false)
    if (error) {
      toastError("Couldn't save the description", error.message || 'Try again')
      return
    }
    patchInvoice({ description: next })
    setDescription(null)
  }

  async function handleDownload() {
    if (!record || !figures || downloading) return
    hapticTap()
    setDownloading(true)
    try {
      const result = await buildInvoicePdf({
        invoice: record.invoice, contact: record.job, client: record.client, company,
        payments: record.payments, changeOrders: record.changeOrders, insurance: record.insurance,
        invoices: record.jobInvoices, amountDue: figures.due
      })
      const { downloadPdf } = await loadPdf()
      downloadPdf(result)
      toastSuccess('Invoice PDF downloaded', result.filename)
    } catch (e) {
      toastError("Couldn't generate PDF", (e as Error)?.message || 'Try again')
    } finally {
      setDownloading(false)
    }
  }

  // A customer link: the job's invoice page, or the client's when there is
  // no job. The customer opens /p/:token and sees the branded invoice.
  async function handleShare() {
    if (!record || !user || sharing) return
    if (record.invoice.status === 'draft' && billingReview && (billingReview.excess > 0 || billingReview.duplicates.length && !duplicateReviewed)) {
      toastError('Review billing first', 'Resolve contract limits and review similar invoices before sharing.')
      return
    }
    hapticTap()
    setSharing(true)
    try {
      const link = await mintPublicLink({
        contactId: record.job?.id ?? null,
        clientId: record.job ? null : record.invoice.client_id || record.client?.id || null,
        userId: user.id,
        kind: 'invoice'
      })
      try {
        await navigator.clipboard.writeText(link.url)
        toastSuccess('Share link copied', 'Send it however you want, text, email, anything.')
      } catch {
        toastSuccess('Share link ready', link.url)
      }
    } catch (e) {
      toastError("Couldn't mint share link", (e as Error)?.message || 'Try again.')
    } finally {
      setSharing(false)
    }
  }

  // Void asks with a second tap on the same button (D57): the first arms
  // it for 4 seconds, the second voids.
  async function handleVoid() {
    if (!invoice || voiding || sending) return
    hapticTap()
    if (!voidArmed) {
      setVoidArmed(true)
      voidTimer.current = setTimeout(() => setVoidArmed(false), VOID_ARMED_MS)
      return
    }
    if (voidTimer.current) clearTimeout(voidTimer.current)
    setVoidArmed(false)
    setVoiding(true)
    const { error } = await setInvoiceStatus(invoice, 'void')
    setVoiding(false)
    if (error) {
      toastError("Couldn't void", error.message || 'Try again')
      return
    }
    patchInvoice({ status: 'void' })
    toastSuccess('Invoice voided', '')
    refresh()
  }

  const back = () => goBackFrom(navigate, '/invoices')

  if (query.isError) {
    return (
      <div className="v3-screen fhinv">
        <header className="fhinv-head">
          <IconButton aria-label="Back" icon={ChevronLeft} variant="plain" size={44} onClick={back} />
          <h1 className="fhinv-title" ref={titleRef} tabIndex={-1}>Invoice</h1>
        </header>
        <div className="fhinv-state">
          <DataErrorState
            title="Couldn't load this invoice"
            message={query.error?.message === 'Invoice not found' ? 'The invoice may have been removed.' : 'Check your connection and try again.'}
            actionLabel="Try again"
            onRetry={() => void query.refetch()}
          />
        </div>
      </div>
    )
  }

  if (!record || !figures || !invoice) {
    return (
      <div className="v3-screen fhinv">
        <header className="fhinv-head">
          <IconButton aria-label="Back" icon={ChevronLeft} variant="plain" size={44} onClick={back} />
          <h1 className="fhinv-title" ref={titleRef} tabIndex={-1}>Invoice</h1>
        </header>
        <div className="fhinv-state">
          <SkeletonRows rows={5} label="Loading invoice" />
        </div>
      </div>
    )
  }

  const { to, due, standing, settled, isDraft, linkedPayments, dates } = figures
  const chip = statusChip(standing)
  const paidOnIt = linkedPayments.reduce((s, p) => s + Number(p.amount || 0), 0)
  const canRemind = standing.issued && !settled
  const jobTitle = record.job?.job_title?.trim() || ''
  const voidLabel = voidArmed ? 'Tap again to void' : 'Void'

  return (
    <div className="v3-screen fhinv" data-build-screen="InvoiceDetail">
      <header className="fhinv-head">
        <IconButton aria-label="Back" icon={ChevronLeft} variant="plain" size={44} onClick={back} />
        <h1 className="fhinv-title" ref={titleRef} tabIndex={-1}>{figures.title}</h1>
        {!settled && <Button variant="quiet" size="mini" to={`/invoices/${invoice.id}/edit`}>Edit</Button>}
      </header>

      <section className="fhinv-hero" aria-label="Invoice summary">
        <p className="fhinv-hero__facts" title={invoice.id}>{invoiceReference(invoice)}</p>
        <p className="fhinv-hero__who">{to.name || 'Customer'}</p>
        {record.job ? (
          <Link className="fhinv-hero__job" to={`/jobs/${record.job.id}?tab=financials`}>{jobTitle || 'Open job'}</Link>
        ) : record.client?.company_name ? (
          <p className="fhinv-hero__job">{record.client.company_name}</p>
        ) : null}
        <p className={`fhinv-hero__amount${settled ? ' is-settled' : ''}`}>
          {standing.status === 'paid' ? 'Paid' : standing.status === 'void' ? 'Void' : formatMoney(due)}
        </p>
        <div className="fhinv-hero__status">
          <Chip label={chip.label} tone={chip.tone} />
          {dates && <span className="fhinv-hero__dates">{dates}</span>}
        </div>
        <p className="fhinv-hero__facts">
          {`${formatMoney(Number(invoice.amount) || 0)} ${standing.status === 'draft' ? 'draft amount, not yet issued' : 'invoice amount'}`}
          {paidOnIt > 0 ? `, ${formatMoney(paidOnIt)} paid on it` : ''}
        </p>
      </section>

      {isDraft && billingReview && <InvoiceBillingReview review={billingReview} acknowledged={duplicateReviewed} onAcknowledge={setDuplicateReviewed} />}
      <section className="fhinv-section" aria-label="Description">
        <Field
          multiline
          label="Description, shows on the invoice"
          helper={savingDescription ? 'Saving' : 'Prints in the PDF Description column and in the email.'}
          placeholder={record.job?.job_title || 'What this invoice is for'}
          value={shownDescription}
          readOnly={settled}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => void saveDescription()}
        />
      </section>

      <div className="fhinv-actions">
        {!settled && (
          <Button
            variant="primary"
            size="lg"
            block
            icon={DollarSign}
            to={`/invoices/${invoice.id}/payment`}
            disabled={sending}
            aria-describedby={sending ? waitId : undefined}
          >
            Collect payment
          </Button>
        )}
        {!settled && (
          <Button variant="secondary" size="md" block icon={Send} loading={sending} onClick={() => void send({ duplicateReviewed })}>
            {isDraft ? 'Send' : 'Resend'}
          </Button>
        )}
        {canRemind && (
          <Button variant="secondary" size="md" block icon={BellRing} to={`/invoices/${invoice.id}/remind`}>Remind</Button>
        )}
        <Button variant="secondary" size="md" block icon={FileDown} loading={downloading} title="Download the invoice as a PDF" onClick={() => void handleDownload()}>
          PDF
        </Button>
        <Button variant="secondary" size="md" block icon={LinkIcon} loading={sharing} title="Mint a public share link the customer can open in any browser" onClick={() => void handleShare()}>
          Share link
        </Button>
        {figures.recordHref && (
          <Button variant="quiet" size="md" block to={figures.recordHref}>{figures.recordLabel}</Button>
        )}
        {!settled && (
          <Button
            variant="destructive"
            size="md"
            block
            loading={voiding}
            disabled={sending}
            aria-describedby={sending ? waitId : undefined}
            onClick={() => void handleVoid()}
          >
            {voidLabel}
          </Button>
        )}
        {/* Under the buttons, so none of them moves when it comes and goes
            under a finger that is still tapping. */}
        {!settled && sending && (
          <p className="fhinv-helper" id={waitId}>Collect payment and Void are paused while the email goes out.</p>
        )}
      </div>

      <section className="fhinv-section" aria-labelledby="fhinv-payments-title">
        <h2 className="fhinv-section__title" id="fhinv-payments-title">Payments</h2>
        {linkedPayments.length === 0 ? (
          <p className="fhinv-quiet">
            {settled ? 'No payment is linked to this invoice.' : 'No payments on this invoice yet. Collect payment logs cash, a check or a transfer.'}
          </p>
        ) : (
          <ul className="fhinv-rows">
            {linkedPayments.map((p) => (
              <Row
                key={p.id}
                as="li"
                title={`${methodLabel(p.method)}${p.reference ? `, ${p.reference}` : ''}`}
                subline={shortDate(p.paid_on || (parseDateOnly(p.created_at) ? p.created_at : null), now) || undefined}
                money={Number(p.amount) || 0}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
