import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from './icons/Icon.jsx'

const ACTIONS = [
  { id: 'home', label: 'Home', hint: 'Morning brief', icon: 'home', to: '/' },
  { id: 'jobs', label: 'Jobs', hint: 'Pipeline', icon: 'jobs', to: '/jobs' },
  { id: 'newLead', label: 'New lead', hint: 'Open pipeline card', icon: 'plus', to: '/jobs?new=1' },
  { id: 'notes', label: 'Field notes', hint: 'Capture anything', icon: 'notes', to: '/notes' },
  { id: 'voice', label: 'Voice capture', hint: 'Dictate a note', icon: 'mic', to: '/notes?voice=1' },
  { id: 'schedule', label: 'Schedule', hint: 'Day / week / month', icon: 'schedule', to: '/schedule' },
  { id: 'bid', label: 'AI Bid Engine', hint: 'Scope to number', icon: 'bid', to: '/bid' },
  { id: 'compose', label: 'AI Compose', hint: 'Draft a message', icon: 'compose', to: '/compose' },
  { id: 'analytics', label: 'Analytics', hint: 'Pipeline + margin', icon: 'analytics', to: '/analytics' },
  { id: 'import', label: 'Import data', hint: 'CSV + webhooks', icon: 'upload', to: '/import' },
  { id: 'settings', label: 'Settings', hint: 'Profile + billing', icon: 'settings', to: '/settings' }
]

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      } else if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (open) {
      setQ('')
      setCursor(0)
      setTimeout(() => inputRef.current?.focus(), 40)
    }
  }, [open])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return ACTIONS
    return ACTIONS.filter((a) => (a.label + ' ' + a.hint).toLowerCase().includes(needle))
  }, [q])

  function run(action) {
    setOpen(false)
    navigate(action.to)
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(filtered.length - 1, c + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(0, c - 1))
    } else if (e.key === 'Enter' && filtered[cursor]) {
      e.preventDefault()
      run(filtered[cursor])
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fh-cmdk"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            className="fh-cmdk__panel"
            role="dialog"
            aria-label="Command palette"
            initial={{ y: -8, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: -6, scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fh-cmdk__row">
              <Icon name="search" size={18} />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setCursor(0)
                }}
                onKeyDown={onKeyDown}
                placeholder="Jump to anywhere…"
                className="fh-cmdk__input"
                spellCheck={false}
                autoComplete="off"
              />
              <kbd className="fh-kbd">Esc</kbd>
            </div>
            <ul className="fh-cmdk__list" role="listbox">
              {filtered.length === 0 && (
                <li className="fh-cmdk__empty">Nothing matches.</li>
              )}
              {filtered.map((a, i) => (
                <li
                  key={a.id}
                  className={`fh-cmdk__item${i === cursor ? ' is-active' : ''}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => run(a)}
                  role="option"
                  aria-selected={i === cursor}
                >
                  <span className="fh-cmdk__icon">
                    <Icon name={a.icon} size={18} />
                  </span>
                  <span className="fh-cmdk__label">{a.label}</span>
                  <span className="fh-cmdk__hint">{a.hint}</span>
                </li>
              ))}
            </ul>
            <footer className="fh-cmdk__foot">
              <span>
                <kbd className="fh-kbd">↑</kbd>
                <kbd className="fh-kbd">↓</kbd> navigate
              </span>
              <span>
                <kbd className="fh-kbd">↵</kbd> open
              </span>
              <span>
                <kbd className="fh-kbd">⌘</kbd>
                <kbd className="fh-kbd">K</kbd> anywhere
              </span>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
