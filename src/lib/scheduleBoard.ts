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
