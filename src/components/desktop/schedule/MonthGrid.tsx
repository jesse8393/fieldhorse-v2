// The Month view: a seven column calendar of the labeled month, a chip
// per visit (three, then "+N more"), today marked with a gold dot and a
// word. Choosing a day opens it in Day view.

import { useMemo } from 'react'
import { WEEKDAYS, dayLabel, monthLabel, timeLabel, ymdKey } from '../../../lib/scheduleBoard.ts'
import { countNoun } from '../../../lib/format.ts'
import type { BoardEvent } from './types.ts'

function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

type MonthGridProps = {
  cursor: Date
  events: BoardEvent[]
  loading: boolean
  now: Date
  onOpenDay: (day: Date) => void
}

export default function MonthGrid({ cursor, events, loading, now, onOpenDay }: MonthGridProps) {
  const byDay = useMemo(() => {
    const map = new Map<string, BoardEvent[]>()
    for (const e of events) {
      if (!e.start_at) continue
      const key = ymdKey(new Date(e.start_at))
      const list = map.get(key) || []
      list.push(e)
      map.set(key, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => Date.parse(a.start_at || '') - Date.parse(b.start_at || ''))
    }
    return map
  }, [events])

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const gridStart = addDays(first, -first.getDay())
    const all = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
    // Drop a trailing week that is all next month, so most months draw 5 rows.
    return all[35].getMonth() === cursor.getMonth() ? all : all.slice(0, 35)
  }, [cursor])

  return (
    <div className="fhsch-month" aria-busy={loading || undefined} role="group" aria-label={monthLabel(cursor)}>
      <div className="fhsch-month__week" aria-hidden="true">
        {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
      </div>
      <div className="fhsch-month__grid">
        {cells.map((d) => {
          const list = byDay.get(ymdKey(d)) || []
          const inMonth = d.getMonth() === cursor.getMonth()
          const isToday = ymdKey(d) === ymdKey(now)
          return (
            <button
              key={ymdKey(d)}
              type="button"
              className={`fhsch-month__day${inMonth ? '' : ' is-out'}${isToday ? ' is-today' : ''}`}
              onClick={() => onOpenDay(d)}
              aria-label={`${dayLabel(d)}${isToday ? ', today' : ''}${list.length ? `, ${list.length} ${countNoun(list.length, 'event')}` : ''}`}
            >
              <span className="fhsch-month__num">
                {d.getDate()}
                {isToday && <span className="fhsch-day__dot" aria-hidden="true" />}
                {isToday && <span className="fhsch-month__today">Today</span>}
              </span>
              <span className="fhsch-month__chips">
                {list.slice(0, 3).map((e) => (
                  <span key={e.id} className="fhsch-month__chip" title={e.title || 'Event'}>
                    {timeLabel(new Date(e.start_at as string))} {e.title || 'Event'}
                  </span>
                ))}
                {list.length > 3 && <span className="fhsch-month__more">+{list.length - 3} more</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
