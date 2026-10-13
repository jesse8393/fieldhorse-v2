// The Month view: a seven column calendar of the labeled month, a chip
// per visit (three, then "+N more"), today marked with a gold dot and a
// word. Choosing a day opens it in Day view.
//
// It never reads as an empty month before its read is in (Phase 8 follow
// up A): while the month loads, the board's loading line stands over the
// grid and no chip from the range before shows; when no read of the month
// has worked and the last one failed, an error line with Try again does.
// A failed refresh keeps what the month read, empty or not.

import { useMemo, useRef } from 'react'
import { Button, Skeleton } from '../../fh'
import { WEEKDAYS, dayLabel, monthLabel, timeLabel, ymdKey } from '../../../lib/scheduleBoard.ts'
import { countNoun } from '../../../lib/format.ts'
import { keepFocusOnRetry } from '../../../lib/retryFocus.ts'
import type { BoardEvent } from './types.ts'

function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

type MonthGridProps = {
  cursor: Date
  events: BoardEvent[]
  /** True while the month loads, a new month included: the cache still holds the range before. */
  loading: boolean
  /** No read of the month has worked and the last one failed: an error line with Try again, never an empty month. A failed refresh is not this: what the month read stays. */
  failed?: boolean
  onRetry?: () => void
  now: Date
  onOpenDay: (day: Date) => void
}

export default function MonthGrid({ cursor, events, loading, failed = false, onRetry, now, onOpenDay }: MonthGridProps) {
  const byDay = useMemo(() => {
    const map = new Map<string, BoardEvent[]>()
    // While the month loads the events are the range before's.
    for (const e of loading ? [] : events) {
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
  }, [events, loading])

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const gridStart = addDays(first, -first.getDay())
    const all = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
    // Drop a trailing week that is all next month, so most months draw 5 rows.
    return all[35].getMonth() === cursor.getMonth() ? all : all.slice(0, 35)
  }, [cursor])

  // Try again leaves focus on the month while it is read again.
  const monthRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={monthRef} className="fhsch-month" aria-busy={loading || undefined} role="group" aria-label={monthLabel(cursor)} tabIndex={-1}>
      <div className="fhsch-month__week" aria-hidden="true">
        {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
      </div>
      {loading && (
        <div className="fhsch-loading" role="status" aria-live="polite">
          <span className="fhc-vh">Loading schedule</span>
          <Skeleton shape="block" width="12%" height={64} />
          <Skeleton shape="block" width="12%" height={40} />
          <Skeleton shape="block" width="12%" height={64} />
        </div>
      )}
      {!loading && failed && events.length === 0 && (
        <div className="fhsch-month__alert" role="alert">
          <span>Couldn't load this month. Check your connection and try again.</span>
          <Button
            variant="quiet"
            size="mini"
            onClick={() => {
              keepFocusOnRetry(monthRef.current)
              onRetry?.()
            }}
          >
            Try again
          </Button>
        </div>
      )}
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
