import { motion } from 'framer-motion'
import CountUp from '../fx/CountUp.tsx'
import { hapticTap } from '../../lib/haptics.ts'

type KpiTone = 'primary' | 'success' | 'danger'

const TONE: Record<KpiTone, { bg: string; border: string; accent: string; glow: string }> = {
  primary: {
    bg: 'linear-gradient(180deg, rgba(201, 150, 58,0.10), rgba(201, 150, 58,0.02))',
    border: 'rgba(201, 150, 58,0.30)',
    accent: 'var(--v3-primary)',
    glow: '0 0 0 1px rgba(201, 150, 58,0.05) inset'
  },
  success: {
    bg: 'linear-gradient(180deg, rgba(45, 122, 79, 0.10), rgba(45, 122, 79, 0.02))',
    border: 'rgba(45, 122, 79, 0.30)',
    accent: 'var(--v3-success-bright)',
    glow: '0 0 0 1px rgba(45, 122, 79, 0.05) inset'
  },
  danger: {
    bg: 'linear-gradient(180deg, rgba(192, 57, 43, 0.12), rgba(192, 57, 43, 0.02))',
    border: 'rgba(192, 57, 43, 0.40)',
    accent: 'var(--v3-danger-bright)',
    glow: '0 0 0 1px rgba(192, 57, 43, 0.06) inset'
  }
}

function formatMoney(n: number | null | undefined) {
  if (n == null) return '\u2003'
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`
  return n.toLocaleString()
}

type KpiTileProps = {
  tone?: KpiTone
  value?: number | string | null
  label?: import('react').ReactNode
  subline?: import('react').ReactNode
  isMoney?: boolean
  to?: string
  onTap?: () => void
}

export default function KpiTile({
  tone = 'primary',
  value,
  label,
  subline,
  isMoney = false,
  to,
  onTap
}: KpiTileProps) {
  const t = TONE[tone] || TONE.primary
  const interactive = !!(to || onTap)
  const handleTap = () => {
    if (!interactive) return
    hapticTap()
    onTap && onTap()
  }
  const Tag: any = interactive ? motion.button : motion.div
  const tagProps: any = interactive
    ? { type: 'button', whileTap: { scale: 0.97 }, onClick: handleTap }
    : {}

  return (
    <Tag
      {...tagProps}
      style={{
        position: 'relative',
        textAlign: 'left',
        padding: '12px 12px 16px',
        borderRadius: 'var(--v3-radius-card)',
        background: t.bg,
        border: `1px solid ${t.border}`,
        boxShadow: t.glow,
        color: 'inherit',
        cursor: interactive ? 'pointer' : 'default',
        minHeight: 96,
        WebkitTapHighlightColor: 'transparent',
        overflow: 'hidden'
      }}
    >
      <div
        className="v3-money"
        style={{ fontSize: 24, color: t.accent, marginBottom: 8, minHeight: 24 }}
      >
        {value == null ? (
          <span className="v3-skeleton" style={{ width: 56, height: 24 }} />
        ) : isMoney ? (
          <>
            <span style={{ fontSize: 16, color: 'var(--v3-text-muted)', verticalAlign: 'top', marginRight: 1 }}>$</span>
            <CountUp to={Number(value) || 0} formatter={formatMoney} />
          </>
        ) : (
          <CountUp to={Number(value) || 0} />
        )}
      </div>
      <div
        className="v3-caption"
        style={{ fontSize: 12, fontWeight: 600, color: 'var(--v3-text)', lineHeight: 1.25, letterSpacing: 0 }}
      >
        {label}
      </div>
      {subline ? (
        <div className="v3-caption" style={{ marginTop: 4, fontSize: 12, color: t.accent, fontWeight: 600 }}>
          {subline}
        </div>
      ) : null}
    </Tag>
  )
}
