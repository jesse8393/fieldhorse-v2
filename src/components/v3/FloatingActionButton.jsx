import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import { hapticMedium } from '../../lib/haptics.ts'

/**
 * Canonical floating action button.
 *
 * Why a portal:
 *   The FAB is rendered with `position: fixed` so it should sit
 *   relative to the viewport. But every screen wraps its body in
 *   <motion.div className="v3-screen">, and framer-motion can apply
 *   transform / will-change: transform to that wrapper during entrance
 *   animations. Any ancestor with a transform creates a new
 *   containing block — `position: fixed` then resolves against the
 *   ancestor instead of the viewport, which is why the FAB was
 *   appearing clipped or off-center for some screens.
 *
 *   Rendering via createPortal(..., document.body) lifts the FAB out
 *   of the screen tree entirely, so `position: fixed` always
 *   resolves correctly to the viewport. Same fix used by V3PaymentSheet.
 *
 * Props:
 *   onClick         — required tap handler
 *   ariaLabel       — required accessible label (e.g., "New lead")
 *   icon            — optional ReactNode; defaults to a Plus glyph
 *   iconSize        — optional size for the default icon (default 26)
 *   hideOnDesktop   — Phase 2 desktop shell flag. When true, applies
 *                     .fh-fab--hide-desktop so the FAB collapses at
 *                     >=900px (where the screen now provides an inline
 *                     primary action button in its desktop header).
 *
 * Position is owned by the .fh-fab class in global.css:
 *   right: 20px;
 *   bottom: calc(96px + env(safe-area-inset-bottom, 0px));
 *   z-index: 40;
 *   width/height 56;
 * Single source of truth — change there to retune across the app.
 */
export default function FloatingActionButton({
  onClick,
  ariaLabel,
  icon,
  iconSize = 26,
  iconStrokeWidth = 2.6,
  hideOnDesktop = false
}) {
  if (typeof document === 'undefined') return null

  function handleClick(e) {
    hapticMedium()
    onClick?.(e)
  }

  const button = (
    <motion.button
      type="button"
      whileTap={{ scale: 0.94 }}
      onClick={handleClick}
      aria-label={ariaLabel}
      className={`fh-fab${hideOnDesktop ? ' fh-fab--hide-desktop' : ''}`}
    >
      {icon || <Plus size={iconSize} strokeWidth={iconStrokeWidth} />}
    </motion.button>
  )

  return createPortal(button, document.body)
}
