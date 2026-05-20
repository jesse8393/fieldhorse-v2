import { motion } from 'framer-motion'
import { hapticTap } from '../../lib/haptics.ts'

// QuickAction — single Home tile in the 5-up launcher row.
//
// Visual: ALL tiles share the same surface treatment so the row reads
// as a uniform launcher. `primary` was previously a full gold gradient
// across the whole tile (background + border + icon + label), which
// made the Add Lead tile look like it was stuck in a pressed state —
// "yellow and stuck" per user feedback. Now `primary` only adds a
// subtle gold accent to the icon tile; the surrounding tile, border,
// and label are identical to non-primary tiles.
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
        background: 'var(--v3-surface-2)',
        border: '1px solid var(--v3-border)',
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
          background: primary
            ? 'color-mix(in srgb, var(--v3-primary) 14%, transparent)'
            : 'rgba(255,255,255,0.04)',
          border: `1px solid ${primary
            ? 'color-mix(in srgb, var(--v3-primary) 32%, transparent)'
            : 'var(--v3-border)'}`,
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
          color: 'var(--v3-text)'
        }}
      >
        {label}
      </span>
    </motion.button>
  )
}
