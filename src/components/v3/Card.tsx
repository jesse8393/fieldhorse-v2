import { forwardRef } from 'react'
import type { HTMLAttributes, ElementType, CSSProperties } from 'react'
import { motion } from 'framer-motion'

type CardPadding = 'sm' | 'md' | 'lg' | 'none'
type CardAccent = 'primary' | 'success' | 'danger' | 'hero'

const PADDING: Record<CardPadding, string> = { sm: 'v3-card--padded-sm', md: 'v3-card--padded', lg: 'v3-card--padded-lg', none: '' }
const ACCENT: Record<CardAccent, string> = {
  primary: 'v3-card--accent-primary',
  success: 'v3-card--accent-success',
  danger: 'v3-card--accent-danger',
  hero: 'v3-card--hero'
}

type CardProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType
  padding?: CardPadding
  surface?: 1 | 2
  accent?: CardAccent
  flat?: boolean
  interactive?: boolean
  onTap?: () => void
  style?: CSSProperties
}

const Card = forwardRef<HTMLElement, CardProps>(function Card(
  {
    as: Tag = 'div',
    padding = 'md',
    surface = 1,
    accent,
    flat = false,
    interactive = false,
    onTap,
    className = '',
    style,
    children,
    ...rest
  },
  ref
) {
  const cls = [
    'v3-card',
    surface === 2 ? 'v3-card--surface-2' : '',
    PADDING[padding] || '',
    accent ? ACCENT[accent] : '',
    flat ? 'v3-card--flat' : '',
    (interactive || onTap) ? 'v3-card--interactive' : '',
    className
  ].filter(Boolean).join(' ')

  if (interactive || onTap) {
    return (
      <motion.button
        ref={ref as any}
        type="button"
        whileTap={{ scale: 0.985 }}
        transition={{ duration: 0.1, ease: 'easeOut' }}
        className={cls}
        onClick={onTap}
        style={{ textAlign: 'left', ...style }}
        {...(rest as any)}
      >
        {children}
      </motion.button>
    )
  }

  return (
    <Tag ref={ref} className={cls} style={style} {...rest}>
      {children}
    </Tag>
  )
})

export default Card
