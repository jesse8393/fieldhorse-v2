// SnowScheduleBuild — desktop /schedule in the Build direction.
//
// Drop-in for SnowSchedule at >=900px. Same props, same handlers.
// View picker + date nav in the hero, agenda-style day cards in the
// main column, right rail with upcoming + week KPIs.

import { useMemo } from 'react'
import {
  Bell,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Plus,
  Search,
  Sun,
} from 'lucide-react'

type EventRow = {
  id: string
  title?: string | null
  start_at?: string | null
  end_at?: string | null
  location?: string | null
  notes?: string | null
}

type ScheduleView = 'day' | 'week' | 'month'

// Loosely typed inputs so we accept whatever shape the parent Schedule
// screen passes (events can be null while loading, view is a plain
// string at the call-site, etc.).
type Props = {
  events: EventRow[] | null
  upcoming: EventRow[] | null
  loading: boolean
  cursor: Date
  setCursor: (d: Date) => void
  view: string
  setView: (v: any) => void
  onAddEvent: () => void
}

function fmtTime(iso: string) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  } catch { return '' }
}

function fmtDayHeading(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

function fmtDayShort(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function addDays(d: Date, n: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

const VIEWS: { key: 'day' | 'week' | 'month'; label: string }[] = [
  { key: 'day',   label: 'Day' },
  { key: 'week',  label: 'Week' },
  { key: 'month', label: 'Month' },
]

export default function SnowScheduleBuild(props: Props) {
  const { events: eventsIn, upcoming: upcomingIn, loading, cursor, setCursor, view: viewIn, setView, onAddEvent } = props

  const events: EventRow[] = eventsIn || []
  const upcoming: EventRow[] = upcomingIn || []
  const view: ScheduleView = (viewIn === 'day' || viewIn === 'week' || viewIn === 'month') ? viewIn : 'week'

  // Build the visible day list based on the active view.
  const days: Date[] = useMemo(() => {
    const base = startOfDay(cursor)
    if (view === 'day')   return [base]
    if (view === 'week')  return Array.from({ length: 7 }, (_, i) => addDays(base, i))
    // month view: show the next ~28 days from the cursor as a flat agenda
    return Array.from({ length: 28 }, (_, i) => addDays(base, i))
  }, [cursor, view])

  // Bucket events by day
  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventRow[]>()
    for (const e of events) {
      if (!e.start_at) continue
      const k = startOfDay(new Date(e.start_at)).toISOString()
      const list = map.get(k) || []
      list.push(e)
      map.set(k, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.start_at || 0).getTime() - new Date(b.start_at || 0).getTime())
    }
    return map
  }, [events])

  const rangeLabel = (() => {
    if (view === 'day')   return fmtDayHeading(cursor)
    if (view === 'week')  return `${fmtDayShort(days[0])} – ${fmtDayShort(days[6])}`
    return `${cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`
  })()

  const todayCount = events.filter((e) => e.start_at && sameDay(new Date(e.start_at), new Date())).length
  const weekCount = events.filter((e) => {
    if (!e.start_at) return false
    const d = new Date(e.start_at)
    const start = startOfDay(new Date())
    const end = addDays(start, 7)
    return d >= start && d < end
  }).length

  return (
    <div className="fh-build-page" data-build-screen="SnowScheduleBuild">
      <header className="fh-build-topbar">
        <button
          type="button"
          className="fh-build-search"
          onClick={() => window.dispatchEvent(new CustomEvent('fh:open-palette'))}
          aria-label="Open command palette"
        >
          <Search size={14} />
          <span>Search jobs, clients, invoices, notes...</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="fh-build-topbar__meta">
          <span>{rangeLabel}</span>
          <span className="fh-build-vline" />
          <span>72° · Clear</span>
          <Sun size={16} className="fh-build-sun" />
        </div>
        <button className="fh-build-icon-btn" type="button" onClick={() => window.dispatchEvent(new CustomEvent('fh:navigate', { detail: { to: '/activity' } }))} aria-label="Open activity" title="Activity"><Bell size={16} /></button>
        <button className="fh-build-new-btn" type="button" onClick={onAddEvent}>
          <Plus size={15} /> New event
        </button>
      </header>

      <main className="fh-build-main">
        <section className="fh-build-hero-row fh-build-hero-row--page">
          <div>
            <div className="fh-build-good">Schedule</div>
            <h1 className="fh-build-title">RUN THE DAY.</h1>
          </div>

          <div className="fh-build-focus">
            <div className="fh-build-eyebrow">View</div>
            <div className="fh-build-view-toggle fh-build-view-toggle--inline">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  className={view === v.key ? 'is-active' : ''}
                  onClick={() => setView(v.key)}
                >
                  <Calendar size={13} /> {v.label}
                </button>
              ))}
            </div>
            <div className="fh-build-datenav">
              <button type="button" onClick={() => setCursor(addDays(cursor, view === 'day' ? -1 : view === 'week' ? -7 : -28))} aria-label="Previous">
                <ChevronLeft size={14} />
              </button>
              <button type="button" className="fh-build-datenav__today" onClick={() => setCursor(startOfDay(new Date()))}>
                Today
              </button>
              <button type="button" onClick={() => setCursor(addDays(cursor, view === 'day' ? 1 : view === 'week' ? 7 : 28))} aria-label="Next">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="On site today" value={String(todayCount)} accent />
            <MiniMetric label="This week" value={String(weekCount)} />
            <MiniMetric label="Crews active" value="4" />
            <MiniMetric label="Conflicts" value="0" />
          </div>
        </section>

        <section className="fh-build-content-grid fh-build-content-grid--schedule">
          <section className="fh-build-agenda">
            {loading && (
              <div className="fh-build-table__empty">Loading schedule…</div>
            )}
            {!loading && days.length === 0 && (
              <div className="fh-build-table__empty">Nothing in range.</div>
            )}
            {!loading && days.map((d) => {
              const key = d.toISOString()
              const evs = eventsByDay.get(key) || []
              const isToday = sameDay(d, new Date())
              return (
                <article key={key} className={`fh-build-agenda__day${isToday ? ' is-today' : ''}`}>
                  <header className="fh-build-agenda__head">
                    <div className="fh-build-agenda__date">
                      <span className="fh-build-agenda__weekday">
                        {d.toLocaleDateString(undefined, { weekday: 'short' })}
                      </span>
                      <span className="fh-build-agenda__daynum">{d.getDate()}</span>
                      <span className="fh-build-agenda__month">
                        {d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}
                      </span>
                    </div>
                    <div className="fh-build-agenda__head-meta">
                      {isToday && <span className="fh-build-agenda__today-chip">Today</span>}
                      <span>{evs.length} {evs.length === 1 ? 'event' : 'events'}</span>
                    </div>
                  </header>

                  {evs.length === 0 ? (
                    <div className="fh-build-agenda__empty">No events scheduled.</div>
                  ) : (
                    <ul className="fh-build-agenda__list">
                      {evs.map((e) => (
                        <li key={e.id} className="fh-build-agenda__event">
                          <span className="fh-build-agenda__time">
                            <Clock size={12} />
                            {fmtTime(e.start_at || '')}{e.end_at && ` – ${fmtTime(e.end_at)}`}
                          </span>
                          <strong className="fh-build-agenda__title">{e.title || 'Untitled event'}</strong>
                          {e.location && (
                            <span className="fh-build-agenda__loc">
                              <MapPin size={12} /> {e.location}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              )
            })}
          </section>

          <aside className="fh-build-rail fh-build-rail--page">
            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Up next</div>
              {upcoming.length === 0 ? (
                <>
                  <strong>—</strong>
                  <span>Nothing scheduled</span>
                </>
              ) : (
                <>
                  <div className="fh-build-upnext">
                    <span className="fh-build-upnext__time">{fmtTime(upcoming[0].start_at || '')}</span>
                    <strong className="fh-build-upnext__title" title={upcoming[0].title || ''}>
                      {upcoming[0].title || 'Untitled'}
                    </strong>
                    {upcoming[0].location && (
                      <span className="fh-build-upnext__loc"><MapPin size={11} /> {upcoming[0].location}</span>
                    )}
                  </div>
                </>
              )}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Next 7 days</div>
              <strong>{weekCount}</strong>
              <span>events scheduled</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Upcoming</div>
              {upcoming.length <= 1 ? (
                <span>No follow-on events.</span>
              ) : (
                <ul className="fh-build-rail-list">
                  {upcoming.slice(1, 5).map((e) => (
                    <li key={e.id}>
                      <span className="fh-build-rail-list__time">{fmtTime(e.start_at || '')}</span>
                      <span className="fh-build-rail-list__title" title={e.title || ''}>
                        {e.title || 'Untitled'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <button
              type="button"
              className="fh-build-rail-card fh-build-rail-cta"
              onClick={onAddEvent}
            >
              <Plus size={14} />
              Add event
            </button>
          </aside>
        </section>
      </main>
    </div>
  )
}

function MiniMetric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="fh-build-mini">
      <strong style={{ color: accent ? 'var(--v3-primary, #c9963a)' : undefined }}>{value}</strong>
      <span>{label}</span>
    </div>
  )
}
