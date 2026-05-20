// Fire-and-forget toast. Dispatches a CustomEvent that <Toaster/> listens for,
// AND forwards to Sonner so new code can opt into richer toasts without breaking
// existing callers that rely on the accent / heavy / destructive options.

import { toast as sonnerToast } from 'sonner'

const DEFAULT_DURATION = 4500
const HEAVY_DURATION = 6000 // destructive actions + auto-created entities

export type ToastOptions = {
  accent?: string
  heavy?: boolean
  destructive?: boolean
  duration?: number
  variant?: 'success' | 'error' | null
  description?: string
}

// Map legacy accent values to a Sonner variant so the dual-toaster tells the same story.
function variantFromAccent(accent: string | undefined): 'success' | 'error' | null {
  if (accent === 'green' || accent === 'job' || accent === 'closed') return 'success'
  if (accent === 'red' || accent === 'lost') return 'error'
  return null
}

export function toast(message: string, options: ToastOptions = {}) {
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

export const toastSuccess = (message: string, description?: string) => toast(message, { variant: 'success', accent: 'green', description })
export const toastError = (message: string, description?: string) => toast(message, { variant: 'error', accent: 'red', description })
export const toastInfo = (message: string, description?: string) => toast(message, { description })

/**
 * toastUndo — destructive-action toast with an Undo button.
 *
 * Sonner action toast pattern: success-style toast with a label/onClick.
 * The host call is responsible for the actual undo work (typically
 * re-inserting the deleted row from a captured snapshot). Default 8s
 * window so the user has time to react after putting the phone down.
 *
 * Usage:
 *   const snapshot = { ...row }
 *   setRows(rs => rs.filter(r => r.id !== id))
 *   await supabase.from('foo').delete().eq('id', id)
 *   toastUndo('Deleted Henderson kitchen', {
 *     description: 'Tap Undo to restore',
 *     onUndo: async () => {
 *       await supabase.from('foo').insert(snapshot)
 *       setRows(rs => [snapshot, ...rs])
 *     }
 *   })
 */
export function toastUndo(message: string, { description, onUndo, duration = 8000 }: { description?: string; onUndo?: () => void | Promise<void>; duration?: number } = {}) {
  if (typeof window === 'undefined') return
  // Mirror to legacy fh:toast for the in-app Toaster panel
  const detail = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    message,
    accent: 'gold',
    duration
  }
  window.dispatchEvent(new CustomEvent('fh:toast', { detail }))
  // Sonner — the action button is the whole point
  sonnerToast(message, {
    description,
    duration,
    action: onUndo
      ? {
          label: 'Undo',
          onClick: async () => {
            try { await onUndo() } catch { /* host toasts its own error */ }
          }
        }
      : undefined
  })
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

export { sonnerToast }
