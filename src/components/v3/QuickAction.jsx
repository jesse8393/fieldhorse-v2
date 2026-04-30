import { motion } from 'framer-motion'
import { hapticTap } from '../../lib/haptics.js'

export default function QuickAction({ icon: Icon, label, primary = false, onTap }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 500, damping: 28 }}
      onClick={() => { hapticTap(); onTap && onTap() }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '14px 8px',
        borderRadius: 'var(--v3-radius-card)',
        background: primary
          ? 'linear-gradient(180deg, rgba(212,175,55,0.14), rgba(212,175,55,0.04))'
          : 'var(--v3-surface-2)',
        border: `1px solid ${primary ? 'rgba(212,175,55,0.35)' : 'var(--v3-border)'}`,
        color: 'var(--v3-text)',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        minHeight: 88
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 36,
          height: 36,
          borderRadius: 12,
          display: 'grid',
          placeItems: 'center',
          background: primary ? 'rgba(212,175,55,0.18)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${primary ? 'rgba(212,175,55,0.40)' : 'var(--v3-border)'}`,
          color: primary ? 'var(--v3-primary)' : 'var(--v3-text)'
        }}
      >
        <Icon size={18} strokeWidth={2.2} />
      </span>
      <span
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '-0.005em',
          textAlign: 'center',
          lineHeight: 1.2,
          color: primary ? 'var(--v3-primary)' : 'var(--v3-text)'
        }}
      >
        {label}
      </span>
    </motion.button>
  )
}
