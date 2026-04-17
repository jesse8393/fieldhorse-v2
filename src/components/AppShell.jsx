import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import BottomNav from './BottomNav.jsx'
import CommandPalette from './CommandPalette.jsx'

export default function AppShell() {
  const location = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [location.pathname])

  return (
    <div className="fh-app">
      <div className="fh-page-corners" aria-hidden="true">
        <span className="fh-corner fh-corner--tl" />
        <span className="fh-corner fh-corner--tr" />
        <span className="fh-corner fh-corner--bl" />
        <span className="fh-corner fh-corner--br" />
      </div>
      <AnimatePresence mode="wait">
        <motion.main
          key={location.pathname}
          className="fh-app__main"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <Outlet />
        </motion.main>
      </AnimatePresence>
      <BottomNav />
      <CommandPalette />
    </div>
  )
}
