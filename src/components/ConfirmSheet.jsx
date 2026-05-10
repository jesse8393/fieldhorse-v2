import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { hapticTap } from '../lib/haptics.js'

/**
 * ConfirmSheet — premium black-glass replacement for window.confirm().
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

const ConfirmContext = createContext(null)

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    // Defensive fallback so a missing provider doesn't crash the app —
    // degrades to window.confirm so the call site still works.
    return ({ title, body }) => Promise.resolve(window.confirm(`${title}\n\n${body || ''}`))
  }
  return ctx
}

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null)
  const resolverRef = useRef(null)

  const confirm = useCallback((opts) => {
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

  function close(value) {
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

function ConfirmSheet({ state, onCancel, onConfirm }) {
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
              background: 'rgba(0, 0, 0, 0.62)',
              zIndex: 90, touchAction: 'none'
            }}
          />
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="fh-confirm-title"
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
              boxShadow: '0 -20px 60px -12px rgba(0, 0, 0, 0.55)',
              padding: '10px 20px max(20px, env(safe-area-inset-bottom))',
              display: 'flex', flexDirection: 'column', gap: 14
            }}
          >
            <div aria-hidden="true" style={{
              width: 44, height: 4, background: 'var(--v3-border-strong)',
              borderRadius: 999, margin: '0 auto 6px',
              flexShrink: 0
            }} />
            <h3
              id="fh-confirm-title"
              style={{
                margin: 0,
                fontFamily: 'var(--font-body)',
                fontSize: 18, fontWeight: 700,
                color: 'var(--v3-text)',
                letterSpacing: '-0.01em',
                lineHeight: 1.3
              }}
            >
              {state.title}
            </h3>
            {state.body && (
              <p style={{
                margin: 0,
                fontFamily: 'var(--font-body)',
                fontSize: 13, lineHeight: 1.5,
                color: 'var(--v3-text-muted)'
              }}>
                {state.body}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => { hapticTap(); onCancel() }}
                style={{
                  flex: 1, minHeight: 48,
                  padding: '12px', borderRadius: 12,
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
                  padding: '12px', borderRadius: 12,
                  border: 'none',
                  background: state.destructive
                    ? 'var(--v3-danger)'
                    : 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
                  color: state.destructive ? '#fff' : 'var(--v3-on-primary)',
                  fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700,
                  letterSpacing: '0.04em',
                  cursor: 'pointer',
                  boxShadow: state.destructive
                    ? '0 4px 12px rgba(192, 57, 43, 0.32)'
                    : '0 0 0 3px rgba(229, 193, 88, 0.10), 0 4px 12px rgba(229, 193, 88, 0.18), 0 1px 0 rgba(255, 255, 255, 0.30) inset',
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
