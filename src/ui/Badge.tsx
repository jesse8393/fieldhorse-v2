import type { HTMLAttributes, ReactNode } from 'react'

type BadgeTone = 'neutral' | 'success' | 'danger'

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone
  children: ReactNode
}

export default function Badge({
  tone = 'neutral',
  className = '',
  children,
  ...rest
}: BadgeProps) {
  return (
    <span className={`fh-badge fh-badge--${tone} ${className}`.trim()} {...rest}>
      {children}
    </span>
  )
}
