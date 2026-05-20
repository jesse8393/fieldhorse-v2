// src/components/v3/ScreenCloser.tsx
//
// A premium "you've reached the bottom" footer that closes off
// scrollable screens. Without this, every dashboard ends in a
// growing black void between the last data card and the bottom
// nav — the user's "fogginess / billion-dollar look" complaint.
//
// Two variants:
//   - "muted" (default): tiny brand mark + tagline, single-line.
//     Reads as a discreet finishing edge.
//   - "cta": same plus a single ghost button (e.g. "Add another
//     client") so empty-ish screens still offer a forward path.

import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'

type ScreenCloserProps = {
  variant?: 'muted' | 'cta'
  caption?: import('react').ReactNode
  ctaLabel?: import('react').ReactNode
  onCta?: () => void
}

export default function ScreenCloser({
  variant = 'muted',
  caption,
  ctaLabel,
  onCta
}: ScreenCloserProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.2, duration: 0.4 }}
      style={{
        // marginTop:auto inside a flex column pushes us to the
        // bottom of the viewport when the screen content is short.
        marginTop: 'auto',
        padding: '32px 20px 8px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 12,
        color: 'var(--v3-text-faint, var(--v3-text-muted))',
        textAlign: 'center'
      }}
    >
      {/* Hairline ruleset */}
      <div aria-hidden="true" style={{
        width: 48, height: 1,
        background: 'linear-gradient(90deg, transparent, var(--v3-border-strong), transparent)'
      }} />

      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontFamily: 'var(--font-body)',
        fontSize: 10, fontWeight: 700,
        letterSpacing: '0.18em', textTransform: 'uppercase',
        color: 'var(--v3-primary)'
      }}>
        <Sparkles size={11} aria-hidden="true" />
        FieldHorse
      </div>

      {caption && (
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 11, lineHeight: 1.5,
          color: 'var(--v3-text-muted)',
          maxWidth: 280
        }}>
          {caption}
        </div>
      )}

      {variant === 'cta' && ctaLabel && (
        <button
          type="button"
          onClick={onCta}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '9px 16px',
            borderRadius: 999,
            background: 'transparent',
            border: '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
            color: 'var(--v3-primary)',
            fontFamily: 'var(--font-body)',
            fontSize: 11, fontWeight: 700,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            cursor: 'pointer'
          }}
        >
          {ctaLabel}
        </button>
      )}
    </motion.div>
  )
}
