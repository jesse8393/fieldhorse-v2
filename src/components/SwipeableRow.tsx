import { useEffect, useRef, useState, type ReactNode } from 'react'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'
import { hapticSwipe, hapticTap } from '../lib/haptics.ts'

// Generic swipe-to-reveal wrapper. Pass `actions` (array of {icon, label, color, onClick})
// and the wrapped children. Swipe-left reveals the actions; a tap anywhere outside the
// row (including starting a swipe on another row) or a swipe-right snaps it back closed.
// Designed for list rows, Jobs, Notes, Clients.
//
// Snap points:
//   * 0      → closed
//   * -120   → fully open (3 actions visible at 40px each)
//
// Pass-through: tap on the row content while not swiped fires children's normal handlers.
// While swiped open, the action buttons capture taps.

type SwipeAction = {
  icon: ReactNode
  label: string
  color?: string
  fg?: string
  onClick?: () => void
}

type SwipeableRowProps = {
  children: ReactNode
  actions?: SwipeAction[]
  openOffset?: number
  disabled?: boolean
}

// Same spring family as the rest of the app's sheets and tabs.
const SNAP_SPRING = { type: 'spring' as const, stiffness: 400, damping: 30 }

export default function SwipeableRow({ children, actions = [], openOffset = -120, disabled = false }: SwipeableRowProps) {
  const x = useMotionValue(0)
  const [open, setOpen] = useState(false)
  const lastFiredOpen = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  // Animated background visibility, actions only show when row is dragged
  const actionsOpacity = useTransform(x, [openOffset, openOffset / 2, 0], [1, 0.5, 0])

  // Settle on a snap point. animate() stops the drag's own inertia
  // animation first; a plain x.set() was overwritten by that inertia on
  // the next frame, so the row came to rest wherever momentum left it.
  function snapTo(target: number, velocity = 0) {
    if (reduceMotion) {
      x.jump(target)
      return
    }
    animate(x, target, { ...SNAP_SPRING, velocity })
  }

  function handleDragEnd(_: unknown, info: { offset: { x: number }; velocity: { x: number } }) {
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
    snapTo(target, velocity)
  }

  function close() {
    snapTo(0)
    setOpen(false)
    lastFiredOpen.current = false
  }

  // While open, any press outside this row closes it, so only one row
  // shows its actions at a time. Capture phase, so it still runs when the
  // pressed element stops propagation.
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      const root = rootRef.current
      if (root && e.target instanceof Node && root.contains(e.target)) return
      closeRef.current()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open])

  if (disabled || actions.length === 0) {
    return <div>{children}</div>
  }

  return (
    <div ref={rootRef} style={{ position: 'relative', overflow: 'hidden', borderRadius: 10, width: '100%' }}>
      {/* Reveal action layer, sits behind the draggable content */}
      <motion.div
        aria-hidden={!open}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          gap: 4,
          padding: '8px 8px',
          alignItems: 'center',
          justifyContent: 'flex-end',
          opacity: actionsOpacity
        }}
      >
        {actions.map((a, i) => (
          <button
            key={i}
            type="button"
            tabIndex={open ? 0 : -1}
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
              background: a.color || 'rgba(201, 150, 58, 0.18)',
              border: '1px solid var(--v3-border-mid)',
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
