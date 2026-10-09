import { motion } from 'framer-motion'
import CountUp from '../fx/CountUp.tsx'
import { hapticTap } from '../../lib/haptics.ts'
import { moneyK } from '../../lib/format.ts'

type KpiTone = 'primary' | 'success' | 'danger'

const TONE: Record<KpiTone, { bg: string; border: string; accent: string; glow: string }> = {
  primary: {
    bg: 'linear-gradient(180deg, rgba(201, 150, 58,0.10), rgba(201, 150, 58,0.02))',
    border: 'rgba(201, 150, 58,0.30)',
    accent: 'var(--v3-primary-text)',
    glow: '0 0 0 1px rgba(201, 150, 58,0.05) inset'
  },
  success: {
    bg: 'linear-gradient(180deg, rgba(45, 122, 79, 0.10), rgba(45, 122, 79, 0.02))',
    border: 'rgba(45, 122, 79, 0.30)',
    accent: 'var(--v3-success-text)',
    glow: '0 0 0 1px rgba(45, 122, 79, 0.05) inset'
  },
  danger: {
    bg: 'linear-gradient(180deg, rgba(192, 57, 43, 0.12), rgba(192, 57, 43, 0.02))',
    border: 'rgba(192, 57, 43, 0.40)',
    accent: 'var(--v3-danger-text)',
    glow: '0 0 0 1px rgba(192, 57, 43, 0.06) inset'
  }
}

// The "$" renders as its own smaller glyph, so the count formats only
// the digits and unit, and the sign goes in front of that glyph ("-$500",
// never "$-500"). Unit choice after rounding (999,999 reads "1.0M", not
// "1000K") and the M tier come from the shared moneyK helper.
function moneyDigits(n: number) {
  return (moneyK(Math.abs(n)) ?? '$0').replace('$', '')
}

type KpiTileProps = {
  tone?: KpiTone
  value?: number | string | null
  label?: import('react').ReactNode
  subline?: import('react').ReactNode
  isMoney?: boolean
  onTap?: () => void
}

export default function KpiTile({
  tone = 'primary',
  value,
  label,
  subline,
  isMoney = false,
  onTap
}: KpiTileProps) {
  const t = TONE[tone] || TONE.primary
  // Only onTap makes the tile a button. The old `to` prop rendered a
  // tappable button that never navigated, so it was removed.
  const interactive = !!onTap
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
            {Number(value) < 0 && '-'}
            <span style={{ fontSize: 16, color: 'var(--v3-text-muted)', verticalAlign: 'top', marginRight: 1 }}>$</span>
            <CountUp to={Number(value) || 0} formatter={moneyDigits} />
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
