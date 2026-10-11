import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes, ReactNode, Ref, TextareaHTMLAttributes } from 'react'
import { CircleAlert } from 'lucide-react'
import Icon from './Icon.tsx'
import { cx } from './cx.ts'

// Text field (spec section 7): label above, a 16 px input outlined in
// --fh-edge-strong (3.6 to 1 on paper) with radius 12, helper below.
// An error replaces the helper, turns the outline to danger, and is wired
// through aria-invalid and aria-describedby. Write errors that say what
// is wrong and how to fix it ("Enter an amount, such as 1240.00").
//
// Inputs stay 16 px so iOS never zooms on focus.

export type FieldOwnProps = {
  label: ReactNode
  /** Help under the field. Hidden while there is an error. */
  helper?: ReactNode
  /** What is wrong and how to fix it. Replaces the helper. */
  error?: ReactNode
  id?: string
  className?: string
}

export type FieldInputProps = FieldOwnProps & { multiline?: false } &
  Omit<InputHTMLAttributes<HTMLInputElement>, keyof FieldOwnProps>
export type FieldTextareaProps = FieldOwnProps & { multiline: true } &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, keyof FieldOwnProps>

export type FieldProps = FieldInputProps | FieldTextareaProps

const Field = forwardRef<HTMLInputElement | HTMLTextAreaElement, FieldProps>(function Field(props, ref) {
  const { label, helper, error, id, className, multiline, ...control } = props
  const autoId = useId()
  const controlId = id ?? `fhc-field-${autoId}`
  const messageId = `${controlId}-message`
  const hasError = error != null && error !== false && error !== ''
  const message = hasError ? error : helper
  const describedBy = cx(control['aria-describedby'], message != null && message !== false ? messageId : undefined) || undefined

  const shared = {
    id: controlId,
    className: 'fhc-field__control',
    'aria-invalid': hasError ? true : undefined,
    'aria-describedby': describedBy
  }

  return (
    <div className={cx('fhc-field', hasError && 'is-invalid', control.disabled && 'is-disabled', className)}>
      <label className="fhc-field__label" htmlFor={controlId}>
        {label}
      </label>
      {multiline ? (
        <textarea
          ref={ref as Ref<HTMLTextAreaElement>}
          rows={3}
          {...(control as TextareaHTMLAttributes<HTMLTextAreaElement>)}
          {...shared}
          className={cx(shared.className, 'fhc-field__control--multiline')}
        />
      ) : (
        <input
          ref={ref as Ref<HTMLInputElement>}
          type="text"
          {...(control as InputHTMLAttributes<HTMLInputElement>)}
          {...shared}
        />
      )}
      {/* Polite, so an error that appears after a save attempt is read out
          without cutting off what the screen reader is saying. */}
      <div className="fhc-field__message" aria-live="polite">
        {hasError ? (
          <p id={messageId} className="fhc-field__error">
            <Icon icon={CircleAlert} size={18} />
            <span>{error}</span>
          </p>
        ) : message != null && message !== false ? (
          <p id={messageId} className="fhc-field__helper">{helper}</p>
        ) : null}
      </div>
    </div>
  )
})

export default Field
