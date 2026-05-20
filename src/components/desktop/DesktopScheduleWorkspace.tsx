import { useMemo } from 'react'
import { Plus, Calendar as CalendarIcon, ChevronLeft, ChevronRight, MapPin } from 'lucide-react'
import { hapticTap, hapticMedium } from '../../lib/haptics.ts'

/**
 * DesktopScheduleWorkspace — desktop-first composition for /schedule
 * at >=900px.
 *
 * Phase 7 of the Responsive Desktop Command Center. Replaces the
 * narrow mobile dispatch board with a real planner workspace: a
 * 7-day strip + day timeline on the left (~1.6fr) and an upcoming
 * 7-day rail on the right (~1fr). The reference handoff has only a
 * mobile schedule mockup, so this composition is designed from
 * `dt-content` + `dt-grid` scaffolding.
 *
 *   ┌─ page header ────────────────────────────────────────────────┐
 *   │ EYEBROW                                       [+ New event]  │
 *   │ Schedule                                                      │
 *   │ Week of {Mon} · {n} visits today                             │
 *   ├─ planner + upcoming rail (1.6fr / 1fr) ─────────────────────┤
 *   │ ┌─────────────── planner ───────────┐  ┌─ upcoming · 7d ─┐ │
 *   │ │ [Mon][Tue·on][Wed][Thu][Fri][Sat] │  │ Tomorrow         │ │
 *   │ │ ─────────────────────────────────  │  │   • event row    │ │
 *   │ │ {timeline of today's events}       │  │ Wed Apr 30       │ │
 *   │ │   8:15 AM · MMC Properties        │  │   • event row    │ │
 *   │ │   10:30 AM · Material delivery    │  │ ...              │ │
 *   │ └────────────────────────────────────┘  └──────────────────┘ │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Empty state: planner shows a centered "No visits scheduled today"
 * card, upcoming rail shows the next 7 days with any forward events
 * grouped by day. The desktop canvas always feels filled — never
 * collapses to a phone-shaped column.
 */

function startOfDay(d: any) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function dayLabel(d: any, opts: any = {}) {
  return new Date(d).toLocaleDateString(undefined, opts)
}

function timeLabel(d: any) {
  return new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function eventStartMs(evt: any) {
  if (!evt) return 0
  const t = evt.start_at || evt.starts_at || evt.scheduled_at || evt.start_date || evt.date
  if (!t) return 0
  const ms = new Date(t).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function isSameDay(a: any, b: any) {
  const da = startOfDay(a)
  const db = startOfDay(b)
  return da.getTime() === db.getTime()
}

function buildWeekStrip(cursor: any) {
  const start = startOfDay(cursor)
  start.setDate(start.getDate() - start.getDay())  // Sunday-anchored week
  return Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    return d
  })
}

export default function DesktopScheduleWorkspace({
  events,
  upcoming,
  loading,
  cursor,
  setCursor,
  view,
  setView,
  onAddEvent
}: any) {
  const today = useMemo(() => startOfDay(new Date()), [])
  const week = useMemo(() => buildWeekStrip(cursor || today), [cursor, today])

  // Today's / cursor's events — filter the events array down to
  // entries that fall on the current cursor day. Sorted by start.
  const dayEvents = useMemo(() => {
    if (!Array.isArray(events)) return []
    const c = cursor || today
    return events
      .filter((e) => {
        const ms = eventStartMs(e)
        if (!ms) return false
        return isSameDay(new Date(ms), c)
      })
      .sort((a, b) => eventStartMs(a) - eventStartMs(b))
  }, [events, cursor, today])

  // Upcoming, grouped by day, capped at 6 days forward.
  const upcomingByDay = useMemo(() => {
    if (!Array.isArray(upcoming)) return []
    const c = cursor || today
    const map = new Map()
    for (const evt of upcoming) {
      const ms = eventStartMs(evt)
      if (!ms) continue
      const day = startOfDay(new Date(ms))
      if (day.getTime() <= c.getTime()) continue   // skip today + past
      const key = day.getTime()
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(evt)
    }
    const buckets = Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(0, 6)
      .map(([key, evts]) => ({
        date: new Date(key),
        events: evts.sort((a: any, b: any) => eventStartMs(a) - eventStartMs(b))
      }))
    return buckets
  }, [upcoming, cursor, today])

  function shiftDay(delta: any) {
    const next = new Date(cursor || today)
    next.setDate(next.getDate() + delta)
    setCursor(startOfDay(next))
  }

  function jumpToToday() { setCursor(today) }

  return (
    <div className="dt-schedule">
      {/* PAGE HEADER */}
      <header className="dt-schedule__head">
        <div className="dt-schedule__head-text">
          <span className="dt-schedule__eyebrow">
            {dayLabel(cursor || today, { weekday: 'long', month: 'short', day: 'numeric' })}
            {dayEvents.length > 0 && <> · <strong>{dayEvents.length}</strong> {dayEvents.length === 1 ? 'visit' : 'visits'}</>}
          </span>
          <h1 className="dt-schedule__h1">Schedule</h1>
          <p className="dt-schedule__sub">
            {Array.isArray(upcoming) && upcoming.length > 0
              ? <>Next 7 days · <strong>{upcoming.length}</strong> {upcoming.length === 1 ? 'event' : 'events'}</>
              : 'A clear week — drop in the next visit when ready.'}
          </p>
        </div>
        <div className="dt-schedule__head-actions">
          <button
            type="button"
            className="dt-schedule__primary"
            onClick={() => { hapticMedium(); onAddEvent?.() }}
          >
            <Plus size={14} strokeWidth={2.4} />
            <span>New event</span>
          </button>
        </div>
      </header>

      {/* PLANNER + UPCOMING RAIL */}
      <div className="dt-schedule__split">
        {/* PLANNER */}
        <section className="dt-card dt-schedule__planner">
          {/* Day strip (Sun-Sat). Today's number badge is gold; cursor
              anchor is bright. Click any day to jump the cursor. */}
          <div className="dt-schedule__strip">
            {week.map((d) => {
              const isToday = isSameDay(d, today)
              const isCursor = isSameDay(d, cursor || today)
              return (
                <button
                  key={d.getTime()}
                  type="button"
                  className={`dt-day${isToday ? ' is-today' : ''}${isCursor ? ' is-on' : ''}`}
                  onClick={() => { hapticTap(); setCursor(startOfDay(d)) }}
                >
                  <span className="dt-day__dow">{dayLabel(d, { weekday: 'short' })}</span>
                  <span className="dt-day__num">{d.getDate()}</span>
                </button>
              )
            })}
          </div>

          {/* Day nav toolbar */}
          <div className="dt-schedule__nav">
            <button type="button" className="dt-icon-btn" onClick={() => shiftDay(-1)} aria-label="Previous day">
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            <span className="dt-schedule__nav-label">
              {dayLabel(cursor || today, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </span>
            <button type="button" className="dt-icon-btn" onClick={() => shiftDay(1)} aria-label="Next day">
              <ChevronRight size={14} aria-hidden="true" />
            </button>
            <button type="button" className="dt-pill-btn" onClick={jumpToToday}>Today</button>
          </div>

          {/* Day timeline / event list */}
          <div className="dt-schedule__day-list">
            {loading ? (
              <div className="dt-schedule__skel" aria-hidden="true">
                <span /><span /><span />
              </div>
            ) : dayEvents.length === 0 ? (
              <div className="dt-schedule__empty">
                <CalendarIcon size={20} aria-hidden="true" />
                <p>No visits scheduled for this day.</p>
                <button type="button" className="dt-schedule__primary dt-schedule__primary--small" onClick={() => { hapticMedium(); onAddEvent?.() }}>
                  <Plus size={12} strokeWidth={2.4} /> Schedule one
                </button>
              </div>
            ) : (
              dayEvents.map((evt) => <DayEventRow key={evt.id} event={evt} />)
            )}
          </div>
        </section>

        {/* UPCOMING RAIL */}
        <aside className="dt-card dt-schedule__rail">
          <span className="dt-schedule__rail-eyebrow">Next 7 days</span>
          {upcomingByDay.length === 0 ? (
            <p className="dt-schedule__rail-empty">Nothing on the books yet.</p>
          ) : (
            upcomingByDay.map((bucket) => (
              <div key={bucket.date.getTime()} className="dt-schedule__rail-bucket">
                <span className="dt-schedule__rail-day">
                  {dayLabel(bucket.date, { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
                <ul className="dt-schedule__rail-list">
                  {bucket.events.slice(0, 3).map((evt: any) => (
                    <li key={evt.id} className="dt-schedule__rail-item">
                      <span className="dt-schedule__rail-time">{timeLabel(eventStartMs(evt))}</span>
                      <span className="dt-schedule__rail-name">
                        {evt.title || evt.contact_name || evt.fh_contacts?.name || 'Event'}
                      </span>
                    </li>
                  ))}
                  {bucket.events.length > 3 && (
                    <li className="dt-schedule__rail-more">+{bucket.events.length - 3} more</li>
                  )}
                </ul>
              </div>
            ))
          )}
        </aside>
      </div>
    </div>
  )
}

function DayEventRow({ event }: any) {
  const ms = eventStartMs(event)
  const time = ms ? timeLabel(ms) : '—'
  const title = event.title || event.contact_name || event.fh_contacts?.name || 'Event'
  const meta = event.notes || event.location || event.address || event.fh_contacts?.address || ''
  return (
    <div className="dt-schedule__day-row">
      <span className="dt-schedule__day-time">{time}</span>
      <span className="dt-schedule__day-rule" aria-hidden="true" />
      <div className="dt-schedule__day-main">
        <span className="dt-schedule__day-title">{title}</span>
        {meta && (
          <span className="dt-schedule__day-meta">
            {(event.location || event.address || event.fh_contacts?.address) && (
              <MapPin size={11} aria-hidden="true" style={{ marginRight: 4, verticalAlign: '-1px' }} />
            )}
            {meta}
          </span>
        )}
      </div>
    </div>
  )
}
