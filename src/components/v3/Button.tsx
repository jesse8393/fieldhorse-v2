// Button — THE action button. Kit wave 1 (redesign W3): this primitive
// existed as a stub with no CSS and zero adopters while Overview
// (SecondaryAction), Leads (LeadAction), and Invoices (InvoiceAction +
// three inline PaymentCard buttons) each hand-rolled the same control.
// The .v3-btn family in global.css is now the single source of truth;
// those local clones are gone. Variants:
//   primary   — gold gradient, the one main action on a surface
//   secondary — quiet surface chip (the default look of most actions)
//   ghost     — borderless-feeling tertiary
//   danger    — destructive
//   success   — green morph (e.g. Send → "Sent ✓")
import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ComponentType } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'v3-btn v3-btn--primary',
  secondary: 'v3-btn v3-btn--secondary',
  ghost: 'v3-btn v3-btn--ghost',
  danger: 'v3-btn v3-btn--danger',
  success: 'v3-btn v3-btn--success'
}
const SIZE: Record<ButtonSize, string> = {
  sm: 'v3-btn--sm',
  md: '',
  lg: 'v3-btn--lg'
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  leftIcon?: ComponentType<any>
  rightIcon?: ComponentType<any>
  iconOnly?: boolean
  fullWidth?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    leftIcon: LeftIcon,
    rightIcon: RightIcon,
    iconOnly = false,
    fullWidth = false,
    className = '',
    children,
    ...rest
  },
  ref
) {
  const cls = [
    VARIANT[variant] || VARIANT.primary,
    SIZE[size] || '',
    fullWidth ? 'v3-btn--full' : '',
    iconOnly ? 'v3-btn--icon-only' : '',
    className
  ].filter(Boolean).join(' ')

  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 18 : 16

  return (
    <button ref={ref} className={cls} {...rest}>
      {LeftIcon ? <LeftIcon size={iconSize} aria-hidden="true" /> : null}
      {children}
      {RightIcon ? <RightIcon size={iconSize} aria-hidden="true" /> : null}
    </button>
  )
})

export default Button
