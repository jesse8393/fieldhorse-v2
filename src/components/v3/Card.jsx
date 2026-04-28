import { forwardRef } from 'react'
import { motion } from 'framer-motion'

const PADDING = { sm: 'v3-card--padded-sm', md: 'v3-card--padded', lg: 'v3-card--padded-lg', none: '' }
const ACCENT = {
  primary: 'v3-card--accent-primary',
  success: 'v3-card--accent-success',
  danger: 'v3-card--accent-danger',
  hero: 'v3-card--hero'
}

const Card = forwardRef(function Card(
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
        ref={ref}
        type="button"
        whileTap={{ scale: 0.985 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className={cls}
        onClick={onTap}
        style={{ textAlign: 'left', ...style }}
        {...rest}
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
