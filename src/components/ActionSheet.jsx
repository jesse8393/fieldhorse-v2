import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'

const EASE = [0.16, 1, 0.3, 1]
const DUR = 0.5

export function haptic(pattern = 10) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(pattern) } catch {}
  }
}

function splitAccent(title, accentWord) {
  if (!accentWord) return { before: title, accent: '', after: '' }
  const idx = title.toLowerCase().indexOf(accentWord.toLowerCase())
  if (idx < 0) return { before: title, accent: '', after: '' }
  return {
    before: title.slice(0, idx),
    accent: title.slice(idx, idx + accentWord.length),
    after: title.slice(idx + accentWord.length)
  }
}

export default function ActionSheet({
  open,
  title,
  accentWord,
  sectionLabel = 'Capture',
  stepCount = 3,
  currentStep = 1,
  commitLabel = 'Commit',
  commitBusy = false,
  commitDisabled = false,
  destructive = false,
  onClose,
  onCommit,
  children
}) {
  const sheetRef = useRef(null)
  const bodyRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onClose?.() }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleCommit() }
    }
    window.addEventListener('keydown', handleKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handleKey)
      document.body.style.overflow = prev
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose])

  // visualViewport — track real viewport height and keyboard height.
  // Sets --fh-vvh + --fh-kbd CSS vars on the sheet element.
  useEffect(() => {
    if (!open) return
    const vv = window.visualViewport
    const el = sheetRef.current
    if (!el || !vv) return
    function update() {
      const vvh = vv.height
      const kbd = Math.max(0, window.innerHeight - vvh - (vv.offsetTop || 0))
      el.style.setProperty('--fh-vvh', `${vvh}px`)
      el.style.setProperty('--fh-kbd', kbd > 40 ? `${kbd}px` : '0px')
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      el.style.removeProperty('--fh-vvh')
      el.style.removeProperty('--fh-kbd')
    }
  }, [open])

  // Scroll the focused field into view inside the sheet body when keyboard opens.
  useEffect(() => {
    if (!open) return
    const body = bodyRef.current
    if (!body) return
    function onFocusIn(e) {
      const t = e.target
      if (!t || !(t.matches?.('input, textarea, select'))) return
      setTimeout(() => {
        try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch {}
      }, 260)
    }
    body.addEventListener('focusin', onFocusIn)
    return () => body.removeEventListener('focusin', onFocusIn)
  }, [open])

  function handleCommit() {
    if (commitBusy || commitDisabled) return
    haptic([20, 50, 20])
    onCommit?.()
  }

  const { before, accent, after } = splitAccent(title, accentWord)

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fh-asheet-root">
          <motion.div
            className="fh-asheet__scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DUR, ease: EASE }}
            onClick={onClose}
          />
          <motion.div
            ref={sheetRef}
            className="fh-asheet"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: DUR, ease: EASE }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            dragMomentum={false}
            onDragEnd={(_, info) => {
              if (info.offset.y > 140 || info.velocity.y > 500) onClose?.()
            }}
          >
            <div className="fh-asheet__handle" aria-hidden="true" />
            <header className="fh-asheet__head">
              <div className="fh-asheet__headMeta">
                <span className="fh-sec-tag fh-asheet__sectag">
                  <span className="fh-sec-tag__num">
                    {String(currentStep).padStart(2, '0')} / {String(stepCount).padStart(2, '0')}
                  </span>
                  <span className="fh-sec-tag__label">{sectionLabel}</span>
                </span>
                <h2 className="fh-asheet__title">
                  {before}
                  {accent && <span className="fh-asheet__title-accent">{accent}</span>}
                  {after}
                </h2>
              </div>
              <button
                type="button"
                className="fh-asheet__close"
                onClick={onClose}
                aria-label="Close"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6 L18 18 M18 6 L6 18" />
                </svg>
              </button>
            </header>

            <div className="fh-asheet__progress" aria-hidden="true">
              {Array.from({ length: stepCount }, (_, i) => (
                <span
                  key={i}
                  className={`fh-asheet__dot${i + 1 <= currentStep ? ' is-on' : ''}`}
                />
              ))}
            </div>

            <div className="fh-asheet__body" ref={bodyRef}>
              {children}
            </div>

            <footer className="fh-asheet__foot">
              <button
                type="button"
                className={`fh-btn ${destructive ? 'fh-btn--danger-solid' : 'fh-btn--primary'} fh-asheet__commit${commitBusy ? ' is-committing' : ''}${destructive ? ' is-destructive' : ''}`}
                onClick={handleCommit}
                disabled={commitBusy || commitDisabled}
              >
                <span className="fh-asheet__commit-label">
                  {commitBusy ? (destructive ? 'Deleting…' : 'Committing…') : commitLabel}
                </span>
              </button>
              <p className="fh-asheet__hint">
                <span>Enter</span> · to submit&nbsp;&nbsp;·&nbsp;&nbsp;<span>Esc</span> · to cancel
              </p>
            </footer>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export function SheetField({ label, code, children }) {
  return (
    <label className="fh-asheet-field">
      <span className="fh-asheet-field__k">
        {label}
        {code && <span className="fh-asheet-field__code">{code}</span>}
      </span>
      {children}
    </label>
  )
}

export function SheetChipRow({ label, value, options, onChange, code }) {
  return (
    <div className="fh-asheet-field">
      <span className="fh-asheet-field__k">
        {label}
        {code && <span className="fh-asheet-field__code">{code}</span>}
      </span>
      <div className="fh-asheet-chips" role="radiogroup" aria-label={label}>
        {options.map((opt) => {
          const on = value === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={on}
              className={`fh-asheet-chip${on ? ' is-on' : ''}`}
              onClick={() => { haptic(8); onChange?.(opt.value) }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function SheetMoneyField({ label, value, onChange, code, placeholder = '0' }) {
  return (
    <label className="fh-asheet-field">
      <span className="fh-asheet-field__k">
        {label}
        {code && <span className="fh-asheet-field__code">{code}</span>}
      </span>
      <div className="fh-asheet-money">
        <span className="fh-asheet-money__prefix">$</span>
        <input
          type="text"
          inputMode="decimal"
          className="fh-asheet-money__input"
          value={value}
          onChange={(e) => onChange?.(e.target.value.replace(/[^\d.]/g, ''))}
          placeholder={placeholder}
        />
      </div>
    </label>
  )
}
