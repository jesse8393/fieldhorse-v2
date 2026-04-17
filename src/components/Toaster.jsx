import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// Mount once in AppShell. Listens for window 'fh:toast' events.
export default function Toaster() {
  const [items, setItems] = useState([])

  useEffect(() => {
    function onToast(e) {
      const t = e.detail
      setItems((prev) => [...prev, t])
      setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== t.id))
      }, t.duration)
    }
    window.addEventListener('fh:toast', onToast)
    return () => window.removeEventListener('fh:toast', onToast)
  }, [])

  return (
    <div className="fh-toaster" aria-live="polite" aria-atomic="true">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            className={`fh-toast fh-toast--${t.accent}`}
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            role="status"
          >
            <span className="fh-toast__dot" aria-hidden="true" />
            <span className="fh-toast__text">{t.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
