import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { hapticTap } from '../lib/haptics.ts'

/**
 * ConfirmSheet, premium black-glass replacement for window.confirm().
 *
 * window.confirm() renders the browser-chrome dialog (the "deploy-
 * preview-9.netlify.app says ..." popup), which:
 *   - looks like a website alert, not an app
 *   - exposes the deploy URL to the user
 *   - blocks the JS thread
 *   - has no theming
 *
 * This primitive provides the same sync-feeling Promise<boolean>
 * affordance via a context provider + hook, but renders in our
 * design system: black-glass surface, gold primary or red destructive
 * button, drag handle, escape-to-cancel.
 *
 * Usage:
 *   const confirm = useConfirm()
 *   if (await confirm({ title: 'Delete this note?', body: 'This cannot be undone.', destructive: true })) {
 *     // user confirmed
 *   }
 *
 * Mount once at the app root via <ConfirmProvider>.
 */

const ConfirmContext = createContext<any>(null)

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    // Defensive fallback so a missing provider doesn't crash the app :
    // degrades to window.confirm so the call site still works.
    return ({ title, body }: any) => Promise.resolve(window.confirm(`${title}\n\n${body || ''}`))
  }
  return ctx
}

export function ConfirmProvider({ children }: any) {
  const [state, setState] = useState<any>(null)
  const resolverRef = useRef<any>(null)

  const confirm = useCallback((opts: any) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve
      setState({
        title: opts?.title || 'Are you sure?',
        body: opts?.body || '',
        confirmLabel: opts?.confirmLabel || (opts?.destructive ? 'Delete' : 'Confirm'),
        cancelLabel: opts?.cancelLabel || 'Cancel',
        destructive: !!opts?.destructive
      })
    })
  }, [])

  function close(value: any) {
    if (resolverRef.current) {
      resolverRef.current(value)
      resolverRef.current = null
    }
    setState(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmSheet state={state} onCancel={() => close(false)} onConfirm={() => close(true)} />
    </ConfirmContext.Provider>
  )
}

function ConfirmSheet({ state, onCancel, onConfirm }: any) {
  const open = !!state
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  // Keep onCancel current without re-running the open effect (the provider
  // passes a fresh arrow each render). Re-running would clobber restoreRef
  // with a focus target inside the dialog and lose the real caller element.
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  // Focus management + escape + Tab trap. Runs only on the open→closed
  // transition so the restore target is captured once (before focus moves
  // into the dialog) and returned to on close. Dependency-free.
  useEffect(() => {
    if (!open) return
    restoreRef.current = (document.activeElement as HTMLElement | null) ?? null
    // Move focus into the dialog after it mounts/animates in.
    const raf = requestAnimationFrame(() => {
      (cancelRef.current ?? dialogRef.current)?.focus()
    })

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancelRef.current?.()
        return
      }
      if (e.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('disabled'))
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKeyDown)
      // Restore focus to whatever was focused before the dialog opened.
      const el = restoreRef.current
      if (el && typeof el.focus === 'function') el.focus()
      restoreRef.current = null
    }
  }, [open])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {state && (
        <>
          <motion.div
            onPointerDown={(e) => { e.preventDefault(); onCancel() }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(20, 20, 20, 0.62)',
              zIndex: 90, touchAction: 'none'
            }}
          />
          <motion.div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="fh-confirm-title"
            tabIndex={-1}
            onPointerDown={(e) => e.stopPropagation()}
            initial={{ y: '100%', opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            style={{
              position: 'fixed',
              left: 0, right: 0, bottom: 0,
              maxWidth: 480, margin: '0 auto',
              background: 'var(--v3-surface-2)',
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
              border: '1px solid var(--v3-border)',
              borderBottom: 'none',
              zIndex: 91,
              boxShadow: '0 -20px 60px -12px rgba(20, 20, 20, 0.55)',
              padding: '12px 24px max(24px, env(safe-area-inset-bottom))',
              display: 'flex', flexDirection: 'column', gap: 12
            }}
          >
            <div aria-hidden="true" style={{
              width: 44, height: 4, background: 'var(--v3-border-strong)',
              borderRadius: 10, margin: '0 auto 6px',
              flexShrink: 0
            }} />
            <h3
              id="fh-confirm-title"
              style={{
                margin: 0,
                fontFamily: 'var(--font-body)',
                fontSize: 20, fontWeight: 700,
                color: 'var(--v3-text)',
                letterSpacing: 0,
                lineHeight: 1.3
              }}
            >
              {state.title}
            </h3>
            {state.body && (
              <p style={{
                margin: 0,
                fontFamily: 'var(--font-body)',
                fontSize: 14, lineHeight: 1.5,
                color: 'var(--v3-text-muted)'
              }}>
                {state.body}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button
                ref={cancelRef}
                type="button"
                onClick={() => { hapticTap(); onCancel() }}
                style={{
                  flex: 1, minHeight: 48,
                  padding: '12px', borderRadius: 10,
                  background: 'transparent',
                  border: '1px solid var(--v3-border)',
                  color: 'var(--v3-text)',
                  fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600,
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                  touchAction: 'manipulation'
                }}
              >
                {state.cancelLabel}
              </button>
              <button
                type="button"
                onClick={() => { hapticTap(); onConfirm() }}
                style={{
                  flex: 1, minHeight: 48,
                  padding: '12px', borderRadius: 10,
                  border: 'none',
                  background: state.destructive
                    ? 'var(--v3-danger)'
                    : 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
                  color: state.destructive ? '#F2EDE4' : 'var(--v3-on-primary)',
                  fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700,
                  letterSpacing: 0,
                  cursor: 'pointer',
                  boxShadow: state.destructive
                    ? '0 4px 12px rgba(192, 57, 43, 0.32)'
                    : '0 0 0 3px rgba(201, 150, 58, 0.10), 0 4px 12px rgba(201, 150, 58, 0.18), 0 1px 0 var(--v3-border-strong) inset',
                  WebkitTapHighlightColor: 'transparent',
                  touchAction: 'manipulation'
                }}
              >
                {state.confirmLabel}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  )
}
