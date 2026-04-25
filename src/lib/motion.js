// Shared motion variants. Wraps framer-motion's useReducedMotion so every
// screen automatically falls flat when the user has Reduce Motion enabled,
// without disabling the entrance fades — opacity stays at 1 (already
// visible), and spring offsets are zero.

import { useReducedMotion } from 'framer-motion'

export function useFhMotion() {
  const reduced = useReducedMotion()

  const stagger = reduced
    ? {
        hidden: { opacity: 1 },
        show: { opacity: 1 }
      }
    : {
        hidden: { opacity: 0 },
        show: {
          opacity: 1,
          transition: { staggerChildren: 0.06, delayChildren: 0.06 }
        }
      }

  const item = reduced
    ? {
        hidden: { opacity: 1, y: 0 },
        show: { opacity: 1, y: 0 }
      }
    : {
        hidden: { opacity: 0, y: 10 },
        show: {
          opacity: 1,
          y: 0,
          transition: { type: 'spring', stiffness: 220, damping: 26 }
        }
      }

  return { stagger, item, reduced }
}
