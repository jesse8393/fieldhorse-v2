// Layout helpers for the desktop Schedule board (spec 9.10, decision D10).
//
// Pure functions, no React and no network: packing overlapping events into
// side by side columns, deciding which jobs still need a visit, and
// turning a dropped slot into the timestamps a schedule row stores.

import type { JobRow } from './queries.ts'
import { isJobStage } from './stages.ts'

export type PackInput = { id: string; start: Date; end: Date }
export type Packed = { id: string; column: number; columns: number }

/**
 * Greedy column packing for one day of events. Events that overlap in time
 * get their own column and share the width; an event that overlaps nothing
 * gets one column of one. `columns` is the width of the whole cluster of
 * connected overlaps the event sits in, so every event in a cluster is the
 * same fraction wide. An event that ends exactly when the next one starts
 * does not overlap it. The answer comes back in the order the events were
 * given.
 */
export function packDay(events: PackInput[]): Packed[] {
  const span = events.map((e) => {
    const start = e.start.getTime()
    // A zero or negative length event still takes a sliver, so two of
    // them at the same minute cannot share a column.
    const end = Math.max(e.end.getTime(), start + 1)
    return { id: e.id, start, end }
  })
  // Earliest first; for the same start the longer event takes the lower
  // column, which keeps the long block on the left.
  const order = span
    .map((s, index) => ({ ...s, index }))
    .sort((a, b) => a.start - b.start || b.end - a.end || a.index - b.index)

  const column = new Array<number>(events.length).fill(0)
  const columns = new Array<number>(events.length).fill(1)

  let cluster: number[] = []
  let clusterEnd = -Infinity
  let columnEnds: number[] = []

  const closeCluster = () => {
    for (const i of cluster) columns[i] = Math.max(1, columnEnds.length)
    cluster = []
    columnEnds = []
    clusterEnd = -Infinity
  }

  for (const e of order) {
    if (cluster.length > 0 && e.start >= clusterEnd) closeCluster()
    let col = columnEnds.findIndex((end) => end <= e.start)
    if (col === -1) {
      col = columnEnds.length
      columnEnds.push(e.end)
    } else {
      columnEnds[col] = e.end
    }
    column[e.index] = col
    cluster.push(e.index)
    clusterEnd = Math.max(clusterEnd, e.end)
  }
  closeCluster()

  return span.map((s, i) => ({ id: s.id, column: column[i], columns: columns[i] }))
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function createdMs(job: JobRow): number {
  const t = Date.parse(job.created_at ?? job.updated_at ?? '')
  return Number.isFinite(t) ? t : 0
}

/**
 * The jobs the Unscheduled tray lists (decision D10): job stage work with
 * no schedule entry starting today or later, newest first. Today counts as
 * scheduled, even for a visit that started this morning. A job whose only
 * entry was yesterday is unscheduled. Finished work (completed_at set)
 * needs no visit. The legacy `invoice` stage is the same thing as `job`
 * (pipeline v2).
 */
export function unscheduledJobs(
  jobs: JobRow[],
  events: { contact_id: string | null; start_at: string }[],
  now: Date
): JobRow[] {
  const from = startOfDay(now).getTime()
  const booked = new Set<string>()
  for (const e of events) {
    if (!e.contact_id) continue
    const t = Date.parse(e.start_at)
    if (Number.isFinite(t) && t >= from) booked.add(e.contact_id)
  }
  return jobs
    .filter((j) => isJobStage(j.stage) && !j.completed_at && !booked.has(j.id))
    .sort((a, b) => createdMs(b) - createdMs(a) || a.id.localeCompare(b.id))
}

/**
 * The start and end timestamps for a slot on a day: `hour` and `minutes`
 * local wall clock on `day` (its own clock time is ignored), lasting
 * `durationMinutes` (default 60). Built on calendar parts so a slot keeps
 * its local hour across a daylight saving change.
 */
export function slotToRange(
  day: Date,
  hour: number,
  minutes = 0,
  durationMinutes = 60
): { start_at: string; end_at: string } {
  const y = day.getFullYear()
  const m = day.getMonth()
  const d = day.getDate()
  const start = new Date(y, m, d, hour, minutes)
  const end = new Date(y, m, d, hour, minutes + durationMinutes)
  return { start_at: start.toISOString(), end_at: end.toISOString() }
}

// ---- What the board writes in words ----
// Every line here avoids dashes of any kind (ranges read "to") and does
// not depend on the machine's locale, so the board reads the same on
// every desktop.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Oct 4 to 10, 2026", "Oct 28 to Nov 3, 2026", "Dec 28, 2026 to Jan 3, 2027". */
export function weekRangeLabel(first: Date, last: Date): string {
  const a = `${MONTHS[first.getMonth()]} ${first.getDate()}`
  if (first.getFullYear() !== last.getFullYear()) {
    return `${a}, ${first.getFullYear()} to ${MONTHS[last.getMonth()]} ${last.getDate()}, ${last.getFullYear()}`
  }
  const b = first.getMonth() === last.getMonth()
    ? `${last.getDate()}`
    : `${MONTHS[last.getMonth()]} ${last.getDate()}`
  return `${a} to ${b}, ${last.getFullYear()}`
}

/** "Sat, Oct 10, 2026". */
export function dayLabel(d: Date): string {
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

/** "October 2026". */
export function monthLabel(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`
}

function clock(d: Date, withMeridiem: boolean): string {
  const h = d.getHours()
  const m = d.getMinutes()
  const base = `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}`
  return withMeridiem ? `${base} ${h < 12 ? 'am' : 'pm'}` : base
}

/** "9 am", "12 pm", "4:30 pm". */
export function timeLabel(d: Date): string {
  return clock(d, true)
}

/** "9 to 9:30 am", "11 am to 1 pm", "7:30 to 10:30 am". */
export function timeRangeLabel(start: Date, end: Date): string {
  const sameHalf = (start.getHours() < 12) === (end.getHours() < 12)
  return `${clock(start, !sameHalf)} to ${clock(end, true)}`
}

/** The gutter label for an hour: "7 am", then bare numbers, "noon" and "1 pm". */
export function hourLabel(hour: number, first: number): string {
  if (hour === 12) return 'noon'
  if (hour === first || hour === 13) return `${hour % 12 || 12} ${hour < 12 ? 'am' : 'pm'}`
  return String(hour % 12 || 12)
}

export type EventTone = 'done' | 'live' | 'upcoming' | 'visit'

/**
 * How a visit reads on the board, from its time and its job's stage
 * (spec 5.4). Every tone carries a word:
 *   done      finished, muted plaster          "Done"
 *   live      under way now, green             "On site"
 *   upcoming  coming up on a job, blue         "Scheduled"
 *   visit     coming up for a lead or quote,   "Visit"
 *             neutral with an edge
 */
export function eventStatus(
  event: { start_at: string | null; end_at: string | null },
  stage: string | null | undefined,
  now: Date
): { tone: EventTone; word: string } {
  const start = event.start_at ? Date.parse(event.start_at) : NaN
  const rawEnd = event.end_at ? Date.parse(event.end_at) : NaN
  const end = Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : start + 60 * 60 * 1000
  const t = now.getTime()
  if (Number.isFinite(end) && end <= t) return { tone: 'done', word: 'Done' }
  if (Number.isFinite(start) && start <= t) return { tone: 'live', word: 'On site' }
  const s = String(stage || '').toLowerCase()
  if (s === 'lead' || s === 'quote') return { tone: 'visit', word: 'Visit' }
  return { tone: 'upcoming', word: 'Scheduled' }
}

/**
 * Scheduled hours per person for "Crew this week": visits that carry
 * assigned_to, longest first. A visit with no usable end counts an hour,
 * as the Add event sheet writes it.
 */
export function crewHours(
  events: { assigned_to?: string | null; start_at?: string | null; end_at?: string | null }[]
): { id: string; hours: number }[] {
  const totals = new Map<string, number>()
  for (const e of events) {
    if (!e.assigned_to) continue
    const start = e.start_at ? Date.parse(e.start_at) : NaN
    if (!Number.isFinite(start)) continue
    const end = e.end_at ? Date.parse(e.end_at) : NaN
    const ms = Number.isFinite(end) && end > start ? end - start : 60 * 60 * 1000
    totals.set(e.assigned_to, (totals.get(e.assigned_to) ?? 0) + ms)
  }
  return [...totals.entries()]
    .map(([id, ms]) => ({ id, hours: ms / 3_600_000 }))
    .sort((a, b) => b.hours - a.hours || a.id.localeCompare(b.id))
}

/** "24 h", "4.5 h". */
export function hoursLabel(hours: number): string {
  // A short visit still shows as a half hour, never as nothing.
  const rounded = Math.max(hours > 0 ? 0.5 : 0, Math.round(hours * 2) / 2)
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} h`
}

// ---- Board geometry ----

export type BoardEventTimes = { id: string; start_at?: string | null; end_at?: string | null }

/** The local calendar day as 2026-10-09, the key for buckets and slot ids. */
export function ymdKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The id of the drop slot for an hour of a day. */
export function slotId(day: Date, hour: number): string {
  return `slot:${ymdKey(day)}:${hour}`
}

/** The day and hour a slot id names, or null for any other id. */
export function parseSlotId(id: unknown): { day: Date; hour: number } | null {
  const m = /^slot:(\d{4})-(\d{2})-(\d{2}):(\d{1,2})$/.exec(String(id))
  if (!m) return null
  return { day: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), hour: Number(m[4]) }
}

const DEFAULT_FIRST_HOUR = 7
const DEFAULT_LAST_HOUR = 18

/**
 * The hours the board draws: 7 am to 6 pm, stretched when a visit in view
 * starts earlier or ends later so no visit is ever clipped off the board.
 * `last` is the closing line, so the last slot starts at last minus one.
 */
export function boardHours(
  days: Date[],
  events: BoardEventTimes[],
  first = DEFAULT_FIRST_HOUR,
  last = DEFAULT_LAST_HOUR
): { first: number; last: number } {
  let lo = first
  let hi = last
  const keys = new Set(days.map(ymdKey))
  for (const e of events) {
    if (!e.start_at) continue
    const start = new Date(e.start_at)
    if (!keys.has(ymdKey(start))) continue
    lo = Math.min(lo, start.getHours())
    const end = e.end_at && Date.parse(e.end_at) > start.getTime() ? new Date(e.end_at) : new Date(start.getTime() + 3_600_000)
    // A visit that runs past midnight stops at the bottom of its day.
    const endHour = ymdKey(end) === ymdKey(start) ? end.getHours() + (end.getMinutes() > 0 ? 1 : 0) : 24
    hi = Math.max(hi, endHour)
  }
  return { first: Math.max(0, lo), last: Math.min(24, hi) }
}

export type DayItem = { id: string; top: number; height: number; column: number; columns: number }

/**
 * Where each visit of one day sits on the board: pixels from the top of
 * the first hour, a height, and the side by side column from packDay.
 * A short visit is drawn at least `minMinutes` tall so its two lines of
 * text fit, and that drawn length is what packs, so a short visit never
 * hides behind its neighbour.
 */
export function dayLayout(
  day: Date,
  events: BoardEventTimes[],
  firstHour: number,
  hourPx: number,
  minMinutes = 40
): DayItem[] {
  const key = ymdKey(day)
  const rows: { id: string; start: Date; end: Date; startMin: number; endMin: number }[] = []
  for (const e of events) {
    if (!e.start_at) continue
    const start = new Date(e.start_at)
    if (ymdKey(start) !== key) continue
    const rawEnd = e.end_at ? new Date(e.end_at) : null
    const end = rawEnd && rawEnd.getTime() > start.getTime() ? rawEnd : new Date(start.getTime() + 3_600_000)
    const startMin = start.getHours() * 60 + start.getMinutes()
    const endMin = ymdKey(end) === key ? end.getHours() * 60 + end.getMinutes() : 24 * 60
    const drawnEnd = Math.max(endMin, startMin + minMinutes)
    rows.push({ id: e.id, start, end: new Date(start.getTime() + (drawnEnd - startMin) * 60_000), startMin, endMin: drawnEnd })
  }
  const packed = packDay(rows.map((r) => ({ id: r.id, start: r.start, end: r.end })))
  return rows.map((r, i) => ({
    id: r.id,
    top: ((r.startMin - firstHour * 60) / 60) * hourPx,
    height: ((r.endMin - r.startMin) / 60) * hourPx,
    column: packed[i].column,
    columns: packed[i].columns
  }))
}

type JobNames = {
  name?: string | null
  job_title?: string | null
  fh_clients?: { name?: string | null } | null
}

/** What a job is called on a card and on the visit it creates. */
export function jobLabel(job: JobNames): string {
  return job.name?.trim() || job.fh_clients?.name?.trim() || job.job_title?.trim() || 'Untitled job'
}

/** The line under a job's name: the work, when it adds anything. */
export function jobSubline(job: JobNames): string {
  const work = job.job_title?.trim() || ''
  return work && work !== jobLabel(job) ? work : ''
}
