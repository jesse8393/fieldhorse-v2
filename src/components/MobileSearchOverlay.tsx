import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Search as SearchIcon, Briefcase, Users, FileText, Calendar, Paperclip,
  ChevronRight
} from 'lucide-react'
import { universalSearch } from '../lib/universalSearch.ts'
import { useAuth } from '../contexts/AuthContext.tsx'

// Mobile-native search overlay — replaces CommandPalette on phone widths
// (the cmdk popover renders clipped on iOS Safari + Chrome behind the
// keyboard / status-bar; see AppHeader comment for the old workaround).
//
// Behavior:
//   - listens for the same window event the desktop palette listens to
//     (`fh:open-palette`), so AppHeader's search button works for both
//   - only opens when window.innerWidth < 900 (CommandPalette gates on
//     >=900 so we never get a dual-open)
//   - full-screen sheet, sticky search input at top, auto-focuses on open
//   - results grouped by entity (jobs / clients / notes / events / files)
//   - tap result → navigate + close; Escape / tap scrim / X also close
//
// Uses the existing universalSearch lib so result shapes + RLS scoping
// stay shared with the desktop palette.

const MOBILE_BREAKPOINT = 900
const DEBOUNCE_MS = 200

const KIND_META: Record<string, any> = {
  job:    { Icon: Briefcase,  heading: 'Jobs' },
  client: { Icon: Users,      heading: 'Clients' },
  note:   { Icon: FileText,   heading: 'Notes' },
  event:  { Icon: Calendar,   heading: 'Schedule' },
  file:   { Icon: Paperclip,  heading: 'Files' }
}

const GROUP_ORDER = ['jobs', 'clients', 'notes', 'events', 'files']
const GROUP_TO_KIND: Record<string, any> = {
  jobs: 'job', clients: 'client', notes: 'note', events: 'event', files: 'file'
}

export default function MobileSearchOverlay() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any>(null) // null = idle, {} = empty results
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<any>(null)
  const navigate = useNavigate()
  const { user } = useAuth()

  // Window event from AppHeader. Only honor it on phone widths so we
  // don't fight the desktop CommandPalette (it self-gates on >=900).
  useEffect(() => {
    function onOpen() {
      if (typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT) {
        setOpen(true)
      }
    }
    window.addEventListener('fh:open-palette', onOpen)
    return () => window.removeEventListener('fh:open-palette', onOpen)
  }, [])

  // Reset on close so the next open is a clean surface.
  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults(null)
      setSearching(false)
      return
    }
    // Lock body scroll while open.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Auto-focus input shortly after open so iOS's keyboard animation
  // doesn't fight the slide-in.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => { inputRef.current?.focus() }, 220)
    return () => clearTimeout(t)
  }, [open])

  // Escape closes.
  useEffect(() => {
    if (!open) return
    function onKey(e: any) {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Debounced query → universalSearch.
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) { setResults(null); setSearching(false); return }
    setSearching(true)
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const data = await universalSearch(q, user?.id)
        if (!cancelled) setResults(data)
      } catch {
        if (!cancelled) setResults({ jobs: [], clients: [], notes: [], events: [], files: [], total: 0 })
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, open, user?.id])

  const handleGo = useCallback((to: any) => {
    setOpen(false)
    // Allow the close animation to settle before navigating so the
    // screen swap doesn't unmount the overlay mid-exit.
    setTimeout(() => navigate(to), 60)
  }, [navigate])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="fh-msearch"
          role="dialog"
          aria-modal="true"
          aria-label="Search"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(8, 7, 5, 0.86)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            display: 'flex', flexDirection: 'column'
          }}
          onClick={(e) => {
            // Tap the scrim background → close. Inner content stops
            // propagation so taps inside don't bubble up here.
            if (e.target === e.currentTarget) setOpen(false)
          }}
        >
          <motion.div
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -8, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'flex', flexDirection: 'column',
              height: '100%', width: '100%',
              maxWidth: 560, margin: '0 auto'
            }}
          >
            {/* Sticky search header. The padding shorthand has to
                merge the safe-area-inset-top inline — declaring
                paddingTop above a padding shorthand is a no-op
                because the shorthand wins, which buried the close
                button + input under the iOS status bar / Dynamic
                Island. */}
            <div
              style={{
                padding: 'calc(env(safe-area-inset-top, 0px) + 10px) 14px 12px',
                display: 'flex', alignItems: 'center', gap: 8
              }}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close search"
                style={{
                  width: 38, height: 38, borderRadius: 10,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  display: 'grid', placeItems: 'center',
                  color: 'var(--v3-text)', cursor: 'pointer', padding: 0
                }}
              >
                <X size={18} />
              </button>
              <div
                style={{
                  flex: 1, position: 'relative',
                  display: 'flex', alignItems: 'center'
                }}
              >
                <SearchIcon
                  size={16}
                  aria-hidden="true"
                  style={{
                    position: 'absolute', left: 12,
                    color: 'var(--v3-text-muted)', pointerEvents: 'none'
                  }}
                />
                <input
                  ref={inputRef}
                  type="search"
                  inputMode="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search jobs, clients, notes, events, files…"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '11px 14px 11px 36px',
                    background: 'var(--v3-surface-2)',
                    border: '1px solid var(--v3-border-strong)',
                    borderRadius: 10,
                    color: 'var(--v3-text)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 14,
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            {/* Scrollable result body */}
            <div
              style={{
                flex: 1, minHeight: 0,
                overflowY: 'auto', overflowX: 'hidden',
                padding: '4px 14px calc(env(safe-area-inset-bottom, 0px) + 28px)'
              }}
            >
              {!query.trim() && <IdleHint />}
              {query.trim() && searching && (
                <EmptyState text="Searching…" />
              )}
              {query.trim() && !searching && results && results.total === 0 && (
                <EmptyState text={`Nothing matched "${query.trim()}".`} />
              )}
              {query.trim() && results && results.total > 0 && (
                <ResultsList results={results} onGo={handleGo} />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

function IdleHint() {
  return (
    <div style={{
      padding: '40px 18px',
      textAlign: 'center',
      color: 'var(--v3-text-muted)',
      fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.5
    }}>
      Type to search jobs, clients, notes, events, and files.
    </div>
  )
}

function EmptyState({ text }: any) {
  return (
    <div style={{
      padding: '32px 18px',
      textAlign: 'center',
      color: 'var(--v3-text-muted)',
      fontFamily: 'var(--font-body)', fontSize: 13
    }}>
      {text}
    </div>
  )
}

function ResultsList({ results, onGo }: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
      {GROUP_ORDER.map((groupKey) => {
        const items = results[groupKey] || []
        if (items.length === 0) return null
        const meta = KIND_META[GROUP_TO_KIND[groupKey]]
        return (
          <section key={groupKey}>
            <div
              style={{
                padding: '0 6px 6px',
                fontFamily: 'var(--font-body)',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.16em',
                color: 'var(--v3-text-muted)',
                textTransform: 'uppercase'
              }}
            >
              {meta.heading}
            </div>
            <ul
              role="list"
              style={{
                listStyle: 'none', margin: 0, padding: 0,
                display: 'flex', flexDirection: 'column', gap: 6
              }}
            >
              {items.map((it: any) => (
                <ResultRow key={it.id} item={it} onGo={onGo} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function ResultRow({ item, onGo }: any) {
  const meta = KIND_META[item.kind] || KIND_META.note
  const Icon = meta.Icon
  return (
    <li>
      <button
        type="button"
        onClick={() => onGo(item.to)}
        style={{
          width: '100%',
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '11px 12px',
          background: 'var(--v3-surface)',
          border: '1px solid var(--v3-border)',
          borderRadius: 12,
          color: 'var(--v3-text)',
          cursor: 'pointer',
          textAlign: 'left',
          minHeight: 56,
          WebkitTapHighlightColor: 'transparent'
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'var(--v3-primary-soft)',
            border: '1px solid var(--v3-border-gold)',
            color: 'var(--v3-primary-bright)',
            display: 'grid', placeItems: 'center',
            flexShrink: 0
          }}
        >
          <Icon size={15} />
        </span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span
            style={{
              fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600,
              color: 'var(--v3-text)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            }}
          >
            {item.title}
          </span>
          {item.sub && (
            <span
              style={{
                fontFamily: 'var(--font-body)', fontSize: 12,
                color: 'var(--v3-text-muted)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
              }}
            >
              {item.sub}
            </span>
          )}
        </span>
        <ChevronRight size={14} color="var(--v3-text-muted)" style={{ flexShrink: 0 }} />
      </button>
    </li>
  )
}
