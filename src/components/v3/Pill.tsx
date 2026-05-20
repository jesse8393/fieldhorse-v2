import type { HTMLAttributes, ComponentType } from 'react'

type PillTone = 'primary' | 'success' | 'danger' | 'neutral'

const VARIANT: Record<PillTone, string> = {
  primary: 'v3-pill v3-pill--primary',
  success: 'v3-pill v3-pill--success',
  danger: 'v3-pill v3-pill--danger',
  neutral: 'v3-pill v3-pill--neutral'
}

type PillProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: PillTone
  icon?: ComponentType<any>
}

export default function Pill({ tone = 'neutral', icon: Icon, className = '', children, ...rest }: PillProps) {
  const cls = [VARIANT[tone] || VARIANT.neutral, className].filter(Boolean).join(' ')
  return (
    <span className={cls} {...rest}>
      {Icon ? <Icon size={11} aria-hidden="true" /> : null}
      {children}
    </span>
  )
}
