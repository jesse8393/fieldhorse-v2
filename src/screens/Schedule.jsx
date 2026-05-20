import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Plus, Calendar as CalendarIcon, Clock, MapPin, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { toast, toastSuccess, toastUndo, toastError } from '../lib/toast.ts'
import ActionSheet from '../components/ActionSheet.jsx'
import AddEventSheet from '../components/AddEventSheet.jsx'
import { SkeletonList } from '../components/Skeleton.jsx'
import { FloatingActionButton, ScreenCloser } from '../components/v3'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import {
  useScheduleEvents,
  useUpcomingEvents,
  useInvalidateSchedule,
  useDropScheduleEvent
} from '../lib/queries.ts'
import { useProfile } from '../contexts/ProfileContext.jsx'
import { getWeather, workWindow } from '../lib/weather.ts'
import { hapticTap, hapticMedium } from '../lib/haptics.ts'
import { useFhMotion } from '../lib/motion.ts'
import { useIsDesktop } from '../lib/useMediaQuery.ts'
import DesktopScheduleWorkspace from '../components/desktop/DesktopScheduleWorkspace.jsx'

const VIEWS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' }
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

  // Range bounds for the current day/week/month grid. Only depends on
  // view + cursor; feeds the scheduled-events query below.
  const range = useMemo(() => {
    if (view === 'day') return { start: cursor, end: addDays(cursor, 1) }
    if (view === 'week') {
      const s = addDays(cursor, -cursor.getDay())
      return { start: s, end: addDays(s, 7) }
    }
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    const gridStart = addDays(monthStart, -monthStart.getDay())
    const gridEnd = addDays(gridStart, 42)
    return { start: gridStart, end: gridEnd, monthStart, monthEnd }
  }, [view, cursor])

  // TanStack Query replaces the manual events/upcoming/loading useState
  // + load()/loadUpcoming() callbacks. keepPreviousData inside the hook
  // preserves the "keep the grid rendered during a view switch" behavior
  // the old setLoading guard provided. events defaults to null on first
  // load so the skeleton-vs-empty distinction below still holds.
  const { data: events = null, isPending: eventsPending } = useScheduleEvents(
    user?.id,
    range.start.toISOString(),
    range.end.toISOString()
  )
  const { data: upcoming = [] } = useUpcomingEvents(user?.id)
  const invalidateSchedule = useInvalidateSchedule()
  const dropScheduleEvent = useDropScheduleEvent()
  const loading = eventsPending
  // Aliases so the existing delete/undo + FAB-save call sites keep working.
  const load = invalidateSchedule
  const loadUpcoming = invalidateSchedule

  const [weather, setWeather] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  // Destructive-confirm sheet for delete event. pendingDeleteEvt is the
  // event row being deleted (for title display); deletingEvt is the
  // commit-in-flight flag.
  const [pendingDeleteEvt, setPendingDeleteEvt] = useState(null)
  const [deletingEvt, setDeletingEvt] = useState(false)

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

  // Resolve the event row from id and open the destructive-confirm sheet.
  // Both DayView and WeekView delete affordances funnel through here so
  // the confirm UX is consistent and lifted out of the row components.
  function requestDeleteEvent(evtId) {
    if (!evtId) return
    const row = (events || []).find((e) => e.id === evtId)
      || (upcoming || []).find((e) => e.id === evtId)
      || { id: evtId, title: 'this event' }
    setPendingDeleteEvt(row)
  }

  async function deleteEvent(evtId) {
    if (!evtId) return
    // Snapshot before deletion so Undo can re-insert. Strip generated
    // fields and the joined relation; only re-insert the source row.
    const snapshot = events.find((e) => e.id === evtId) || upcoming.find((e) => e.id === evtId)
    const { error } = await supabase.from('fh_schedule').delete().eq('id', evtId).eq('user_id', user.id)
    if (error) {
      toastError("Couldn't delete", error.message)
      return
    }
    // Optimistic cache removal so the row vanishes immediately, before
    // the Undo toast resolves. Drops from both schedule queries.
    dropScheduleEvent(evtId)
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

  // 5/17 — daily forecast map keyed by YYYY-MM-DD so the Week strip
  // can render a tiny high/precip badge under each date. Addresses the
  // 5/13 audit's "Schedule should have a weather overlay (you already
  // have the forecast data!)" complaint. getWeather now fetches 7
  // days (was 3) so a full visible week has data. Cells outside the
  // forecast horizon fall back to no badge — silent, not "—".
  const dailyForecast = useMemo(() => {
    const d = weather?.daily
    if (!d?.time?.length) return {}
    const out = {}
    for (let i = 0; i < d.time.length; i++) {
      out[d.time[i]] = {
        high: d.temperature_2m_max?.[i],
        low: d.temperature_2m_min?.[i],
        precipProb: d.precipitation_probability_max?.[i] ?? 0,
        precipIn: d.precipitation_sum?.[i] ?? 0
      }
    }
    return out
  }, [weather])

  function dayKey(d) {
    // Local-time YYYY-MM-DD, NOT toISOString (which converts to UTC and
    // can skew the date by one day for east-of-UTC locales like CDT/CST).
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  const { stagger, item } = useFhMotion()
  const isDesktop = useIsDesktop()

  // Phase 7 — desktop-first composition. At >=900px the planner +
  // upcoming rail workspace replaces the narrow mobile dispatch
  // board. Mobile <900px keeps every feature of the existing
  // motion.div.v3-screen--schedule flow (month grid, week / day
  // toggles, weather strip, FAB add-event) verbatim.
  if (isDesktop) {
    return (
      <>
        <DesktopScheduleWorkspace
          events={events}
          upcoming={upcoming}
          loading={loading}
          cursor={cursor}
          setCursor={setCursor}
          view={view}
          setView={setView}
          onAddEvent={() => setAddOpen(true)}
        />
        <AddEventSheet
          open={addOpen}
          userId={user?.id}
          onClose={() => setAddOpen(false)}
          onSaved={() => { setAddOpen(false); load() }}
        />
      </>
    )
  }

  return (
    <motion.div className="v3-screen v3-screen--schedule" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: 'calc(76px + env(safe-area-inset-bottom, 0px))', position: 'relative', background: 'var(--v3-bg)' }}>
      {/* COMPACT HEADER — matches design's app-head--titled pattern.
          Eyebrow gives context ("Tue · May 20 · 4 visits"), h1 anchors
          the screen. Stats live inline under the eyebrow instead of
          inside a heavy black-glass panel. */}
      <motion.div variants={item} style={{ padding: '14px 20px 4px' }}>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 10, fontWeight: 700,
          letterSpacing: '0.18em', textTransform: 'uppercase',
          color: 'var(--v3-primary)',
          marginBottom: 6
        }}>
          {cursor.toLocaleDateString(undefined, { weekday: 'short' })} ·{' '}
          {cursor.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          {(events && events.length > 0) && (
            <> · {events.length} {events.length === 1 ? 'visit' : 'visits'}</>
          )}
        </div>
        <h1 style={{
          margin: 0,
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(28px, 8vw, 38px)',
          lineHeight: 1, letterSpacing: '0.01em',
          color: 'var(--v3-text)'
        }}>
          {sameDay(cursor, startOfDay(new Date()))
            ? 'Today'
            : cursor.toLocaleDateString(undefined, { weekday: 'long' })}
        </h1>
        {upcoming.length > 0 && (
          <div style={{
            marginTop: 4,
            fontFamily: 'var(--font-body)', fontSize: 12,
            color: 'var(--v3-text-muted)'
          }}>
            {upcoming.length} upcoming in next 7 days
          </div>
        )}
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
      {/* DISPATCH STRIP — slim 52px day pills, design's dispatch-day pattern.
          Today gets a bright gold gradient; selected (non-today) gets a
          gold-soft tint with a subtle border accent. */}
      <motion.div variants={item}>
        <div className="dispatch-strip">
          {Array.from({ length: 7 }, (_, i) => {
            const today = startOfDay(new Date())
            const cursorDow = (cursor.getDay() + 6) % 7
            const day = addDays(cursor, i - cursorDow)
            const isSelected = sameDay(day, cursor)
            const isToday = sameDay(day, today)
            const dayName = day.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase().slice(0, 3)
            const dayNum = day.getDate()
            const forecastFor = dailyForecast[dayKey(day)] || null
            const hasJobsPip = forecastFor && forecastFor.precipProb >= 50
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => { hapticTap(); setCursor(startOfDay(day)); setView('day') }}
                aria-pressed={isSelected}
                className={`dispatch-day${isToday ? ' is-today' : ''}${isSelected && !isToday ? ' is-selected' : ''}`}
              >
                <span className="dispatch-day__dow">{dayName}</span>
                <span className="dispatch-day__num">{dayNum}</span>
                {forecastFor && forecastFor.high != null && (
                  <span style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: 9,
                    fontWeight: 600,
                    lineHeight: 1,
                    color: isToday ? 'var(--v3-on-primary)' : 'var(--v3-text-muted)',
                    fontVariantNumeric: 'tabular-nums',
                    marginTop: 2
                  }}>
                    {Math.round(forecastFor.high)}°
                  </span>
                )}
                {hasJobsPip && !isToday && <span className="dispatch-day__pip" />}
              </button>
            )
          })}
        </div>
      </motion.div>

      {/* DAY / WEEK / MONTH toggle — uses the same dispatch-state pill
          pattern as the ALL/LIVE/UPCOMING/DONE row below it, so the two
          toggles read as siblings. Replaced the older SpecTabs boxy
          chips that didn't match the rest of the v3 dispatch-* family. */}
      <motion.div variants={item} style={{ padding: '0 var(--v3-gutter) 14px' }}>
        <div
          className="dispatch-state"
          role="tablist"
          aria-label="Calendar view"
          style={{ marginLeft: 0, marginRight: 0 }}
        >
          {VIEWS.map((opt) => {
            const on = view === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                role="tab"
                aria-selected={on}
                className={`dispatch-state__opt${on ? ' is-on' : ''}`}
                onClick={() => {
                  if (!on) hapticTap()
                  setView(opt.value)
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
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
            letterSpacing: '0.10em',
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
              onDelete={requestDeleteEvent}
              onAdd={() => setAddOpen(true)}
            />
          )}
          {events != null && view === 'week' && (
            <WeekView
              start={addDays(cursor, -((cursor.getDay() + 6) % 7))}
              events={events}
              onClick={(id) => navigate(`/jobs/${id}`)}
              onDelete={requestDeleteEvent}
            />
          )}
          {events != null && view === 'month' && (
            // 5/17 — month view was implemented in MonthView() but never
            // exposed in the VIEWS toggle. Wiring it in gives the
            // contractor the long-horizon planner audit flagged as
            // missing. Range memo already returns a 6-week window so
            // events outside the visible month still hydrate their
            // day badges. Tapping a day jumps to that day in Day view.
            <MonthView
              cursor={cursor}
              events={events}
              onDay={(d) => { hapticTap(); setCursor(startOfDay(d)); setView('day') }}
            />
          )}
        </motion.div>
      </SwipeShell>

      {/* FAB — canonical portal-rendered primitive, immune to
          containing-block traps from transformed ancestors. Hidden
          when the day view is showing its own "Schedule a job" empty
          state CTA so the screen never has two stacked gold +
          buttons fighting for the operator's tap. */}
      {events && events.length > 0 && (
        <FloatingActionButton
          onClick={() => setAddOpen(true)}
          ariaLabel="New event"
          iconStrokeWidth={2.5}
        />
      )}

      <ScreenCloser caption="Tap a day above to plan the week ahead." />

      <AddEventSheet
        open={addOpen}
        userId={user?.id}
        onClose={() => setAddOpen(false)}
        onSaved={() => { setAddOpen(false); load() }}
      />

      {/* Destructive-confirm sheet for delete event. The actual delete
          flow (snapshot + optimistic removal + Undo toast + Supabase
          delete with user_id guard + refresh) lives in deleteEvent;
          this sheet only gates execution behind a confirm step. */}
      <ActionSheet
        open={!!pendingDeleteEvt}
        title="Delete this event?"
        accentWord="Delete"
        sectionLabel="Destructive"
        stepCount={1}
        currentStep={1}
        commitLabel={deletingEvt ? 'Deleting…' : 'Delete event'}
        commitBusy={deletingEvt}
        commitDisabled={deletingEvt}
        destructive
        onClose={() => { if (!deletingEvt) setPendingDeleteEvt(null) }}
        onCommit={async () => {
          if (!pendingDeleteEvt) return
          setDeletingEvt(true)
          try {
            await deleteEvent(pendingDeleteEvt.id)
          } finally {
            setDeletingEvt(false)
            setPendingDeleteEvt(null)
          }
        }}
      >
        <p style={{ margin: 0, color: 'var(--v3-text)', fontSize: '1rem', lineHeight: 1.45 }}>
          Removing <strong>{pendingDeleteEvt?.title || 'this event'}</strong> from your schedule. You'll get an Undo toast right after — tap it to restore.
        </p>
      </ActionSheet>
    </motion.div>
  )
}

// Compact stat for the cockpit summary panel — tabular display number
// over a small uppercase label. Tone "gold" for the primary today figure,
// "muted" for secondary reads.
function SummaryStat({ label, value, tone = 'muted' }) {
  const valueColor = tone === 'gold' ? 'var(--v3-primary)' : 'var(--v3-text)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{
        fontFamily: 'var(--font-display)',
        fontSize: 22, lineHeight: 1, letterSpacing: '0.02em',
        color: valueColor,
        fontVariantNumeric: 'tabular-nums'
      }}>
        {value}
      </span>
      <span className="v3-eyebrow">
        {label}
      </span>
    </span>
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

function DayView({ events, now, onClick, onDelete, onAdd }) {
  // Per-status counts — drive the All/Live/Upcoming/Done toggle badges
  // and let the filter persist even when zero of a bucket exists today.
  const [stateFilter, setStateFilter] = useState('all')

  const counts = useMemo(() => {
    const c = { all: events.length, live: 0, upcoming: 0, done: 0 }
    for (const e of events) {
      const s = deriveStatus(e, now)
      if (s === 'On Site' || s === 'In Progress') c.live++
      else if (s === 'Done') c.done++
      else c.upcoming++
    }
    return c
  }, [events, now])

  const filtered = useMemo(() => {
    if (stateFilter === 'all') return events
    return events.filter((e) => {
      const s = deriveStatus(e, now)
      if (stateFilter === 'live') return s === 'On Site' || s === 'In Progress'
      if (stateFilter === 'done') return s === 'Done'
      return s === 'Upcoming' || s === 'Scheduled'
    })
  }, [events, stateFilter, now])

  return (
    <>
      {/* DISPATCH STATE TOGGLE — All / Live / Upcoming / Done. Always
          visible (even on empty days) so the operator immediately sees
          the state taxonomy and can filter live work. Ported from the
          v3 design's dispatch-state pattern. */}
      <div className="dispatch-state" role="tablist" aria-label="Filter schedule by status">
        {[
          { id: 'all',      label: 'All',      count: counts.all },
          { id: 'live',     label: 'Live',     count: counts.live },
          { id: 'upcoming', label: 'Upcoming', count: counts.upcoming },
          { id: 'done',     label: 'Done',     count: counts.done }
        ].map((opt) => (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={stateFilter === opt.id}
            className={`dispatch-state__opt${stateFilter === opt.id ? ' is-on' : ''}`}
            onClick={() => { hapticTap(); setStateFilter(opt.id) }}
          >
            {opt.label} <b>{opt.count}</b>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        events.length === 0 ? (
          // True empty day — premium hero treatment. The previous version
          // was a small card floating in the middle of a sea of black;
          // a billion-dollar app fills the space with a confident
          // statement, not a footnote.
          <div style={{
            margin: '24px 20px 0',
            padding: '56px 24px',
            minHeight: '46vh',
            borderRadius: 20,
            background:
              'radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, var(--v3-primary) 12%, transparent) 0%, transparent 60%),' +
              'linear-gradient(180deg, var(--v3-surface), var(--v3-surface-2))',
            border: '1px solid color-mix(in srgb, var(--v3-primary) 22%, var(--v3-border-strong))',
            boxShadow:
              'inset 0 1px 0 rgba(255, 240, 210, 0.06),' +
              '0 24px 64px -28px rgba(0, 0, 0, 0.65)',
            textAlign: 'center',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 18,
            position: 'relative',
            overflow: 'hidden'
          }}>
            {/* Halo glow behind the icon */}
            <div aria-hidden="true" style={{
              position: 'absolute',
              top: '20%', left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 220, height: 220, borderRadius: '50%',
              background: 'radial-gradient(circle, color-mix(in srgb, var(--v3-primary) 22%, transparent) 0%, transparent 70%)',
              pointerEvents: 'none',
              filter: 'blur(8px)'
            }} />
            <div style={{
              width: 72, height: 72, borderRadius: 20,
              background: 'linear-gradient(135deg, #3a2a18, #1a1208)',
              border: '1px solid color-mix(in srgb, var(--v3-primary) 45%, transparent)',
              color: 'var(--v3-primary-bright, var(--v3-primary))',
              display: 'grid', placeItems: 'center',
              boxShadow:
                'inset 0 1px 0 rgba(228,190,111,0.22),' +
                '0 0 28px rgba(228,190,111,0.28),' +
                '0 12px 28px rgba(0,0,0,0.45)',
              position: 'relative', zIndex: 1
            }}>
              <CalendarIcon size={28} aria-hidden="true" strokeWidth={1.8} />
            </div>
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 32, lineHeight: 1.05,
                letterSpacing: '-0.005em',
                color: 'var(--v3-text)'
              }}>
                Day's clear.
              </div>
              <p style={{
                margin: '10px auto 0',
                fontFamily: 'var(--font-body)',
                fontSize: 14,
                color: 'var(--v3-text-muted)',
                lineHeight: 1.5,
                maxWidth: 320
              }}>
                Queue up a job and your crew sees it the second they open the app.
              </p>
            </div>
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => { hapticTap(); onAdd?.() }}
              style={{
                marginTop: 6,
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '14px 24px', borderRadius: 14,
                border: '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)',
                background: 'linear-gradient(180deg, var(--v3-primary-hot, var(--v3-primary)) 0%, var(--v3-primary) 100%)',
                color: 'var(--v3-on-primary)',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                cursor: 'pointer',
                boxShadow:
                  '0 0 0 3px rgba(228, 190, 111, 0.14),' +
                  '0 12px 28px rgba(201, 150, 58, 0.42)',
                WebkitTapHighlightColor: 'transparent',
                position: 'relative', zIndex: 1
              }}
            >
              <Plus size={14} strokeWidth={2.6} />
              Schedule a job
            </motion.button>
          </div>
        ) : (
          // Filtered-empty (events exist, just none in this bucket).
          <div style={{
            margin: '0 20px',
            padding: '20px',
            borderRadius: 14,
            border: '1px dashed var(--v3-border-strong)',
            color: 'var(--v3-text-muted)',
            fontFamily: 'var(--font-body)', fontSize: 13,
            textAlign: 'center'
          }}>
            Nothing in <strong style={{ color: 'var(--v3-text)' }}>{stateFilter}</strong> for this day.
          </div>
        )
      ) : (
        <ul className="fh-timeline" style={{ listStyle: 'none', padding: 0, margin: '0 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((e, i) => {
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
                onDelete={onDelete ? () => onDelete(e.id) : undefined}
                isClickable={Boolean(e.contact_id)}
              />
            )
          })}
        </ul>
      )}
    </>
  )
}

/* Status taxonomy mirrors the mockup pill colors:
     On Site     — currently happening, has a job (contact_id) → green
     In Progress — currently happening, no contact (office/admin) → blue
     Upcoming    — future today → gold
     Scheduled   — future, not today → gray
     Done        — past → muted gray (mockup doesn't show this; quiet) */
const STATUS_TONE = {
  'On Site':     { color: 'var(--v3-stage-active)', soft: 'rgba(79, 140, 94, 0.16)',   border: 'rgba(79, 140, 94, 0.40)' },
  'In Progress': { color: 'var(--v3-stage-lead)',   soft: 'rgba(107, 124, 168, 0.14)', border: 'rgba(107, 124, 168, 0.40)' },
  'Upcoming':    { color: 'var(--v3-primary)',      soft: 'var(--v3-primary-soft)',     border: 'var(--v3-border-gold)' },
  'Scheduled':   { color: 'var(--v3-text-muted)',   soft: 'var(--v3-glass-tint)',       border: 'var(--v3-border-mid)' },
  'Done':        { color: 'var(--v3-text-faint)',   soft: 'var(--v3-glass-tint)',       border: 'var(--v3-border)' }
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

// Status → dispatch-state-pill variant + label mapping.
// 5/17 — ported from v3 design (screens-schedule-estimate.jsx +
// styles-refine.css). LIVE shows the pulsing dot; UP NEXT and UPCOMING
// share the muted "up" pill; DONE uses the soft-gold "done" pill;
// SCHEDULED falls back to the neutral "default" pill.
const PILL_FOR_STATUS = {
  'On Site':     { variant: 'live',    label: 'LIVE' },
  'In Progress': { variant: 'live',    label: 'LIVE' },
  'Upcoming':    { variant: 'up',      label: 'UP NEXT' },
  'Scheduled':   { variant: 'default', label: 'UPCOMING' },
  'Done':        { variant: 'done',    label: 'DONE' }
}

// Split "8:15 AM" into ["8:15", "AM"] for the dispatch-card time
// column (HR stamp above, AM/PM small caption below). Falls back to
// the full string if no space is present.
function splitTime(s) {
  if (!s) return ['—', '']
  const idx = s.lastIndexOf(' ')
  if (idx < 0) return [s, '']
  return [s.slice(0, idx), s.slice(idx + 1)]
}

function ScheduleRow({ index, primary, secondary, startStr, endStr, status, onClick, onDelete, isClickable }) {
  // 5/17 — full visual port of the v3 design's dispatch-card pattern
  // (replaces the prior glass-row with status spine). Time column on
  // the left as HR/AM stamp, title + sub on the right, state pill at
  // the head-row top-right, optional secondary detail line below.
  // The contact avatar/initial was removed — the design's pattern
  // drops it (and reserves the bottom of the card for a future crew
  // row when crews data ships). Delete affordance moves to a top-right
  // absolute trash button so the card surface stays clean.
  const pill = PILL_FOR_STATUS[status] || PILL_FOR_STATUS.Scheduled
  const isLive = pill.variant === 'live'
  const [hrPart, apPart] = splitTime(startStr)

  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={isClickable ? { y: -2 } : undefined}
      transition={{
        opacity: { delay: Math.min(index * 0.04, 0.25), duration: 0.24, ease: [0.2, 0.8, 0.2, 1] },
        y: { type: 'spring', stiffness: 620, damping: 28 }
      }}
      className={`dispatch-card${isLive ? ' is-live' : ''}`}
      style={{ position: 'relative' }}
    >
      <button
        type="button"
        className="dispatch-card__tap"
        onClick={isClickable ? onClick : undefined}
        disabled={!isClickable}
      >
        <div className="dispatch-card__top">
          <div className="dispatch-card__time">
            <div className="dispatch-card__hr">{hrPart}</div>
            {apPart && <div className="dispatch-card__ap">{apPart}</div>}
          </div>
          <div className="dispatch-card__body">
            <div className="dispatch-card__head-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="dispatch-card__title">{primary}</div>
                {secondary && (
                  <div className="dispatch-card__sub">{secondary}</div>
                )}
              </div>
              <span className={`dispatch-state-pill dispatch-state-pill--${pill.variant}`}>
                {pill.label}
              </span>
            </div>
            {endStr && (
              <div className="dispatch-card__addr">
                <Clock size={10} aria-hidden="true" />
                Ends {endStr}
              </div>
            )}
          </div>
        </div>
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={(ev) => { ev.stopPropagation(); onDelete() }}
          aria-label="Delete event"
          style={{
            position: 'absolute',
            // Bottom-right instead of top-right — top-right is where
            // the LIVE / UP NEXT status pill lives, and stacking the
            // trash icon next to it looked crowded ("UP NEXT🗑️").
            bottom: 8,
            right: 8,
            width: 28, height: 28, borderRadius: 8,
            border: 'none', background: 'transparent',
            color: 'var(--v3-text-muted)',
            cursor: 'pointer', display: 'grid', placeItems: 'center',
            opacity: 0.35,
            WebkitTapHighlightColor: 'transparent',
            transition: 'opacity 160ms ease, color 160ms ease'
          }}
          onMouseEnter={(ev) => { ev.currentTarget.style.opacity = '1'; ev.currentTarget.style.color = 'var(--v3-danger-bright)' }}
          onMouseLeave={(ev) => { ev.currentTarget.style.opacity = '0.35'; ev.currentTarget.style.color = 'var(--v3-text-muted)' }}
        >
          <Trash2 size={12} />
        </button>
      )}
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
                      onClick={(ev) => { ev.stopPropagation(); onDelete(e.id) }}
                      aria-label="Delete event"
                      style={{
                        position: 'absolute', top: 0, right: 0,
                        width: 40, height: 40, borderRadius: 10,
                        border: 'none', background: 'transparent',
                        color: 'var(--v3-text-muted)',
                        cursor: 'pointer', display: 'grid', placeItems: 'center',
                        opacity: 0.6,
                        WebkitTapHighlightColor: 'transparent'
                      }}
                      onMouseEnter={(ev) => { ev.currentTarget.style.opacity = '1'; ev.currentTarget.style.color = 'var(--v3-danger-bright)' }}
                      onMouseLeave={(ev) => { ev.currentTarget.style.opacity = '0.6'; ev.currentTarget.style.color = 'var(--v3-text-muted)' }}
                    >
                      <Trash2 size={13} />
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

