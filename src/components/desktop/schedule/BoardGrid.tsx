// The Day and Week board (spec 9.10): hourly slots on a paper panel, the
// today column tinted with a gold dot and a 2 px gold now line, and visit
// blocks laid out side by side with packDay. Every slot is a drop target
// for the Unscheduled tray's cards (@dnd-kit/core).

import { useMemo, type CSSProperties } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { Skeleton } from '../../fh'
import {
  WEEKDAYS,
  boardHours,
  dayLayout,
  eventStatus,
  hourLabel,
  slotId,
  timeRangeLabel,
  ymdKey
} from '../../../lib/scheduleBoard.ts'
import { HOUR_PX, type BoardEvent } from './types.ts'

const FULL_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function sameDay(a: Date, b: Date) {
  return ymdKey(a) === ymdKey(b)
}

function Slot({ day, hour, past }: { day: Date; hour: number; past: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: slotId(day, hour), data: { day, hour } })
  return (
    <div
      ref={setNodeRef}
      className={`fhsch-slot${past ? ' is-past' : ''}${isOver ? ' is-over' : ''}`}
      data-slot={`${ymdKey(day)}T${String(hour).padStart(2, '0')}`}
    />
  )
}

type BoardGridProps = {
  days: Date[]
  view: 'day' | 'week'
  events: BoardEvent[]
  loading: boolean
  now: Date
  onOpenEvent?: (event: BoardEvent) => void
  onOpenDay: (day: Date) => void
}

export default function BoardGrid({ days, view, events, loading, now, onOpenEvent, onOpenDay }: BoardGridProps) {
  const { first, last } = useMemo(() => boardHours(days, events), [days, events])
  const hours = useMemo(() => Array.from({ length: last - first }, (_, i) => first + i), [first, last])

  const byDay = useMemo(() => {
    const map = new Map<string, BoardEvent[]>()
    for (const e of events) {
      if (!e.start_at) continue
      const key = ymdKey(new Date(e.start_at))
      const list = map.get(key) || []
      list.push(e)
      map.set(key, list)
    }
    return map
  }, [events])

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const nowTop = ((nowMinutes - first * 60) / 60) * HOUR_PX
  const nowInRange = nowMinutes >= first * 60 && nowMinutes < last * 60
  const empty = !loading && events.length === 0
  const bodyHeight = hours.length * HOUR_PX

  return (
    <div className="fhsch-board" data-view={view} aria-busy={loading || undefined}>
      <div className="fhsch-gutter" aria-hidden="true">
        <div className="fhsch-gutter__head" />
        <div className="fhsch-gutter__hours" style={{ height: bodyHeight }}>
          {hours.map((h) => (
            <span key={h} className="fhsch-gutter__hour" style={{ height: HOUR_PX }}>{hourLabel(h, first)}</span>
          ))}
        </div>
      </div>

      <div
        className={`fhsch-cols${view === 'week' ? ' fh-build-weekplan' : ''}`}
        style={{ '--fhsch-cols': days.length } as CSSProperties}
      >
        {days.map((day) => {
          const key = ymdKey(day)
          const isToday = sameDay(day, now)
          const dayEvents = byDay.get(key) || []
          const items = dayLayout(day, dayEvents, first, HOUR_PX)
          const byId = new Map(dayEvents.map((e) => [e.id, e]))
          const headName = `${WEEKDAYS[day.getDay()]} ${day.getDate()}${isToday ? ', today' : ''}`
          return (
            <section
              key={key}
              className={`fhsch-day fh-build-weekplan__day${isToday ? ' is-today' : ''}`}
              aria-label={`${FULL_WEEKDAYS[day.getDay()]}, ${MONTHS[day.getMonth()]} ${day.getDate()}`}
            >
              <button
                type="button"
                className="fhsch-day__head"
                aria-label={`${headName}, open day view`}
                onClick={() => onOpenDay(day)}
                disabled={view === 'day'}
              >
                <span>{WEEKDAYS[day.getDay()]} {day.getDate()}</span>
                {isToday && (
                  <span className="fhsch-day__today" aria-hidden="true">
                    <span className="fhsch-day__dot" />
                    Today
                  </span>
                )}
              </button>
              <div className="fhsch-day__body" style={{ height: bodyHeight }}>
                {hours.map((h) => (
                  <Slot key={h} day={day} hour={h} past={new Date(day.getFullYear(), day.getMonth(), day.getDate(), h).getTime() < now.getTime()} />
                ))}
                {isToday && nowInRange && (
                  <div className="fhsch-now" style={{ top: nowTop }} aria-hidden="true">
                    <span>now</span>
                  </div>
                )}
                {items.map((item) => {
                  const event = byId.get(item.id)!
                  const start = new Date(event.start_at as string)
                  const rawEnd = event.end_at ? new Date(event.end_at) : null
                  const end = rawEnd && rawEnd.getTime() > start.getTime() ? rawEnd : new Date(start.getTime() + 3_600_000)
                  const status = eventStatus({ start_at: event.start_at ?? null, end_at: event.end_at ?? null }, event.fh_contacts?.stage, now)
                  const title = event.title?.trim() || 'Untitled event'
                  const range = timeRangeLabel(start, end)
                  const job = event.fh_contacts?.name?.trim()
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`fhsch-event fhsch-event--${status.tone}${item.height < 56 ? ' is-short' : item.height >= 80 ? ' is-tall' : ''}`}
                      style={{
                        top: item.top,
                        height: item.height,
                        left: `calc(${item.column} * 100% / ${item.columns} + 2px)`,
                        width: `calc(100% / ${item.columns} - 4px)`
                      }}
                      aria-label={`${title}, ${status.word}, ${range}${job && job !== title ? `, ${job}` : ''}`}
                      title={`${title}, ${status.word}, ${range}`}
                      onClick={() => onOpenEvent?.(event)}
                    >
                      <span className="fhsch-event__title">{title}</span>
                      <span className="fhsch-event__meta">
                        <span className="fhsch-event__word">{status.word}</span>
                        <span className="fhsch-event__comma">, </span>
                        <span className="fhsch-event__time">{range}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      {loading && (
        <div className="fhsch-loading" role="status" aria-live="polite">
          <span className="fhc-vh">Loading schedule</span>
          <Skeleton shape="block" width="12%" height={96} />
          <Skeleton shape="block" width="12%" height={64} />
          <Skeleton shape="block" width="12%" height={120} />
        </div>
      )}
      {empty && (
        <p className="fhsch-hint">
          {view === 'day' ? 'Nothing scheduled this day.' : 'Nothing scheduled this week.'} Drag a job in from the tray, or choose New event.
        </p>
      )}
    </div>
  )
}
