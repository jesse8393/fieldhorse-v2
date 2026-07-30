// Shared motion variants. Wraps framer-motion's useReducedMotion so every
// screen automatically falls flat when the user has Reduce Motion enabled,
// without disabling the entrance fades, opacity stays at 1 (already
// visible), and spring offsets are zero.
//
// Phase 3C, animation freeze defense:
//   The parent .v3-screen wrapper now stays at opacity:1 in BOTH variants.
//   It used to start at opacity:0 with no fixed-duration transition, which
//   meant a Suspense / hot-reload / tab-background race could leave the
//   parent stuck at opacity:0, children invisible regardless of their
//   own animations, the entire screen black until a scroll/wheel event
//   re-kicked the rAF loop. Children still stagger in via the `item`
//   variant (their own opacity 0 → 1 with a fixed-duration tween), so
//   the entry feel is preserved without the failure mode.

import { useReducedMotion, type Variants } from 'framer-motion'

export function useFhMotion(): { stagger: Variants; item: Variants; reduced: boolean | null } {
  const reduced = useReducedMotion()

  // Parent never fades. `staggerChildren` still cascades the children.
  const stagger = reduced
    ? {
        hidden: { opacity: 1 },
        show: { opacity: 1 }
      }
    : {
        hidden: { opacity: 1 },
        show: {
          opacity: 1,
          transition: { staggerChildren: 0.06, delayChildren: 0.04 }
        }
      }

  // Children still get the fade + slide-in. Switched from spring → fixed
  // tween so a stalled rAF loop can't leave a child at opacity:0.5
  // forever; the tween commits its target on the next frame the loop
  // wakes up regardless of partial progress.
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
          transition: { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }
        }
      }

  return { stagger, item, reduced }
}
