import { forwardRef } from 'react'

const VARIANT = {
  primary: 'v3-btn v3-btn--primary',
  secondary: 'v3-btn v3-btn--secondary',
  ghost: 'v3-btn v3-btn--ghost',
  danger: 'v3-btn v3-btn--danger'
}
const SIZE = {
  sm: 'v3-btn--sm',
  md: '',
  lg: 'v3-btn--lg'
}

const Button = forwardRef(function Button(
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
