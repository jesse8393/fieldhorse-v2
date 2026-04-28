import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Plus, Calendar as CalendarIcon, Clock, MapPin, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { toast, toastSuccess, toastUndo, toastError } from '../lib/toast.js'
import ActionSheet, { SheetField, SheetChipRow } from '../components/ActionSheet.jsx'
import AddEventSheet from '../components/AddEventSheet.jsx'
import { SkeletonList } from '../components/Skeleton.jsx'
import SpecTabs from '../components/SpecTabs.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useProfile } from '../contexts/ProfileContext.jsx'
import { getWeather, workWindow } from '../lib/weather.js'
import { hapticTap, hapticMedium } from '../lib/haptics.js'
import { useFhMotion } from '../lib/motion.js'

const VIEWS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' }
]

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function sameDay(a, b) { return a.toDateString() === b.toDateString() }
function fmtDate(d) { return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) }
function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '' }

export default function Schedule() {
  const { user } = useAuth()
  const { profile } = useProfile()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const initialCursor = (() => {
    const d = params.get('d')
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const [y, m, day] = d.split('-').map(Number)
      return startOfDay(new Date(y, m - 1, day))
    }
    return startOfDay(new Date())
  })()
  // Persist last-used calendar view per user. Most contractors live in
  // one mode (Day for the foreman, Week for the owner) and don't want
  // to keep clicking back to it after every session.
  const [view, setView] = useState(() => {
    if (typeof window === 'undefined') return 'day'
    try {
      const v = window.localStorage.getItem('fh:schedule:view')
      return v === 'week' || v === 'month' ? v : 'day'
    } catch { return 'day' }
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    try { window.localStorage.setItem('fh:schedule:view', view) } catch {}
  }, [view])
  const [cursor, setCursor] = useState(initialCursor)
  // null = haven't fetched yet, [] = fetched but empty. Distinguishes
  // "first paint, please show skeleton" from "view switched, keep
  // grid visible while we re-fetch in background." Audit was seeing
  // the SkeletonList horizontal bars during a view switch and reading
  // them as a broken Month grid.
  const [events, setEvents] = useState(null)
  const [upcoming, setUpcoming] = useState([])
  const [loading, setLoading] = useState(true)
  const [weather, setWeather] = useState(null)
  const [addOpen, setAddOpen] = useState(false)

  // If the URL had ?d=YYYY-MM-DD, consume it once so the back button
  // doesn't keep forcing the cursor back to that day.
  useEffect(() => {
    if (params.get('d')) {
      const next = new URLSearchParams(params)
      next.delete('d')
      setParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function deleteEvent(evtId) {
    if (!evtId) return
    // Snapshot before deletion so Undo can re-insert. Strip generated
    // fields and the joined relation; only re-insert the source row.
    const snapshot = events.find((e) => e.id === evtId) || upcoming.find((e) => e.id === evtId)
    const { error } = await supabase.from('fh_schedule').delete().eq('id', evtId)
    if (error) {
      toastError("Couldn't delete", error.message)
      return
    }
    // Optimistic local-state removal so the row vanishes immediately
    setEvents((prev) => prev.filter((e) => e.id !== evtId))
    setUpcoming((prev) => prev.filter((e) => e.id !== evtId))
    toastUndo('Event deleted', {
      description: snapshot?.title || 'Tap Undo to restore',
      onUndo: async () => {
        if (!snapshot) return
        // eslint-disable-next-line no-unused-vars
        const { fh_contacts, ...row } = snapshot
        const { error: insErr } = await supabase.from('fh_schedule').insert(row)
        if (insErr) { toastError("Couldn't undo", insErr.message); return }
        load()
        loadUpcoming()
        toastSuccess('Restored', snapshot.title || '')
      }
    })
  }

  const hasCoords = profile?.location_lat != null && profile?.location_lon != null

  const range = useMemo(() => {
    if (view === 'day') return { start: cursor, end: addDays(cursor, 1) }
    if (view === 'week') {
      const s = addDays(cursor, -cursor.getDay())
      return { start: s, end: addDays(s, 7) }
    }
    // Month view: query a 6-week window so the leading + trailing
    // calendar cells (which fall in adjacent months) get badges, not
    // just the days strictly inside the month.
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    const gridStart = addDays(monthStart, -monthStart.getDay())
    const gridEnd = addDays(gridStart, 42)
    return { start: gridStart, end: gridEnd, monthStart, monthEnd }
  }, [view, cursor])

  const load = useCallback(async () => {
    if (!user) return
    // Only blank the grid for the very first fetch — subsequent fetches
    // (after a view switch, after an event delete, after FAB save) keep
    // the existing events rendered until the new payload lands.
    setLoading((prev) => events == null ? true : prev)
    const { data } = await supabase
      .from('fh_schedule')
      .select('*, fh_contacts(name, stage)')
      .eq('user_id', user.id)
      .gte('start_at', range.start.toISOString())
      .lt('start_at', range.end.toISOString())
      .order('start_at', { ascending: true })
    setEvents(data || [])
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, range.start, range.end])

  const loadUpcoming = useCallback(async () => {
    if (!user) return
    const now = new Date()
    const in7 = addDays(startOfDay(now), 7)
    const { data } = await supabase
      .from('fh_schedule')
      .select('*, fh_contacts(name, stage)')
      .eq('user_id', user.id)
      .gte('start_at', now.toISOString())
      .lt('start_at', in7.toISOString())
      .order('start_at', { ascending: true })
      .limit(8)
    setUpcoming(data || [])
  }, [user])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadUpcoming() }, [loadUpcoming, addOpen])

  useEffect(() => {
    if (!hasCoords) return
    getWeather(profile.location_lat, profile.location_lon).then(setWeather).catch(() => {})
  }, [hasCoords, profile?.location_lat, profile?.location_lon])

  function shift(n) {
    if (view === 'day') setCursor((d) => addDays(d, n))
    else setCursor((d) => addDays(d, 7 * n))
  }

  // Month nav (header chevrons) shifts the cursor by N months while
  // keeping the day-of-month if it exists in the new month, else the last
  // day. The week strip below the nav re-anchors automatically because
  // cursor changed.
  function shiftMonth(n) {
    setCursor((d) => {
      const next = new Date(d.getFullYear(), d.getMonth() + n, 1)
      const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
      next.setDate(Math.min(d.getDate(), lastDay))
      next.setHours(0, 0, 0, 0)
      return next
    })
  }

  const windowRead = useMemo(
    () => workWindow(weather?.current, profile?.services || []),
    [weather, profile?.services]
  )

  const { stagger, item } = useFhMotion()

  return (
    <motion.div className="v3-screen" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: 120, position: 'relative', background: 'var(--v3-bg)' }}>
      {/* HEADER — top + button removed; the FAB at bottom-right is the
          single, thumb-reachable add-event control. */}
      {/* HEADER — time-control bar with inline Schedule Job CTA.
          Top-right CTA matches Hero command-center pattern; FAB at the
          bottom-right stays for thumb-reach on mobile. Both wired to
          the same setAddOpen handler. */}
      <motion.div variants={item} style={{ padding: '12px 20px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--v3-primary)' }}>
              Time Control
            </span>
            <h1 style={{ margin: '4px 0 0', fontFamily: 'var(--font-serif)', fontSize: 'clamp(26px, 7vw, 36px)', lineHeight: 1.05, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--v3-text)' }}>
              Run the day.
            </h1>
            {events && events.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 8 }}>
                <span style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 22, lineHeight: 1, letterSpacing: '0.02em',
                  color: 'var(--v3-primary)',
                  fontVariantNumeric: 'tabular-nums'
                }}>
                  {events.length}
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--v3-text-muted)' }}>
                  {events.length === 1 ? 'Event' : 'Events'}
                </span>
              </div>
            )}
          </div>
          {/* Inline Schedule Job CTA — primary action surface for desktop
              users who don't reach for the FAB. Mobile users get both. */}
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            whileHover={{ y: -2 }}
            transition={{ type: 'spring', stiffness: 620, damping: 28 }}
            onClick={() => { hapticTap(); setAddOpen(true) }}
            aria-label="Schedule a job"
            style={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '11px 16px',
              borderRadius: 12,
              border: 'none',
              background: 'var(--v3-primary)',
              color: 'var(--v3-on-primary)',
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              boxShadow: 'var(--v3-gold-glow-sm)',
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            <Plus size={14} aria-hidden="true" />
            Schedule Job
          </motion.button>
        </div>
      </motion.div>

      {/* WEATHER STRIP */}
      {hasCoords && (
        <motion.div variants={item} className={`fh-weatherbar fh-weatherbar--${windowRead.status}`} style={{ margin: '10px 20px 0' }}>
          <span className="fh-weatherbar__dot" />
          <span className="fh-weatherbar__label">{windowRead.label}</span>
          {windowRead.reasons.length > 0 && <span className="fh-weatherbar__reason">{windowRead.reasons.join(' · ')}</span>}
        </motion.div>
      )}

      {/* MONTH NAV — chevron-prev · "April 2025" · chevron-next · Today */}
      <motion.div variants={item} style={{ padding: '4px 20px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              style={chevBtnStyle}
            >
              <ChevronLeft size={16} />
            </button>
            <span style={{
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: '0.02em',
              color: 'var(--v3-text)',
              fontVariantNumeric: 'tabular-nums',
              minWidth: 130,
              textAlign: 'center'
            }}>
              {cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
              style={chevBtnStyle}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setCursor(startOfDay(new Date()))}
            style={{
              padding: '8px 14px', borderRadius: 10,
              border: '1px solid var(--v3-border-strong)',
              background: 'var(--v3-surface)',
              color: 'var(--v3-text)',
              fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            Today
          </button>
        </div>
      </motion.div>

      {/* WEEK STRIP — 7 cells anchored to Monday. Highlighted cell = cursor;
          ring around today (when not selected). Tap any day to jump. */}
      <motion.div variants={item} style={{ padding: '0 var(--v3-gutter) 14px' }}>
        <div className="fh-week-strip">
          {Array.from({ length: 7 }, (_, i) => {
            const today = startOfDay(new Date())
            const cursorDow = (cursor.getDay() + 6) % 7
            const day = addDays(cursor, i - cursorDow)
            const isSelected = sameDay(day, cursor)
            const isToday = sameDay(day, today)
            const dayName = day.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase().slice(0, 3)
            const dayNum = day.getDate()
            return (
              <motion.button
                key={day.toISOString()}
                type="button"
                whileTap={{ scale: 0.94 }}
                onClick={() => { hapticTap(); setCursor(startOfDay(day)); setView('day') }}
                aria-pressed={isSelected}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  gap: 4,
                  padding: '10px 4px',
                  borderRadius: 12,
                  background: isSelected ? 'var(--v3-primary-soft)' : 'var(--v3-surface)',
                  border: isSelected
                    ? '1px solid color-mix(in srgb, var(--v3-primary) 50%, transparent)'
                    : isToday
                      ? '1px solid color-mix(in srgb, var(--v3-primary) 25%, transparent)'
                      : '1px solid var(--v3-border-strong)',
                  boxShadow: isSelected
                    ? '0 6px 18px rgba(212, 175, 55, 0.20), inset 0 1px 0 rgba(255, 255, 255, 0.06)'
                    : 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
                  color: isSelected ? 'var(--v3-primary)' : 'var(--v3-text)',
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent'
                }}
              >
                <span style={{
                  fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700,
                  letterSpacing: '0.14em',
                  color: isSelected ? 'var(--v3-primary)' : 'var(--v3-text-muted)'
                }}>
                  {dayName}
                </span>
                <span style={{
                  fontFamily: 'var(--font-display)', fontSize: 18,
                  letterSpacing: '0.02em',
                  color: isSelected ? 'var(--v3-primary)' : 'var(--v3-text)',
                  fontVariantNumeric: 'tabular-nums', lineHeight: 1
                }}>
                  {dayNum}
                </span>
                {isToday && !isSelected && (
                  <span aria-hidden="true" style={{
                    width: 4, height: 4, borderRadius: '50%',
                    background: 'var(--v3-primary)', marginTop: 1
                  }} />
                )}
              </motion.button>
            )
          })}
        </div>
      </motion.div>

      {/* DAY / WEEK TABS — narrower, sits above the timeline */}
      <motion.div variants={item} style={{ padding: '0 var(--v3-gutter) 14px' }}>
        <SpecTabs
          options={VIEWS}
          value={view}
          onChange={setView}
          ariaLabel="Calendar view"
        />
      </motion.div>

      {/* Swipe-detector wraps the per-view body. Horizontal pointer drag
          past 60 px shifts the cursor by 1 (left = next, right = prev),
          giving phone users the same gesture they expect from native
          calendar apps. Vertical scroll inside the body still works. */}
      {/* DAY HEADER — "TUE, APR 28" eyebrow that titles the timeline */}
      {view === 'day' && (
        <motion.div variants={item} style={{ padding: '0 var(--v3-gutter) 8px' }}>
          <span style={{
            fontFamily: 'var(--font-body)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--v3-text-muted)'
          }}>
            {cursor.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
        </motion.div>
      )}

      {/* TIMELINE — vertical time-block list. Matches mockup: each row
          is a job block with time, name, sub, status pill, avatar group. */}
      <SwipeShell onShift={shift}>
        <motion.div variants={item} style={{ padding: '0 var(--v3-gutter) 24px' }}>
          {loading && events == null && <SkeletonList rows={5} card={false} />}
          {events != null && view === 'day' && (
            <DayView
              events={events}
              now={new Date()}
              onClick={(id) => navigate(`/jobs/${id}`)}
              onDelete={deleteEvent}
              onAdd={() => setAddOpen(true)}
            />
          )}
          {events != null && view === 'week' && (
            <WeekView
              start={addDays(cursor, -((cursor.getDay() + 6) % 7))}
              events={events}
              onClick={(id) => navigate(`/jobs/${id}`)}
              onDelete={deleteEvent}
            />
          )}
        </motion.div>
      </SwipeShell>

      {/* FAB — bottom-right, thumb-reachable, clears the bottom nav. The
          in-empty-state "Add event ->" link was removed; this is the
          single source of truth for adding events on Schedule. */}
      <button
        type="button"
        onClick={() => { hapticMedium(); setAddOpen(true) }}
        aria-label="New event"
        className="fh-fab"
      >
        <Plus size={26} strokeWidth={2.5} />
      </button>

      <AddEventSheet
        open={addOpen}
        userId={user?.id}
        onClose={() => setAddOpen(false)}
        onSaved={() => { setAddOpen(false); load() }}
      />
    </motion.div>
  )
}

// Lightweight pointer-based horizontal swipe wrapper. Plain pointer events
// because framer-motion's drag swallows the page scroll on mobile. Vertical
// motion ignores; horizontal past 60 px fires onShift(direction).
function SwipeShell({ onShift, children }) {
  const startRef = useRef(null)
  function onPointerDown(e) {
    startRef.current = { x: e.clientX, y: e.clientY, time: Date.now() }
  }
  function onPointerUp(e) {
    const start = startRef.current
    startRef.current = null
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    const elapsed = Date.now() - start.time
    if (elapsed > 800) return
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.4) return
    onShift(dx < 0 ? 1 : -1)
    hapticTap()
  }
  return (
    <div onPointerDown={onPointerDown} onPointerUp={onPointerUp} style={{ touchAction: 'pan-y' }}>
      {children}
    </div>
  )
}

// 44 px hits the WCAG / iOS Human Interface tap-target minimum so a work
// glove or sloppy thumb won't trigger the "Month" pill by accident when
// shifting day cursor.
const iconBtnStyle = {
  width: 44,
  height: 44,
  borderRadius: 11,
  border: '1px solid var(--v3-border-strong)',
  background: 'var(--v3-surface)',
  color: 'var(--v3-text)',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent'
}

// Smaller chevron button used in the month nav header. Same surface
// system as iconBtnStyle but 36x36 so the row reads tighter.
const chevBtnStyle = {
  width: 36,
  height: 36,
  borderRadius: 10,
  border: '1px solid var(--v3-border-strong)',
  background: 'var(--v3-surface)',
  color: 'var(--v3-text)',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent'
}

function DayView({ events, onClick, onDelete, onAdd }) {
  if (events.length === 0) {
    return (
      <div style={{
        padding: '40px 28px',
        borderRadius: 18,
        background: `
          radial-gradient(120% 80% at 50% 0%, rgba(212, 175, 55, 0.08), transparent 60%),
          var(--v3-surface)
        `,
        border: '1px solid var(--v3-border-strong)',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 1px 2px rgba(0, 0, 0, 0.25)',
        textAlign: 'center',
        fontFamily: 'var(--font-body)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: 14,
          background: 'var(--v3-primary-soft)',
          border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
          display: 'grid', placeItems: 'center',
          color: 'var(--v3-primary)'
        }}>
          <CalendarIcon size={22} aria-hidden="true" />
        </div>
        <div>
          <h3 style={{
            margin: 0,
            fontFamily: 'var(--font-serif)',
            fontSize: 22, fontWeight: 500, letterSpacing: '-0.01em',
            color: 'var(--v3-text)'
          }}>
            Nothing scheduled — fill your day.
          </h3>
          <p style={{
            margin: '8px 0 0',
            fontSize: 13,
            color: 'var(--v3-text-muted)',
            lineHeight: 1.5,
            maxWidth: 320
          }}>
            Crew runs smoother when the day's on the board. Queue up the first job.
          </p>
        </div>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          whileHover={{ y: -2 }}
          transition={{ type: 'spring', stiffness: 620, damping: 28 }}
          onClick={() => { hapticTap(); onAdd?.() }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '11px 18px', borderRadius: 12, border: 'none',
            background: 'var(--v3-primary)', color: 'var(--v3-on-primary)',
            fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
            letterSpacing: '0.04em', cursor: 'pointer',
            boxShadow: 'var(--v3-gold-glow)',
            WebkitTapHighlightColor: 'transparent'
          }}
        >
          <Plus size={14} />
          Schedule a job
        </motion.button>
      </div>
    )
  }
  return (
    <ul className="fh-timeline" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {events.map((e, i) => {
        const status = deriveStatus(e, now)
        const start = fmtTime(e.start_at)
        const end = e.end_at ? fmtTime(e.end_at) : null
        const primary = e.fh_contacts?.name || e.title || 'Untitled'
        const secondary = e.fh_contacts?.name && e.title ? e.title : (e.description || (e.contact_id ? '' : 'Manual event'))
        const initial = (primary || '·').trim().charAt(0).toUpperCase()
        return (
          <ScheduleRow
            key={e.id}
            index={i}
            primary={primary}
            secondary={secondary}
            startStr={start}
            endStr={end}
            status={status}
            initial={initial}
            onClick={() => e.contact_id && onClick(e.contact_id)}
            onDelete={() => onDelete && window.confirm('Delete this event?') && onDelete(e.id)}
            isClickable={Boolean(e.contact_id)}
          />
        )
      })}
    </ul>
  )
}

/* Status taxonomy mirrors the mockup pill colors:
     On Site     — currently happening, has a job (contact_id) → green
     In Progress — currently happening, no contact (office/admin) → blue
     Upcoming    — future today → gold
     Scheduled   — future, not today → gray
     Done        — past → muted gray (mockup doesn't show this; quiet) */
const STATUS_TONE = {
  'On Site':     { color: '#4ADE80', soft: 'rgba(46, 204, 113, 0.14)',  border: 'rgba(46, 204, 113, 0.40)' },
  'In Progress': { color: '#60A5FA', soft: 'rgba(96, 165, 250, 0.14)',  border: 'rgba(96, 165, 250, 0.40)' },
  'Upcoming':    { color: '#E8C25A', soft: 'rgba(212, 175, 55, 0.14)',  border: 'rgba(212, 175, 55, 0.40)' },
  'Scheduled':   { color: '#A1A1AA', soft: 'rgba(255, 255, 255, 0.04)', border: 'rgba(255, 255, 255, 0.10)' },
  'Done':        { color: '#A1A1AA', soft: 'rgba(255, 255, 255, 0.03)', border: 'rgba(255, 255, 255, 0.08)' }
}

function deriveStatus(e, now) {
  const start = e.start_at ? new Date(e.start_at).getTime() : null
  const end = e.end_at ? new Date(e.end_at).getTime() : null
  const t = now.getTime()
  if (end && end < t) return 'Done'
  if (start && start <= t && end && t <= end) {
    return e.contact_id ? 'On Site' : 'In Progress'
  }
  if (start && start > t && sameDay(new Date(start), now)) return 'Upcoming'
  return 'Scheduled'
}

function ScheduleRow({ index, primary, secondary, startStr, endStr, status, initial, onClick, onDelete, isClickable }) {
  const tone = STATUS_TONE[status] || STATUS_TONE.Scheduled
  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={isClickable ? { y: -2, backgroundColor: '#282834' } : undefined}
      transition={{
        opacity: { delay: Math.min(index * 0.04, 0.25), duration: 0.24, ease: [0.2, 0.8, 0.2, 1] },
        y: { type: 'spring', stiffness: 620, damping: 28 },
        backgroundColor: { type: 'spring', stiffness: 620, damping: 28 }
      }}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'stretch', gap: 14,
        padding: '14px 14px',
        borderRadius: 14,
        background: '#141418',
        border: '1px solid var(--v3-border-strong)',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 1px 2px rgba(0, 0, 0, 0.25)',
        overflow: 'hidden'
      }}
    >
      {/* Status-color spine — drives the at-a-glance dispatch read */}
      <span aria-hidden="true" style={{
        position: 'absolute',
        left: 0, top: 12, bottom: 12,
        width: 3,
        borderRadius: '0 3px 3px 0',
        background: tone.color,
        boxShadow: `0 0 10px ${tone.color}55`
      }} />

      {/* Time column — start over end, narrow handle on the left */}
      <div style={{
        flexShrink: 0,
        width: 64,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
        justifyContent: 'center',
        paddingLeft: 6,
        paddingRight: 12,
        borderRight: '1px solid var(--v3-border)'
      }}>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 15,
          letterSpacing: '0.02em',
          color: 'var(--v3-text)',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.05
        }}>
          {startStr}
        </span>
        {endStr && (
          <span style={{
            marginTop: 3,
            fontFamily: 'var(--font-body)',
            fontSize: 10,
            color: 'var(--v3-text-muted)',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '0.04em'
          }}>
            {endStr}
          </span>
        )}
      </div>

      {/* Body — primary (job/client) + secondary (description) */}
      <button
        type="button"
        onClick={isClickable ? onClick : undefined}
        style={{
          flex: 1, minWidth: 0,
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          gap: 3,
          background: 'transparent', border: 'none', padding: 0, textAlign: 'left',
          cursor: isClickable ? 'pointer' : 'default',
          color: 'var(--v3-text)',
          WebkitTapHighlightColor: 'transparent'
        }}
      >
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 14, fontWeight: 700,
          letterSpacing: '-0.01em',
          color: 'var(--v3-text)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        }}>
          {primary}
        </div>
        {secondary && (
          <div style={{
            fontFamily: 'var(--font-body)',
            fontSize: 11,
            color: 'var(--v3-text-muted)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
          }}>
            {secondary}
          </div>
        )}
      </button>

      {/* Right cluster — status pill + avatar (single, contact initial) */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '4px 10px',
          borderRadius: 999,
          background: tone.soft,
          border: `1px solid ${tone.border}`,
          color: tone.color,
          fontFamily: 'var(--font-body)',
          fontSize: 10, fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap'
        }}>
          <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: tone.color }} />
          {status}
        </span>
        <div aria-hidden="true" style={{
          width: 30, height: 30,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--v3-primary-soft), rgba(212, 175, 55, 0.05))',
          border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
          display: 'grid', placeItems: 'center',
          fontFamily: 'var(--font-display)',
          fontSize: 13,
          letterSpacing: '0.04em',
          color: 'var(--v3-primary)'
        }}>
          {initial}
        </div>
        {onDelete && (
          <button
            type="button"
            onClick={(ev) => { ev.stopPropagation(); onDelete() }}
            aria-label="Delete event"
            style={{
              width: 28, height: 28, borderRadius: 8,
              border: 'none', background: 'transparent',
              color: 'var(--v3-text-muted)',
              cursor: 'pointer', display: 'grid', placeItems: 'center',
              opacity: 0.55,
              WebkitTapHighlightColor: 'transparent'
            }}
            onMouseEnter={(ev) => { ev.currentTarget.style.opacity = '1'; ev.currentTarget.style.color = 'var(--v3-danger-bright)' }}
            onMouseLeave={(ev) => { ev.currentTarget.style.opacity = '0.55'; ev.currentTarget.style.color = 'var(--v3-text-muted)' }}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </motion.li>
  )
}

function WeekView({ start, events, onClick, onDelete }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  return (
    <div className="fh-week">
      {days.map((d) => {
        const dayEvents = events.filter((e) => sameDay(new Date(e.start_at), d))
        return (
          <div key={d.toISOString()} className="fh-week__col">
            <header className="fh-week__head">
              <span className="fh-week__dow">{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <span className="fh-week__num">{d.getDate()}</span>
            </header>
            <div className="fh-week__body">
              {dayEvents.length === 0 && <span className="fh-week__empty">—</span>}
              {dayEvents.map((e) => (
                <div key={e.id} className="fh-week__evt" style={{ position: 'relative' }}>
                  <button type="button" onClick={() => e.contact_id && onClick(e.contact_id)} style={{ background: 'transparent', border: 'none', padding: 0, textAlign: 'left', width: '100%', cursor: e.contact_id ? 'pointer' : 'default', color: 'inherit', font: 'inherit', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {/* Time + title used to render as inline spans with no
                        gap, producing "8:00 AMasbestos test". Stack them
                        vertically with a 2 px gap so the time reads as a
                        clear caption above the title. */}
                    <span>{fmtTime(e.start_at)}</span>
                    <strong>{e.title}</strong>
                  </button>
                  {onDelete && (
                    <button
                      type="button"
                      onClick={(ev) => { ev.stopPropagation(); if (window.confirm('Delete this event?')) onDelete(e.id) }}
                      aria-label="Delete event"
                      style={{ position: 'absolute', top: 2, right: 2, width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--v3-text-muted)', cursor: 'pointer', display: 'grid', placeItems: 'center', opacity: 0.6 }}
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MonthView({ cursor, events, onDay }) {
  // 6-week grid (always 42 cells) so the layout is stable across
  // months. Days from the prev/next month are rendered dimmed instead
  // of as blank slots — matches every standard calendar app.
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const gridStart = addDays(monthStart, -monthStart.getDay())
  const today = startOfDay(new Date())
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const currentMonth = cursor.getMonth()

  return (
    <div className="fh-month">
      {['S','M','T','W','T','F','S'].map((d, i) => <span key={i} className="fh-month__dow">{d}</span>)}
      {cells.map((d) => {
        const dayEvents = events.filter((e) => sameDay(new Date(e.start_at), d))
        const inMonth = d.getMonth() === currentMonth
        const isToday = sameDay(d, today)
        const cls = [
          'fh-month__cell',
          dayEvents.length ? 'has-events' : '',
          inMonth ? '' : 'is-out',
          isToday ? 'is-today' : ''
        ].filter(Boolean).join(' ')
        return (
          <button key={d.toISOString()} type="button" className={cls} onClick={() => onDay(d)}>
            <span className="fh-month__num">{d.getDate()}</span>
            {dayEvents.length > 0 && <span className="fh-month__count">{dayEvents.length}</span>}
          </button>
        )
      })}
    </div>
  )
}

