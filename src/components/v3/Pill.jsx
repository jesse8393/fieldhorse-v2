const VARIANT = {
  primary: 'v3-pill v3-pill--primary',
  success: 'v3-pill v3-pill--success',
  danger: 'v3-pill v3-pill--danger',
  neutral: 'v3-pill v3-pill--neutral'
}

export default function Pill({ tone = 'neutral', icon: Icon, className = '', children, ...rest }) {
  const cls = [VARIANT[tone] || VARIANT.neutral, className].filter(Boolean).join(' ')
  return (
    <span className={cls} {...rest}>
      {Icon ? <Icon size={11} aria-hidden="true" /> : null}
      {children}
    </span>
  )
}
