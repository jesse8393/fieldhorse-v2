// Fire-and-forget toast. Dispatches a CustomEvent that <Toaster/> listens for.

const DEFAULT_DURATION = 4500
const HEAVY_DURATION = 6000 // destructive actions + auto-created entities

export function toast(message, options = {}) {
  if (typeof window === 'undefined') return
  const heavy = options.heavy || options.destructive
  const detail = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    message,
    accent: options.accent || 'gold',   // gold | green | red | steel | stageId
    duration: options.duration ?? (heavy ? HEAVY_DURATION : DEFAULT_DURATION)
  }
  // eslint-disable-next-line no-console
  console.log(`[toast] ${detail.accent}: ${message}`)
  window.dispatchEvent(new CustomEvent('fh:toast', { detail }))
}

export function hapticSuccess() {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate([20, 50, 20]) } catch {}
  }
}

export function hapticMedium() {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate([12, 30, 12]) } catch {}
  }
}
