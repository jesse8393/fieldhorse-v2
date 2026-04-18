// Fire-and-forget toast. Dispatches a CustomEvent that <Toaster/> listens for,
// AND forwards to Sonner so new code can opt into richer toasts without breaking
// existing callers that rely on the accent / heavy / destructive options.

import { toast as sonnerToast } from 'sonner'

const DEFAULT_DURATION = 4500
const HEAVY_DURATION = 6000 // destructive actions + auto-created entities

// Map legacy accent values to a Sonner variant so the dual-toaster tells the same story.
function variantFromAccent(accent) {
  if (accent === 'green' || accent === 'job' || accent === 'closed') return 'success'
  if (accent === 'red' || accent === 'lost') return 'error'
  return null
}

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

  // Sonner forward. Explicit variant wins; otherwise infer from accent.
  const variant = options.variant || variantFromAccent(detail.accent)
  const sonnerOpts = { description: options.description, duration: detail.duration }
  if (variant === 'success') sonnerToast.success(message, sonnerOpts)
  else if (variant === 'error') sonnerToast.error(message, sonnerOpts)
  else sonnerToast(message, sonnerOpts)
}

export const toastSuccess = (message, description) => toast(message, { variant: 'success', accent: 'green', description })
export const toastError = (message, description) => toast(message, { variant: 'error', accent: 'red', description })
export const toastInfo = (message, description) => toast(message, { description })

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

export { sonnerToast }
