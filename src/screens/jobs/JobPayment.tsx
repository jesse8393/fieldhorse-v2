// Log a payment on a job, /jobs/:id/payment (Phase 9, Task 13, D57). It
// took the place of the payment sheet: a receipt log, not a card
// processor. The amount starts at the balance; one tap on Record writes
// the fh_payments row through logPayment, which also closes the job when
// it is paid in full, and goes back to the job.

import { useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Field } from '../../components/fh'
import CreateShell, { Choices, moneyInput } from '../new/CreateShell.tsx'
import { logPayment } from '../../lib/pipeline.ts'
import { toastError, toastSuccess } from '../../lib/toast.ts'
import { hapticMedium } from '../../lib/haptics.ts'
import { todayYmd } from '../../lib/dates.ts'
import { JobScreenFallback, money, useJobScreen } from './jobScreen.tsx'

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'card', label: 'Card' },
  { value: 'ach', label: 'ACH' },
  { value: 'other', label: 'Other' }
]

// Payment kinds (migration 022): the invoice balance calls out deposits
// and retainage apart from progress money.
const KINDS = [
  { value: 'deposit', label: 'Deposit' },
  { value: 'progress', label: 'Progress' },
  { value: 'final', label: 'Final' },
  { value: 'retainage', label: 'Retainage' },
  { value: 'other', label: 'Other' }
]

// The balance as typed text without stranding cents: $4,999.50 prefills
// as 4999.50, a whole amount drops the .00.
function amountInput(n: unknown) {
  const v = Number(n || 0)
  if (!(v > 0)) return ''
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

export default function JobPayment() {
  const { id } = useParams()
  const { data, home, goBack } = useJobScreen(id)
  if (!data.contact || data.loading) return <JobScreenFallback title="Log payment" saveLabel="Record payment" data={data} home={home} />
  return <PaymentForm key={data.contact.id} data={data} goBack={goBack} home={home} />
}

function PaymentForm({ data, goBack, home }: { data: ReturnType<typeof useJobScreen>['data']; goBack: () => void; home: string }) {
  // The parent renders this form only once the job is in.
  const contact = data.contact as NonNullable<typeof data.contact>
  const balance = Number(data.balance || 0)
  const [amount, setAmount] = useState(() => amountInput(balance))
  const [method, setMethod] = useState('check')
  const [kind, setKind] = useState('other')
  const [reference, setReference] = useState('')
  const [paidOn, setPaidOn] = useState(() => todayYmd())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>()
  // One id per payment intent: a retap after a lost response upserts to a
  // no-op, while an edited amount gets a fresh id so the first row is never
  // claimed as the second.
  const paymentId = useRef(typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : undefined)
  const paymentKey = useRef<string | null>(null)

  const numeric = Number(amount) || 0
  const overage = numeric > balance

  async function save() {
    if (saving) return
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setError('Enter an amount above zero.')
      return
    }
    const key = JSON.stringify([numeric, method, kind, reference, paidOn])
    if (paymentKey.current != null && paymentKey.current !== key && typeof crypto !== 'undefined' && crypto.randomUUID) {
      paymentId.current = crypto.randomUUID()
    }
    paymentKey.current = key
    setSaving(true)
    setError(undefined)
    try {
      const res = await logPayment(contact, { id: paymentId.current, amount: numeric, method, kind, reference, paid_on: paidOn })
      if (res && (res as { error?: { message?: string } }).error) {
        throw new Error((res as { error?: { message?: string } }).error?.message || 'The payment was not saved.')
      }
      hapticMedium()
      toastSuccess('Payment recorded', `${money(numeric)}, ${METHODS.find((m) => m.value === method)?.label || 'payment'}`)
      await data.fetchAll()
      goBack()
    } catch (e) {
      const message = (e as { message?: string })?.message || 'Try again in a moment.'
      setError(message)
      toastError("Couldn't record payment", message)
      setSaving(false)
    }
  }

  return (
    <CreateShell
      title="Log payment"
      saveLabel={numeric > 0 ? `Record ${money(numeric)}` : 'Record payment'}
      saving={saving}
      error={error}
      backTo={home}
      onSave={save}
    >
      <p className="fhja-lede">
        {contact.name ? `A payment ${contact.name} already made.` : 'A payment already made on this job.'} This records the receipt; it does not charge a card.
      </p>
      <Field
        label="Amount"
        inputMode="decimal"
        placeholder="0.00"
        value={amount}
        helper={balance > 0 ? `Balance ${money(balance)}${overage ? ', this is more than the balance' : ''}` : 'No outstanding balance'}
        onChange={(e) => { setAmount(moneyInput(e.target.value)); setError(undefined) }}
      />
      <Choices label="Method" options={METHODS} value={method} onChange={(v) => setMethod(v || method)} />
      <Choices label="Kind" options={KINDS} value={kind} onChange={(v) => setKind(v || kind)} />
      {method !== 'cash' && method !== 'other' && (
        <Field
          label={method === 'check' ? 'Check number' : method === 'card' ? 'Last 4 or receipt' : 'Reference'}
          value={reference}
          placeholder={method === 'check' ? '1234' : 'Optional'}
          autoComplete="off"
          onChange={(e) => setReference(e.target.value)}
        />
      )}
      <Field label="Paid on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
    </CreateShell>
  )
}
