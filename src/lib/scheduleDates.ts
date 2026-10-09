// src/lib/scheduleDates.ts
//
// Local calendar helpers for schedule events. Events are stored as
// timestamps, but people plan them in wall clock terms ("8:00 AM every
// Wednesday"), so these helpers do their math on calendar parts in the
// viewer's timezone instead of adding fixed blocks of milliseconds.

const HOUR_MS = 60 * 60 * 1000

/**
 * Local midnight on the first day of the week that holds `d`.
 * weekStartsOn: 0 = Sunday, 1 = Monday.
 */
export function startOfWeek(d: Date, weekStartsOn: 0 | 1): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - ((x.getDay() - weekStartsOn + 7) % 7))
  return x
}

/**
 * Epoch ms for a date input value ("2026-10-28") and a time input value
 * ("08:00") read as local wall clock time, moved `addDays` calendar days
 * later. Stepping by calendar days keeps the same local hour across a
 * daylight saving change, where adding 24 hour blocks would drift an
 * hour. Returns null when either input is blank or malformed.
 */
export function localDateTimeMs(date: string, time: string, addDays = 0): number | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || '').trim())
  const tm = /^(\d{1,2}):(\d{2})/.exec(String(time || '').trim())
  if (!dm || !tm || !Number.isFinite(addDays)) return null
  const [y, m, d] = [Number(dm[1]), Number(dm[2]), Number(dm[3])]
  const [hh, mm] = [Number(tm[1]), Number(tm[2])]
  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null
  const ms = new Date(y, m - 1, d + Math.trunc(addDays), hh, mm).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * How long an existing event runs, so an edit that moves its start keeps
 * its length. Falls back to one hour when the row has no usable end.
 */
export function eventDurationMs(event: { start_at?: string | null; end_at?: string | null } | null | undefined): number {
  const start = event?.start_at ? Date.parse(event.start_at) : NaN
  const end = event?.end_at ? Date.parse(event.end_at) : NaN
  const span = end - start
  return Number.isFinite(span) && span > 0 ? span : HOUR_MS
}
