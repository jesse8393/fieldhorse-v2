// Fire-and-forget toast. Dispatches a CustomEvent that <Toaster/> listens for.

export function toast(message, options = {}) {
  if (typeof window === 'undefined') return
  const detail = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    message,
    accent: options.accent || 'gold',   // gold | green | red | steel | stageId
    duration: options.duration ?? 3000
  }
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
