import { eventAssignees } from '../lib/scheduleAllocation.ts'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Plus, Calendar as CalendarIcon, Clock, MapPin, ChevronLeft, ChevronRight, Trash2, Pencil } from 'lucide-react'
import { toast, toastSuccess, toastUndo, toastError } from '../lib/toast.ts'
import { SkeletonList } from '../components/Skeleton.tsx'
import { ScreenCloser, Eyebrow } from '../components/v3'
import { Button, Chip, EmptyState } from '../components/fh'
import { useArmedId } from '../lib/secondTap.ts'
import { supabase } from '../lib/supabase.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import {
  useScheduleEvents,
  useUpcomingEvents,
  useInvalidateSchedule,
  useDropScheduleEvent,
  useBookedVisits,
  useCompanyJobs
} from '../lib/queries.ts'
import { useProfile } from '../contexts/ProfileContext.tsx'
import { getWeather } from '../lib/weather.ts'
import { assessWorkWindow } from '../lib/forecastAssessment.ts'
import { hapticTap, hapticMedium } from '../lib/haptics.ts'
import { useFhMotion } from '../lib/motion.ts'
import { useIsDesktop } from '../lib/useMediaQuery.ts'
import { SCHEDULE_WEEK_START, startOfWeek } from '../lib/scheduleDates.ts'
import { jobLabel, trayJobs } from '../lib/scheduleBoard.ts'
import './schedule/schedule-event.css'
const SnowSchedule = lazy(() => import('../components/desktop/SnowScheduleBuild.tsx'))

const VIEWS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' }
]

function startOfDay(d: any) { const x = new Date(d); x.setHours(0,0,0,0); return x }
function addDays(d: any, n: any) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function sameDay(a: any, b: any) { return a.toDateString() === b.toDateString() }
function fmtDate(d: any) { return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) }
function fmtTime(iso: any) { return iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '' }

const WEATHERBAR_TONE: Record<string, string> = { go: 'good', warn: 'ok', stop: 'poor' }

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
      if (v === 'day' || v === 'week' || v === 'month') return v
      return window.matchMedia('(min-width: 900px)').matches ? 'week' : 'day'
    } catch { return 'day' }
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    try { window.localStorage.setItem('fh:schedule:view', view) } catch {}
  }, [view])
  const [cursor, setCursor] = useState(initialCursor)
  const isDesktop = useIsDesktop()

  // Range bounds for the current day/week/month grid. Only depends on
  // view + cursor; feeds the scheduled-events query below.
  const range = useMemo(() => {
    if (view === 'day') return { start: cursor, end: addDays(cursor, 1) }
    if (view === 'week') {
      // Both responsive layouts show and fetch the same Sunday week.
      const s = startOfWeek(cursor, SCHEDULE_WEEK_START)
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
  // The board says a range could not be read only when no read of it has
  // worked (isLoadingError). After a failed refresh the visits it read stay
  // on screen, and a range that read as empty keeps saying so.
  const {
    data: events = null,
    isPending: eventsPending,
    isPlaceholderData: eventsPlaceholder,
    isLoadingError: eventsFailed,
    refetch: refetchEvents
  } = useScheduleEvents(
    user?.id,
    range.start.toISOString(),
    range.end.toISOString()
  )
  // Up next keeps its read's state, so the desktop rail can show a
  // skeleton while it is out and an error when it fails, and says nothing
  // is scheduled only after a read that found nothing.
  const upcomingQuery = useUpcomingEvents(user?.id)
  const upcoming = upcomingQuery.data ?? []
  const invalidateSchedule = useInvalidateSchedule()
  const dropScheduleEvent = useDropScheduleEvent()
  const loading = eventsPending
  // The desktop board also waits while a new week or day loads: until then
  // the cache holds the last range (keepPreviousData), whose visits the
  // board filters out, so it would read as an empty week.
  const boardLoading = eventsPending || eventsPlaceholder
  // Aliases so the existing delete/undo + FAB-save call sites keep working.
  const load = invalidateSchedule
  const loadUpcoming = invalidateSchedule

  const [weather, setWeather] = useState<any>(null)
  const [weatherFailed, setWeatherFailed] = useState(false)
  // Adding and editing a visit are screens of their own (Phase 9, Task 13,
  // D57): /schedule/new, with ?job= and ?title= when the desktop tray's
  // Schedule button names the visit after its job, and /schedule/:id/edit.
  function openNewEvent(preset?: { contactId: string; title: string }) {
    const sp = new URLSearchParams()
    if (preset) {
      sp.set('job', preset.contactId)
      if (preset.title) sp.set('title', preset.title)
    }
    const qs = sp.toString()
    navigate(`/schedule/new${qs ? `?${qs}` : ''}`)
  }
  function openEditEvent(event: any) {
    if (event?.id) navigate(`/schedule/${encodeURIComponent(event.id)}/edit`)
  }
  // Delete asks with a second tap on the row's own button (D57).
  const deleteTap = useArmedId()

  // If the URL had ?d=year month day, consume it once so the back button
  // doesn't keep forcing the cursor back to that day.
  useEffect(() => {
    if (params.get('d')) {
      const next = new URLSearchParams(params)
      next.delete('d')
      setParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Both DayView and WeekView delete affordances funnel through here: the
  // first tap arms that row's button, the second deletes (with Undo).
  function requestDeleteEvent(evtId: any) {
    if (!evtId) return
    deleteTap.tap(String(evtId), () => { void deleteEvent(evtId) })
  }

  async function deleteEvent(evtId: any) {
    if (!evtId) return
    // Snapshot before deletion so Undo can re-insert. Strip generated
    // fields and the joined relation; only re-insert the source row.
    const snapshot = (events || []).find((e: any) => e.id === evtId) || (upcoming || []).find((e: any) => e.id === evtId)

    // Recurring series: delete every occurrence sharing the series id
    // (stored in `recurring`) so we don't orphan the other rows, and
    // restore the whole series on Undo.
    // No user_id filter: the schedule is company wide (RLS scopes the
    // org), so a teammate's event must delete too. .select('id') turns a
    // zero row delete into a visible failure instead of a false success.
    const seriesId = (snapshot as any)?.recurring
    if (seriesId) {
      const { data: seriesRows } = await supabase
        .from('fh_schedule').select('*').eq('recurring', seriesId)
      const { data: removed, error: serr } = await supabase
        .from('fh_schedule').delete().eq('recurring', seriesId).select('id')
      if (serr) { toastError("Couldn't delete", serr.message); return }
      if (!removed?.length) { toastError("Couldn't delete", 'This series was not removed. Refresh and try again.'); return }
      for (const r of removed) dropScheduleEvent((r as any).id)
      const n = removed.length
      toastUndo(`Series deleted · ${n} event${n === 1 ? '' : 's'}`, {
        description: snapshot?.title || 'Tap Undo to restore',
        onUndo: async () => {
          // eslint-disable-next-line no-unused-vars
          const rows = (seriesRows || []).map(({ fh_contacts, ...row }: any) => row)
          if (rows.length) {
            const { error: insErr } = await supabase.from('fh_schedule').insert(rows)
            if (insErr) { toastError("Couldn't undo", insErr.message); return }
          }
          load(); loadUpcoming()
          toastSuccess('Restored', snapshot?.title || '')
        }
      })
      return
    }

    const { data: removed, error } = await supabase.from('fh_schedule').delete().eq('id', evtId).select('id')
    if (error) {
      toastError("Couldn't delete", error.message)
      return
    }
    if (!removed?.length) {
      toastError("Couldn't delete", 'This event was not removed. Refresh and try again.')
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
    setWeatherFailed(false)
    getWeather(profile.location_lat as any, profile.location_lon as any)
      .then(setWeather)
      .catch(() => setWeatherFailed(true))
  }, [hasCoords, profile?.location_lat, profile?.location_lon])

  function shift(n: any) {
    if (view === 'day') setCursor((d) => addDays(d, n))
    else if (view === 'month') shiftMonth(n)
    else setCursor((d) => addDays(d, 7 * n))
  }

  // Month nav (header chevrons) shifts the cursor by N months while
  // keeping the day-of-month if it exists in the new month, else the last
  // day. The week strip below the nav re-anchors automatically because
  // cursor changed.
  function shiftMonth(n: any) {
    setCursor((d) => {
      const next = new Date(d.getFullYear(), d.getMonth() + n, 1)
      const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
      next.setDate(Math.min(d.getDate(), lastDay))
      next.setHours(0, 0, 0, 0)
      return next
    })
  }

  const windowRead = useMemo(
    () => assessWorkWindow(weather?.current, profile?.services || []),
    [weather, profile?.services]
  )

  // 5/17, daily forecast map keyed by year month day so the Week strip
  // can render a tiny high/precip badge under each date. Addresses the
  // 5/13 audit's "Schedule should have a weather overlay (you already
  // have the forecast data!)" complaint. getWeather now fetches 7
  // days (was 3) so a full visible week has data. Cells outside the
  // forecast horizon fall back to no badge, silent, not "\u2003".
  const dailyForecast = useMemo(() => {
    const d = weather?.daily
    if (!d?.time?.length) return {}
    const out: Record<string, any> = {}
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

  function dayKey(d: any) {
    // Local-time year month day, NOT toISOString (which converts to UTC and
    // can skew the date by one day for east-of-UTC locales like CDT/CST).
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  const { stagger, item } = useFhMotion()

  // The header names one day, so count that day's visits, not every
  // event in the fetched week or month grid.
  const cursorDayCount = (events || []).filter((e: any) => sameDay(new Date(e.start_at), cursor)).length

  // Phase 7, desktop-first composition. At >=900px the planner +
  // upcoming rail workspace replaces the narrow mobile dispatch
  // board. Mobile <900px keeps every feature of the existing
  // motion.div.v3-screen--schedule flow (month grid, week / day
  // toggles, weather strip, FAB add-event) verbatim.
  if (isDesktop) {
    return (
      <>
        <Suspense fallback={null}>
          <SnowSchedule
            events={events}
            loading={boardLoading}
            failed={eventsFailed}
            onRetry={() => { void refetchEvents() }}
            upcoming={upcomingQuery.data ?? null}
            upcomingLoading={upcomingQuery.isPending}
            upcomingFailed={upcomingQuery.isError}
            onRetryUpcoming={() => { void upcomingQuery.refetch() }}
            cursor={cursor}
            setCursor={setCursor}
            view={view}
            setView={setView}
            weather={hasCoords && !weatherFailed ? weather : undefined}
            onAddEvent={() => openNewEvent()}
            onNewJob={() => navigate('/jobs/new')}
            onScheduleJob={(job) => openNewEvent({ contactId: job.id, title: jobLabel(job) })}
            onOpenEvent={openEditEvent}
          />
        </Suspense>
      </>
    )
  }

  return (
    <motion.div className="v3-screen v3-screen--schedule" variants={stagger} initial="hidden" animate="show" style={{ position: 'relative', background: 'var(--v3-bg)' }}>
      {/* COMPACT HEADER, matches design's app-head--titled pattern.
          Eyebrow gives context ("Tue · May 20 · 4 visits"), h1 anchors
          the screen. Stats live inline under the eyebrow instead of
          inside a heavy black-glass panel. */}
      <motion.div variants={item} style={{ padding: '12px 24px 4px' }}>
        <Eyebrow as="div" tone="gold" style={{ marginBottom: 6 }}>
          {cursor.toLocaleDateString(undefined, { weekday: 'short' })} ·{' '}
          {cursor.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          {cursorDayCount > 0 && (
            <> · {cursorDayCount} {cursorDayCount === 1 ? 'visit' : 'visits'}</>
          )}
        </Eyebrow>
        <div className="fhs-screen-head">
          <h1 style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontSize: 24,
            lineHeight: 1, letterSpacing: 0,
            color: 'var(--v3-text)'
          }}>
            Schedule
          </h1>
          <Button variant="secondary" size="mini" icon={Plus} onClick={() => openNewEvent()}>
            New event
          </Button>
        </div>
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

      {/* WEATHER STRIP. The stylesheet names its tones good, ok and poor;
          the work window reports go, warn and stop, so map them, and stay
          neutral until a forecast has actually loaded. */}
      {hasCoords && (
        <motion.div variants={item} className={`fh-weatherbar${weather?.current ? ` fh-weatherbar--${WEATHERBAR_TONE[windowRead.status] || 'neutral'}` : ''}`} style={{ margin: '10px 20px 0' }}>
          <span className="fh-weatherbar__dot" aria-hidden="true" />
          <span className="fh-weatherbar__label">{weather?.current ? windowRead.label : weatherFailed ? 'Forecast unavailable' : 'Loading forecast'}</span>
          {windowRead.reasons.length > 0 && <span className="fh-weatherbar__reason">{windowRead.reasons.slice(0, 2).join(' · ')}</span>}
        </motion.div>
      )}

      {/* Range navigation follows the selected calendar view. */}
      <motion.div variants={item} className="fhev-range">
        <div className="fhev-range__nav">
          <div className="fhev-range__arrows">
            <button
              type="button"
              onClick={() => view === 'month' ? shiftMonth(-1) : setCursor((d) => addDays(d, -7))}
              aria-label={view === 'month' ? 'Previous month' : 'Previous week'}
              style={chevBtnStyle}
            >
              <ChevronLeft size={16} />
            </button>
            <span style={{
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 0,
              color: 'var(--v3-text)',
              fontVariantNumeric: 'tabular-nums',
              minWidth: 0,
              textAlign: 'center'
            }}>
              {view === 'month' ? cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : `Week of ${startOfWeek(cursor, SCHEDULE_WEEK_START).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
            </span>
            <button
              type="button"
              onClick={() => view === 'month' ? shiftMonth(1) : setCursor((d) => addDays(d, 7))}
              aria-label={view === 'month' ? 'Next month' : 'Next week'}
              style={chevBtnStyle}
            >
              <ChevronRight size={16} />
            </button>
          </div>

        </div>
      </motion.div>

      {/* WEEK STRIP, 7 cells anchored to Sunday. Highlighted cell = cursor;
          ring around today (when not selected). Tap any day to jump. */}
      {/* One week of dates; selecting a date opens its daily agenda. */}
      <motion.div variants={item}>
        <div className="dispatch-strip fhev-week-strip" aria-label="Selected calendar week">
          {Array.from({ length: 7 }, (_, i) => {
            const today = startOfDay(new Date())
            const day = addDays(startOfWeek(cursor, SCHEDULE_WEEK_START), i)
            const isSelected = sameDay(day, cursor)
            const isToday = sameDay(day, today)
            const dayName = day.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3)
            const dayNum = day.getDate()
            const forecastFor = dailyForecast[dayKey(day)] || null
            const hasJobsPip = forecastFor && forecastFor.precipProb >= 50
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => { hapticTap(); setCursor(startOfDay(day)); setView('day') }}
                aria-label={day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                aria-pressed={isSelected}
                className={`dispatch-day${isToday ? ' is-today' : ''}${isSelected && !isToday ? ' is-selected' : ''}`}
              >
                <span className="dispatch-day__dow">{dayName}</span>
                <span className="dispatch-day__num">{dayNum}</span>
                {forecastFor && forecastFor.high != null && (
                  <span style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: 12,
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

      {/* DAY / WEEK / MONTH toggle, uses the same dispatch-state pill
          pattern as the ALL/LIVE/UPCOMING/DONE row below it, so the two
          toggles read as siblings. Replaced the older SpecTabs boxy
          chips that didn't match the rest of the v3 dispatch-* family. */}
      <motion.div variants={item} className="fhev-view-controls" style={{ padding: '0 var(--v3-gutter) 12px' }}>
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
          <button
            type="button"
            onClick={() => setCursor(startOfDay(new Date()))}
            style={{
              padding: '8px 12px', borderRadius: 10,
              border: '1px solid var(--v3-border-strong)',
              background: 'var(--v3-surface)',
              color: 'var(--v3-text)',
              fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
              letterSpacing: 0,
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            Today
          </button>
      </motion.div>

      {/* Swipe-detector wraps the per-view body. Horizontal pointer drag
          past 60 px shifts the cursor by 1 (left = next, right = prev),
          giving phone users the same gesture they expect from native
          calendar apps. Vertical scroll inside the body still works. */}
      {/* DAY HEADER, "TUE, APR 28" eyebrow that titles the timeline */}
      {view === 'day' && (
        <motion.div variants={item} style={{ padding: '0 var(--v3-gutter) 8px' }}>
          <Eyebrow>
            {cursor.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </Eyebrow>
        </motion.div>
      )}

      {/* TIMELINE, vertical time-block list. Matches mockup: each row
          is a job block with time, name, sub, status pill, avatar group. */}
      <SwipeShell onShift={shift}>
        <motion.div variants={item} style={{ padding: '0 var(--v3-gutter) 24px' }}>
          {loading && events == null && <SkeletonList rows={5} card={false} />}
          {events != null && view === 'day' && (
            <DayView
              events={events}
              now={new Date()}
              onClick={(id: any) => navigate(`/jobs/${id}`)}
              onEdit={openEditEvent}
              onDelete={requestDeleteEvent}
              deleteArmedId={deleteTap.armedId}
              onAdd={() => openNewEvent()}
            />
          )}
          {events != null && view === 'week' && (
            <WeekView
              start={range.start}
              events={events}
              onClick={(id: any) => navigate(`/jobs/${id}`)}
              onEdit={openEditEvent}
              onDay={(day: Date) => { setCursor(startOfDay(day)); setView('day') }}
              onDelete={requestDeleteEvent}
              deleteArmedId={deleteTap.armedId}
            />
          )}
          {events != null && view === 'month' && (
            // 5/17, month view was implemented in MonthView() but never
            // exposed in the VIEWS toggle. Wiring it in gives the
            // contractor the long-horizon planner audit flagged as
            // missing. Range memo already returns a 6-week window so
            // events outside the visible month still hydrate their
            // day badges. Tapping a day jumps to that day in Day view.
            <MonthView
              cursor={cursor}
              events={events}
              onDay={(d: any) => { hapticTap(); setCursor(startOfDay(d)); setView('day') }}
            />
          )}
        </motion.div>
      </SwipeShell>

      <MobileUnscheduledJobs onSchedule={(job) => openNewEvent({ contactId: job.id, title: jobLabel(job) })} />
      <ScreenCloser caption="Tap a day above to plan the week ahead." />
    </motion.div>
  )
}

// Compact stat for the cockpit summary panel, tabular display number
// over a small uppercase label. Tone "gold" for the primary today figure,
// "muted" for secondary reads.
function SummaryStat({ label, value, tone = 'muted' }: any) {
  const valueColor = tone === 'gold' ? 'var(--v3-primary-text)' : 'var(--v3-text)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{
        fontFamily: 'var(--font-display)',
        fontSize: 20, lineHeight: 1, letterSpacing: 0,
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
function SwipeShell({ onShift, children }: any) {
  const startRef = useRef<any>(null)
  function onPointerDown(e: any) {
    startRef.current = { x: e.clientX, y: e.clientY, time: Date.now() }
  }
  function onPointerUp(e: any) {
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
  borderRadius: 10,
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
  width: 44,
  height: 44,
  borderRadius: 10,
  border: '1px solid var(--v3-border-strong)',
  background: 'var(--v3-surface)',
  color: 'var(--v3-text)',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent'
}

function DayView({ events, now, onClick, onEdit, onDelete, deleteArmedId, onAdd }: any) {
  // Per-status counts, drive the All/Live/Upcoming/Done toggle badges
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
    return events.filter((e: any) => {
      const s = deriveStatus(e, now)
      if (stateFilter === 'live') return s === 'On Site' || s === 'In Progress'
      if (stateFilter === 'done') return s === 'Done'
      return s === 'Upcoming' || s === 'Scheduled'
    })
  }, [events, stateFilter, now])

  return (
    <>
      {/* DISPATCH STATE TOGGLE, All / Live / Upcoming / Done. Always
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
          <EmptyState
            className="fhev-empty-day"
            icon={CalendarIcon}
            title="Day’s clear."
            action={<Button icon={Plus} onClick={() => { hapticTap(); onAdd?.() }}>New event</Button>}
          />
        ) : (
          // Filtered-empty (events exist, just none in this bucket).
          <div style={{
            margin: '0 20px',
            padding: '24px',
            borderRadius: 10,
            border: '1px dashed var(--v3-border-strong)',
            color: 'var(--v3-text-muted)',
            fontFamily: 'var(--font-body)', fontSize: 14,
            textAlign: 'center'
          }}>
            Nothing in <strong style={{ color: 'var(--v3-text)' }}>{stateFilter}</strong> for this day.
          </div>
        )
      ) : (
        <ul className="fh-timeline fhev-day" aria-label="Daily agenda" style={{ listStyle: 'none', padding: 0, margin: '0 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((e: any, i: any) => {
            const status = deriveStatus(e, now)
            const start = fmtTime(e.start_at)
            const end = e.end_at ? fmtTime(e.end_at) : null
            const primary = e.fh_contacts?.name || e.title || 'Untitled'
            const secondary = e.fh_contacts?.name && e.title ? e.title : (e.description || (e.contact_id ? '' : 'Manual event'))
            const initial = (primary || '·').trim().charAt(0).toUpperCase()
            // A lead's estimate or a quote's visit has no job behind it (D60).
            const kind = e.lead_id ? 'Lead' : e.quote_id ? 'Quote' : null
            return (
              <ScheduleRow
                key={e.id}
                index={i}
                primary={primary}
                secondary={secondary}
                kind={kind}
                crewCount={eventAssignees(e).length}
                startStr={start}
                endStr={end}
                status={status}
                initial={initial}
                onClick={() => e.contact_id ? onClick(e.contact_id) : onEdit?.(e)}
                onEdit={onEdit ? () => onEdit(e) : undefined}
                onDelete={onDelete ? () => onDelete(e.id) : undefined}
                deleteArmed={deleteArmedId === e.id}
                isClickable={Boolean(e.contact_id || onEdit)}
              />
            )
          })}
        </ul>
      )}
    </>
  )
}

/* Status taxonomy mirrors the mockup pill colors:
     On Site    , currently happening, has a job (contact_id) → green
     In Progress, currently happening, no contact (office/admin) → blue
     Upcoming   , future today → gold
     Scheduled  , future, not today → gray
     Done       , past → muted gray (mockup doesn't show this; quiet) */
const STATUS_TONE: Record<string, any> = {
  'On Site':     { color: 'var(--v3-stage-active)', soft: 'rgba(45, 122, 79, 0.16)',   border: 'rgba(45, 122, 79, 0.40)' },
  'In Progress': { color: 'var(--v3-stage-lead)',   soft: 'rgba(92, 92, 92, 0.14)', border: 'rgba(92, 92, 92, 0.40)' },
  'Upcoming':    { color: 'var(--v3-primary-text)',      soft: 'var(--v3-primary-soft)',     border: 'var(--v3-border-gold)' },
  'Scheduled':   { color: 'var(--v3-text-muted)',   soft: 'var(--v3-glass-tint)',       border: 'var(--v3-border-mid)' },
  'Done':        { color: 'var(--v3-text-faint)',   soft: 'var(--v3-glass-tint)',       border: 'var(--v3-border)' }
}

function deriveStatus(e: any, now: any) {
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
// 5/17, ported from v3 design (screens-schedule-estimate.jsx +
// styles-refine.css). LIVE shows the pulsing dot; UP NEXT and UPCOMING
// share the muted "up" pill; DONE uses the soft-gold "done" pill;
// SCHEDULED falls back to the neutral "default" pill.
const PILL_FOR_STATUS: Record<string, any> = {
  'On Site':     { variant: 'live',    label: 'Live' },
  'In Progress': { variant: 'live',    label: 'Live' },
  'Upcoming':    { variant: 'up',      label: 'Up next' },
  'Scheduled':   { variant: 'default', label: 'Upcoming' },
  'Done':        { variant: 'done',    label: 'Done' }
}

// Split "8:15 AM" into ["8:15", "AM"] for the dispatch-card time
// column (HR stamp above, AM/PM small caption below). Falls back to
// the full string if no space is present.
function splitTime(s: any) {
  if (!s) return ['\u2003', '']
  const idx = s.lastIndexOf(' ')
  if (idx < 0) return [s, '']
  return [s.slice(0, idx), s.slice(idx + 1)]
}

function ScheduleRow({ index, primary, secondary, kind, crewCount, startStr, endStr, status, onClick, onEdit, onDelete, deleteArmed, isClickable }: any) {
  // Full-width event content and explicit actions remain usable with touch or keyboard.
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
                <div className="dispatch-card__title">
                  {primary}
                  {kind && <Chip label={kind} style={{ marginLeft: 8, verticalAlign: 'middle' }} />}
                </div>
                {secondary && (
                  <div className="dispatch-card__sub">{secondary}</div>
                )}
              </div>
              <span className={`dispatch-state-pill dispatch-state-pill--${pill.variant}`}>
                {pill.label}
              </span>
            </div>
            {crewCount > 0 && <div className="dispatch-card__sub">{crewCount} crew assigned</div>}
            {endStr && (
              <div className="dispatch-card__addr">
                <Clock size={10} aria-hidden="true" />
                Ends {endStr}
              </div>
            )}
          </div>
        </div>
      </button>
      {(onEdit || onDelete) && <div className="fhev-day__actions">
        {onEdit && <Button size="mini" variant="quiet" icon={Pencil} onClick={onEdit}>Edit event</Button>}
        {onDelete && <Button size="mini" variant="destructive" icon={Trash2}
          onClick={onDelete} aria-label={deleteArmed ? 'Tap again to delete' : 'Delete event'}
          aria-pressed={deleteArmed ? true : undefined}>
          {deleteArmed ? 'Tap again' : 'Delete'}
        </Button>}
      </div>}
    </motion.li>
  )
}

// On a phone, event titles need the full reading width. A week grid
// reduced each appointment to 30 px and left manual events with a dead tap.
function WeekView({ start, events, onClick, onEdit, onDay, onDelete, deleteArmedId }: any) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
    .filter(day => events.some((event: any) => sameDay(new Date(event.start_at), day)))
  if (!days.length) return <EmptyState icon={CalendarIcon} title="No visits this week. Choose a day above to plan one." />
  return (
    <div className="fhev-agenda" aria-label="Weekly agenda">
      {days.map((day) => {
        const dayEvents = events
          .filter((event: any) => sameDay(new Date(event.start_at), day))
          .sort((a: any, b: any) => Date.parse(a.start_at) - Date.parse(b.start_at))
        const label = day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
        return (
          <section className="fhev-agenda__day" key={day.toISOString()} aria-label={label}>
            <button type="button" className="fhev-agenda__date" onClick={() => onDay(day)}>
              <span>{label}</span>
              <span>{dayEvents.length ? `${dayEvents.length} ${dayEvents.length === 1 ? 'visit' : 'visits'}` : 'No visits'}</span>
            </button>
            {dayEvents.length > 0 && <ul className="fhev-agenda__events">
              {dayEvents.map((event: any) => (
                <li key={event.id} className="fhev-agenda__event">
                  <button type="button" className="fhev-agenda__open" onClick={() => event.contact_id ? onClick(event.contact_id) : onEdit(event)}>
                    <span className="fhev-agenda__time">{fmtTime(event.start_at)}{event.end_at ? ` – ${fmtTime(event.end_at)}` : ''}</span>
                    <strong>{event.title || event.fh_contacts?.name || 'Untitled event'}</strong>
                    {event.fh_contacts?.name && event.title !== event.fh_contacts.name && <span>{event.fh_contacts.name}</span>}
                    {eventAssignees(event).length > 0 && <span>{eventAssignees(event).length} crew assigned</span>}
                  </button>
                  <div className="fhev-agenda__actions">
                    <Button size="mini" variant="quiet" icon={Pencil} onClick={() => onEdit(event)}>Edit event</Button>
                    {onDelete && <Button size="mini" variant="destructive" icon={Trash2}
                      aria-label={deleteArmedId === event.id ? 'Tap again to delete' : 'Delete event'}
                      aria-pressed={deleteArmedId === event.id || undefined}
                      onClick={() => onDelete(event.id)}>{deleteArmedId === event.id ? 'Tap again to delete' : 'Delete'}</Button>}
                  </div>
                </li>
              ))}
            </ul>}
          </section>
        )
      })}
    </div>
  )
}

function MonthView({ cursor, events, onDay }: any) {
  // 6-week grid (always 42 cells) so the layout is stable across
  // months. Days from the prev/next month are rendered dimmed instead
  // of as blank slots, matches every standard calendar app.
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const gridStart = addDays(monthStart, -monthStart.getDay())
  const today = startOfDay(new Date())
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const currentMonth = cursor.getMonth()

  return (
    <div className="fh-month">
      {['S','M','T','W','T','F','S'].map((d, i) => <span key={i} className="fh-month__dow">{d}</span>)}
      {cells.map((d) => {
        const dayEvents = events.filter((e: any) => sameDay(new Date(e.start_at), d))
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


function MobileUnscheduledJobs({ onSchedule }: { onSchedule: (job: import('../lib/queries.ts').JobRow) => void }) {
  const { user } = useAuth()
  const jobs = useCompanyJobs()
  const from = startOfDay(new Date()).toISOString()
  const booked = useBookedVisits(user?.id, from)
  const available = jobs.data && booked.data ? trayJobs(jobs.data, booked.data.map((row) => row.contact_id), new Set()) : null
  const failed = jobs.isError || booked.isError
  return (
    <section className="fhev-unscheduled" aria-label="Unscheduled jobs">
      <h2>Unscheduled jobs</h2>
      {jobs.isPending || booked.isPending ? <SkeletonList rows={2} card={false} /> : <>
        {failed && <div role="alert"><p>Could not refresh unscheduled jobs.</p><Button variant="secondary" size="mini" onClick={() => { void jobs.refetch(); void booked.refetch() }}>Try again</Button></div>}
        {available && available.length === 0 && <p>Every active job has a date.</p>}
        {available && available.length > 0 && <details><summary>Show {available.length} unscheduled jobs</summary><ul>{available.map((job) => <li key={job.id}><div><strong>{jobLabel(job)}</strong>{job.address && <p>{job.address}</p>}</div><Button variant="secondary" size="mini" aria-label={`Schedule ${jobLabel(job)}`} onClick={() => onSchedule(job)}>Schedule</Button></li>)}</ul></details>}
      </>}
    </section>
  )
}
