import { createUuid } from '../../lib/uuid.ts'
// Collect payment, /invoices/:id/payment (Phase 9, Task 12, decision D57):
// the screen that records what the customer paid on one invoice. A receipt
// log, not a card processor. The amount is prefilled with what the invoice
// still owes (the same figure its screen and Money show); method, kind, a
// reference and the date follow; the one gold button records it and
// returns to the invoice.
//
// A job's invoice is paid through logPayment (lib/pipeline.ts), so the job
// settles and auto closes as it always has, with the payment linked to the
// invoice. An invoice with no job is paid through logInvoicePayment
// (lib/invoices.ts): the payment links to the invoice alone and the invoice
// flips to paid once its payments cover it (D62).

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { Button, Field, IconButton, SkeletonRows, formatMoney } from '../../components/fh'
import DataErrorState from '../../components/DataErrorState.tsx'
import { logInvoicePayment } from '../../lib/invoices.ts'
import { logPayment } from '../../lib/pipeline.ts'
import { todayYmd } from '../../lib/dates.ts'
import { hapticTap } from '../../lib/haptics.ts'
import { toastError, toastSuccess } from '../../lib/toast.ts'
import { goBackFrom, useInvoiceScreen } from './useInvoiceScreen.ts'
import './invoices.css'

// A dollar amount for the editable input without stranding cents: a
// $4,999.50 balance prefills as "4999.50", not "5000". Whole amounts drop
// the ".00".
function amountInput(n: number): string {
  if (!(n > 0)) return ''
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'card', label: 'Card' },
  { value: 'ach', label: 'ACH' },
  { value: 'other', label: 'Other' }
]

// Payment kinds (migration 022), so the balance can call out a deposit or
// retainage apart from progress money.
const KINDS = [
  { value: 'deposit', label: 'Deposit' },
  { value: 'progress', label: 'Progress' },
  { value: 'final', label: 'Final' },
  { value: 'retainage', label: 'Retainage' },
  { value: 'other', label: 'Other' }
]

function Choices({ label, options, value, onChange, disabled }: {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (next: string) => void
  disabled: boolean
}) {
  return (
    <fieldset className="fhinv-choices">
      <legend className="fhinv-choices__label">{label}</legend>
      <div className="fhinv-choices__row" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            className="fhinv-choice"
            aria-checked={value === o.value}
            disabled={disabled}
            onClick={() => { hapticTap(); onChange(o.value) }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

export default function InvoicePayment() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { query, record, figures, refresh } = useInvoiceScreen(id)
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }) }, [])

  const [amount, setAmount] = useState<string | null>(null)
  const [method, setMethod] = useState('check')
  const [kind, setKind] = useState('other')
  const [reference, setReference] = useState('')
  const [paidOn, setPaidOn] = useState(() => todayYmd())
  const [saving, setSaving] = useState(false)
  // One id for this payment, so a retry after a lost answer records it once;
  // a new id when the form changes after a failed try.
  const [initialPaymentId] = useState(createUuid)
  const paymentId = useRef(initialPaymentId)
  const payloadKey = useRef<string | null>(null)

  const shownAmount = amount ?? (figures ? amountInput(figures.due) : '')
  const numeric = Number(shownAmount) || 0
  const valid = shownAmount !== '' && Number.isFinite(numeric) && numeric > 0
  const back = () => goBackFrom(navigate, `/invoices/${id}`)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!record || saving) return
    if (!valid) {
      toastError('Enter an amount', 'Amount must be greater than zero.')
      return
    }
    const key = JSON.stringify([numeric, method, kind, reference, paidOn])
    if (payloadKey.current != null && payloadKey.current !== key) paymentId.current = createUuid()
    payloadKey.current = key
    setSaving(true)
    try {
      const res = record.job
        ? await logPayment(record.job as never, { id: paymentId.current, amount: numeric, method, kind, reference, paid_on: paidOn, invoice_id: record.invoice.id })
        : await logInvoicePayment(record.invoice, { id: paymentId.current, amount: numeric, method, kind, reference, paid_on: paidOn, priorPayments: record.payments })
      if (res && 'error' in res && res.error) throw new Error((res.error as { message?: string }).message || 'save failed')
      hapticTap()
      toastSuccess('Payment recorded', `${formatMoney(numeric)}, ${METHODS.find((m) => m.value === method)?.label || 'Payment'}`)
      refresh()
      navigate(`/invoices/${record.invoice.id}`, { replace: true })
    } catch (err) {
      toastError("Couldn't record payment", (err as Error)?.message || 'Try again in a moment.')
      setSaving(false)
    }
  }

  const header = (
    <header className="fhinv-head">
      <IconButton aria-label="Back" icon={ChevronLeft} variant="plain" size={44} onClick={back} />
      <h1 className="fhinv-title" ref={titleRef} tabIndex={-1}>Collect payment</h1>
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
        <div className="fhinv-state"><SkeletonRows rows={4} label="Loading invoice" /></div>
      </div>
    )
  }

  const who = figures.to.name || 'the customer'
  return (
    <div className="v3-screen fhinv" data-build-screen="InvoicePayment">
      {header}
      <p className="fhinv-intro">
        {`Log what ${who} paid on ${figures.title}. This records the receipt; it does not charge a card.`}
      </p>
      <form className="fhinv-form" onSubmit={(e) => void submit(e)}>
        <Field
          id="fhinv-pay-amount"
          label="Amount"
          inputMode="decimal"
          autoComplete="off"
          value={shownAmount}
          disabled={saving}
          helper={figures.due > 0 ? `${formatMoney(figures.due)} still owed on this invoice.` : 'Nothing is owed on this invoice.'}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
        />
        <Choices label="Method" options={METHODS} value={method} onChange={setMethod} disabled={saving} />
        <Choices label="Kind" options={KINDS} value={kind} onChange={setKind} disabled={saving} />
        {method !== 'cash' && method !== 'other' && (
          <Field
            label={method === 'check' ? 'Check number' : method === 'card' ? 'Last 4 or receipt' : 'Reference'}
            value={reference}
            disabled={saving}
            placeholder="Optional"
            onChange={(e) => setReference(e.target.value)}
          />
        )}
        <Field label="Paid on" type="date" value={paidOn} disabled={saving} onChange={(e) => setPaidOn(e.target.value)} />
        <div className="fhinv-form__save">
          <Button type="submit" variant="primary" size="lg" block loading={saving} disabled={!valid}>
            {valid ? `Record ${formatMoney(numeric)}` : 'Record payment'}
          </Button>
        </div>
      </form>
    </div>
  )
}
