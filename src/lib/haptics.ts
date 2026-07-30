// Haptic feedback via navigator.vibrate. Silent no-op on desktop/unsupported.
// Short, mechanical pulses, match the "heavy truck door" feel the brand wants.
// Callers pick the intent, not the pattern: hapticTap for light touches,
// hapticMedium for primary commits, hapticSuccess/Error for outcomes,
// hapticSwipe for swipe reveals.

function vibrate(pattern: number | number[]) {
  if (typeof navigator === 'undefined') return
  if (typeof navigator.vibrate !== 'function') return
  // Respect user's reduce-motion preference, vibration counts as motion.
  if (typeof window !== 'undefined' && window.matchMedia) {
    const rm = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (rm && rm.matches) return
  }
  try { navigator.vibrate(pattern) } catch { /* swallow */ }
}

// Light confirmation, used on secondary taps (card open, tab switch).
export function hapticTap() { vibrate(8) }

// Medium commit, primary button press (Save, Generate, Send).
export function hapticMedium() { vibrate(16) }

// Success, Save succeeded, bid returned, partner invite accepted.
export function hapticSuccess() { vibrate([10, 30, 14]) }

// Error, failed save, validation error, network timeout.
export function hapticError() { vibrate([24, 50, 24]) }

// Swipe reveal, row-level swipe actions snap open.
export function hapticSwipe() { vibrate([4, 6, 4]) }

// Stage change, quote → job → invoice transitions. Heavier, confirming.
export function hapticStageChange() { vibrate([12, 8, 20]) }
