import { motion } from 'framer-motion'
import CountUp from '../fx/CountUp.jsx'
import { hapticTap } from '../../lib/haptics.ts'

const TONE = {
  primary: {
    bg: 'linear-gradient(180deg, rgba(212,175,55,0.10), rgba(212,175,55,0.02))',
    border: 'rgba(212,175,55,0.30)',
    accent: 'var(--v3-primary)',
    glow: '0 0 0 1px rgba(212,175,55,0.05) inset'
  },
  success: {
    bg: 'linear-gradient(180deg, rgba(79, 140, 94, 0.10), rgba(79, 140, 94, 0.02))',
    border: 'rgba(79, 140, 94, 0.30)',
    accent: 'var(--v3-success-bright)',
    glow: '0 0 0 1px rgba(79, 140, 94, 0.05) inset'
  },
  danger: {
    bg: 'linear-gradient(180deg, rgba(192, 57, 43, 0.12), rgba(192, 57, 43, 0.02))',
    border: 'rgba(192, 57, 43, 0.40)',
    accent: 'var(--v3-danger-bright)',
    glow: '0 0 0 1px rgba(192, 57, 43, 0.06) inset'
  }
}

function formatMoney(n) {
  if (n == null) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`
  return n.toLocaleString()
}

export default function KpiTile({
  tone = 'primary',
  value,
  label,
  subline,
  isMoney = false,
  to,
  onTap
}) {
  const t = TONE[tone] || TONE.primary
  const interactive = !!(to || onTap)
  const handleTap = () => {
    if (!interactive) return
    hapticTap()
    onTap && onTap()
  }
  const Tag = interactive ? motion.button : motion.div
  const tagProps = interactive
    ? { type: 'button', whileTap: { scale: 0.97 }, onClick: handleTap }
    : {}

  return (
    <Tag
      {...tagProps}
      style={{
        position: 'relative',
        textAlign: 'left',
        padding: '14px 14px 16px',
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
        style={{ fontSize: 30, color: t.accent, marginBottom: 6, minHeight: 30 }}
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
        style={{ fontSize: 11, fontWeight: 600, color: 'var(--v3-text)', lineHeight: 1.25, letterSpacing: '-0.005em' }}
      >
        {label}
      </div>
      {subline ? (
        <div className="v3-caption" style={{ marginTop: 4, fontSize: 11, color: t.accent, fontWeight: 600 }}>
          {subline}
        </div>
      ) : null}
    </Tag>
  )
}
