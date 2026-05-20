import { useRef, useState } from 'react'
import { motion, useMotionValue, useTransform } from 'framer-motion'
import { hapticSwipe, hapticTap } from '../lib/haptics.ts'

// Generic swipe-to-reveal wrapper. Pass `actions` (array of {icon, label, color, onClick})
// and the wrapped children. Swipe-left reveals the actions; tap outside or swipe-right
// snaps it back closed. Designed for list rows — Jobs, Notes, Clients.
//
// Snap points:
//   * 0      → closed
//   * -120   → fully open (3 actions visible at 40px each)
//
// Pass-through: tap on the row content while not swiped fires children's normal handlers.
// While swiped open, the action buttons capture taps.

export default function SwipeableRow({ children, actions = [], openOffset = -120, disabled = false }: any) {
  const x = useMotionValue(0)
  const [open, setOpen] = useState(false)
  const lastFiredOpen = useRef(false)
  // Animated background visibility — actions only show when row is dragged
  const actionsOpacity = useTransform(x, [openOffset, openOffset / 2, 0], [1, 0.5, 0])

  function handleDragEnd(_: any, info: any) {
    const offset = info.offset.x
    const velocity = info.velocity.x
    // Snap to fully open if dragged past midpoint or flicked left
    const shouldOpen = (offset < openOffset / 2) || velocity < -300
    const target = shouldOpen ? openOffset : 0
    if (shouldOpen && !lastFiredOpen.current) {
      hapticSwipe()
      lastFiredOpen.current = true
    } else if (!shouldOpen) {
      lastFiredOpen.current = false
    }
    setOpen(shouldOpen)
    // Animate to snapped position
    x.set(target)
  }

  function close() {
    x.set(0)
    setOpen(false)
    lastFiredOpen.current = false
  }

  if (disabled || actions.length === 0) {
    return <div>{children}</div>
  }

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 14, width: '100%' }}>
      {/* Reveal action layer — sits behind the draggable content */}
      <motion.div
        aria-hidden={!open}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          gap: 4,
          padding: '6px 6px',
          alignItems: 'center',
          justifyContent: 'flex-end',
          opacity: actionsOpacity
        }}
      >
        {actions.map((a: any, i: any) => (
          <button
            key={i}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              hapticTap()
              a.onClick?.()
              close()
            }}
            aria-label={a.label}
            style={{
              display: 'grid',
              placeItems: 'center',
              width: 44,
              height: 44,
              borderRadius: 10,
              background: a.color || 'rgba(199, 164, 90, 0.18)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: a.fg || 'var(--ink-strong)',
              cursor: 'pointer'
            }}
          >
            {a.icon}
          </button>
        ))}
      </motion.div>

      {/* Draggable content layer */}
      <motion.div
        drag="x"
        dragConstraints={{ left: openOffset, right: 0 }}
        dragElastic={{ left: 0.05, right: 0.05 }}
        dragTransition={{ bounceStiffness: 400, bounceDamping: 28 }}
        style={{ x, position: 'relative', zIndex: 1 }}
        onDragEnd={handleDragEnd}
        onClick={(e) => {
          if (open) {
            e.stopPropagation()
            close()
          }
        }}
      >
        {children}
      </motion.div>
    </div>
  )
}
