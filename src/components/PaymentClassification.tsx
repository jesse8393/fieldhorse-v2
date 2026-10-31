import { useId } from 'react'

export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'card', label: 'Card' },
  { value: 'ach', label: 'ACH' },
  { value: 'other', label: 'Other' }
]

const PAYMENT_KINDS = [
  { value: 'deposit', label: 'Deposit' },
  { value: 'progress', label: 'Progress' },
  { value: 'final', label: 'Final' },
  { value: 'retainage', label: 'Retainage' },
  { value: 'other', label: 'Other' }
]

export default function PaymentClassification({ method, kind, onMethodChange, onKindChange, disabled }: {
  method: string
  kind: string
  onMethodChange: (value: string) => void
  onKindChange: (value: string) => void
  disabled: boolean
}) {
  const id = useId()
  return <div className="fh-payment-classification">
    {[
      { label: 'Method', options: PAYMENT_METHODS, value: method, change: onMethodChange },
      { label: 'Kind', options: PAYMENT_KINDS, value: kind, change: onKindChange }
    ].map(({ label, options, value, change }) => <div className="fhc-field" key={label}>
      <label className="fhc-field__label" htmlFor={`${id}-${label}`}>{label}</label>
      <select className="fhc-field__control" id={`${id}-${label}`} value={value} disabled={disabled} onChange={event => change(event.target.value)}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>)}
  </div>
}
