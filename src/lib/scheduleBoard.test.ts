import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'

// These checks read the local hour and day. Pin Central time, where Jesse
// works, so the result is the same on every machine and in CI (UTC). Set
// it as the file loads too, because the fixtures below build local dates
// before any hook runs.
const originalTz = process.env.TZ
process.env.TZ = 'America/Chicago'
beforeAll(() => { process.env.TZ = 'America/Chicago' })
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

// stages.ts builds the Supabase client on import; the board helpers only
// read its pure functions, so a stub client is enough here.
vi.mock('./supabase.ts', () => ({ supabase: {} }))

import {
  boardHours,
  crewHours,
  dayLayout,
  dayLabel,
  eventStatus,
  hourLabel,
  jobLabel,
  jobSubline,
  parseSlotId,
  slotId,
  ymdKey,
  hoursLabel,
  monthLabel,
  packDay,
  slotToRange,
  timeLabel,
  timeRangeLabel,
  unscheduledJobs,
  weekRangeLabel
} from './scheduleBoard.ts'
import type { JobRow } from './queries.ts'

const at = (h: number, m = 0) => new Date(2026, 9, 9, h, m)

describe('packDay', () => {
  it('puts overlapping events side by side and gives a lone event the full width', () => {
    const packed = packDay([
      { id: 'a', start: at(9), end: at(10) },
      { id: 'b', start: at(9, 30), end: at(11) },
      { id: 'c', start: at(11), end: at(12) }
    ])
    expect(packed).toEqual([
      { id: 'a', column: 0, columns: 2 },
      { id: 'b', column: 1, columns: 2 },
      { id: 'c', column: 0, columns: 1 }
    ])
  })

  it('never stacks two events at the same time on top of each other', () => {
    const packed = packDay([
      { id: 'a', start: at(8), end: at(9) },
      { id: 'b', start: at(8), end: at(9) },
      { id: 'c', start: at(8), end: at(9) }
    ])
    expect(packed.map((p) => p.column).sort()).toEqual([0, 1, 2])
    expect(packed.every((p) => p.columns === 3)).toBe(true)
  })

  it('reuses a free column inside one cluster and answers in the order it was given', () => {
    // A runs long, B ends early, C starts after B ends but while A runs.
    const packed = packDay([
      { id: 'c', start: at(10, 30), end: at(11, 30) },
      { id: 'a', start: at(9), end: at(12) },
      { id: 'b', start: at(9), end: at(10) }
    ])
    expect(packed.map((p) => p.id)).toEqual(['c', 'a', 'b'])
    const byId = Object.fromEntries(packed.map((p) => [p.id, p]))
    expect(byId.a).toEqual({ id: 'a', column: 0, columns: 2 })
    expect(byId.b).toEqual({ id: 'b', column: 1, columns: 2 })
    expect(byId.c).toEqual({ id: 'c', column: 1, columns: 2 })
  })

  it('treats an event that ends exactly when the next starts as not overlapping', () => {
    const packed = packDay([
      { id: 'a', start: at(9), end: at(10) },
      { id: 'b', start: at(10), end: at(11) }
    ])
    expect(packed.every((p) => p.column === 0 && p.columns === 1)).toBe(true)
  })

  it('returns nothing for no events', () => {
    expect(packDay([])).toEqual([])
  })
})

function job(partial: Partial<JobRow> & { id: string }, i = 0): JobRow {
  return {
    user_id: 'qa-user-1',
    client_id: 'cl-1',
    name: 'Client',
    phone: null,
    email: null,
    address: null,
    stage: 'job',
    amount: null,
    job_title: null,
    job_type: null,
    referred_by: null,
    proposal_status: null,
    follow_up_on: null,
    completed_at: null,
    quote_sent_at: null,
    created_at: new Date(2026, 8, 1 + i).toISOString(),
    updated_at: new Date(2026, 8, 1 + i).toISOString(),
    fh_clients: null,
    ...partial
  } as JobRow
}

describe('unscheduledJobs', () => {
  const now = new Date(2026, 9, 9, 9, 0)
  const tomorrow = new Date(2026, 9, 10, 8, 0).toISOString()
  const yesterday = new Date(2026, 9, 8, 8, 0).toISOString()
  const earlierToday = new Date(2026, 9, 9, 7, 0).toISOString()

  it('leaves out a job with an event tomorrow and keeps one whose only event was yesterday', () => {
    const jobs = [job({ id: 'next' }), job({ id: 'past' })]
    const result = unscheduledJobs(jobs, [
      { contact_id: 'next', start_at: tomorrow },
      { contact_id: 'past', start_at: yesterday }
    ], now)
    expect(result.map((j) => j.id)).toEqual(['past'])
  })

  it('counts an event earlier today as scheduled', () => {
    const result = unscheduledJobs([job({ id: 'today' })], [{ contact_id: 'today', start_at: earlierToday }], now)
    expect(result).toEqual([])
  })

  it('lists only job stage work, the legacy invoice alias included, never leads, quotes, closed, lost or finished work', () => {
    const jobs = [
      job({ id: 'lead', stage: 'lead' }),
      job({ id: 'quote', stage: 'quote' }),
      job({ id: 'job', stage: 'job' }),
      job({ id: 'legacy', stage: 'invoice' }),
      job({ id: 'closed', stage: 'closed' }),
      job({ id: 'lost', stage: 'lost' }),
      job({ id: 'finished', stage: 'job', completed_at: new Date(2026, 9, 1).toISOString() })
    ]
    expect(unscheduledJobs(jobs, [], now).map((j) => j.id).sort()).toEqual(['job', 'legacy'])
  })

  it('ignores events that carry no job and lists the newest job first', () => {
    const jobs = [job({ id: 'old' }, 0), job({ id: 'new' }, 5), job({ id: 'mid' }, 2)]
    const result = unscheduledJobs(jobs, [{ contact_id: null, start_at: tomorrow }], now)
    expect(result.map((j) => j.id)).toEqual(['new', 'mid', 'old'])
  })
})

describe('slotToRange', () => {
  it('turns Oct 9 at 13 into 13:00 to 14:00 local', () => {
    const range = slotToRange(new Date(2026, 9, 9), 13)
    expect(range.start_at).toBe(new Date(2026, 9, 9, 13, 0).toISOString())
    expect(range.end_at).toBe(new Date(2026, 9, 9, 14, 0).toISOString())
    // Central daylight time is UTC minus 5 in October.
    expect(range.start_at).toBe('2026-10-09T18:00:00.000Z')
    expect(range.end_at).toBe('2026-10-09T19:00:00.000Z')
  })

  it('takes minutes and a duration, and ignores the clock time of the day it is given', () => {
    const range = slotToRange(new Date(2026, 9, 9, 17, 45), 8, 30, 90)
    expect(range.start_at).toBe(new Date(2026, 9, 9, 8, 30).toISOString())
    expect(range.end_at).toBe(new Date(2026, 9, 9, 10, 0).toISOString())
  })

  it('keeps the local hour across the daylight saving change', () => {
    // Nov 1, 2026 is the fall back day in the US. The slot is built on
    // calendar parts, so 1 pm stays 1 pm to 2 pm local on that day.
    const range = slotToRange(new Date(2026, 10, 1), 13)
    expect(new Date(range.start_at).getHours()).toBe(13)
    expect(new Date(range.end_at).getHours()).toBe(14)
  })
})

const DASH = /[-\u2013\u2014]/

describe('labels', () => {
  it('writes the week range with the year once and no dashes', () => {
    expect(weekRangeLabel(new Date(2026, 9, 4), new Date(2026, 9, 10))).toBe('Oct 4 to 10, 2026')
    expect(weekRangeLabel(new Date(2026, 9, 28), new Date(2026, 10, 3))).toBe('Oct 28 to Nov 3, 2026')
    expect(weekRangeLabel(new Date(2026, 11, 27), new Date(2027, 0, 2))).toBe('Dec 27, 2026 to Jan 2, 2027')
  })

  it('writes a day and a month', () => {
    expect(dayLabel(new Date(2026, 9, 10))).toBe('Sat, Oct 10, 2026')
    expect(monthLabel(new Date(2026, 9, 10))).toBe('October 2026')
  })

  it('writes times the way the render does', () => {
    expect(timeLabel(at(9))).toBe('9 am')
    expect(timeLabel(at(12))).toBe('12 pm')
    expect(timeLabel(at(16, 30))).toBe('4:30 pm')
    expect(timeRangeLabel(at(9), at(9, 30))).toBe('9 to 9:30 am')
    expect(timeRangeLabel(at(11), at(13))).toBe('11 am to 1 pm')
    expect(timeRangeLabel(at(7, 30), at(10, 30))).toBe('7:30 to 10:30 am')
    expect(timeRangeLabel(at(13), at(14))).toBe('1 to 2 pm')
  })

  it('labels the hour gutter 7 am, bare numbers, noon and 1 pm', () => {
    expect([7, 8, 9, 10, 11, 12, 13, 14, 17].map((h) => hourLabel(h, 7)))
      .toEqual(['7 am', '8', '9', '10', '11', 'noon', '1 pm', '2', '5'])
  })

  it('never writes a dash', () => {
    const lines = [
      weekRangeLabel(new Date(2026, 9, 4), new Date(2026, 9, 10)),
      dayLabel(new Date(2026, 9, 10)),
      monthLabel(new Date(2026, 9, 10)),
      timeRangeLabel(at(9), at(10)),
      hoursLabel(24),
      eventStatus({ start_at: null, end_at: null }, 'job', at(9)).word
    ]
    for (const line of lines) expect(line).not.toMatch(DASH)
  })
})

describe('eventStatus', () => {
  const now = at(9)
  const ev = (startH: number, endH: number) => ({ start_at: at(startH).toISOString(), end_at: at(endH).toISOString() })

  it('reads a finished visit as done, a visit under way as on site, a coming one as scheduled', () => {
    expect(eventStatus(ev(7, 8), 'job', now)).toEqual({ tone: 'done', word: 'Done' })
    expect(eventStatus(ev(8, 11), 'job', now)).toEqual({ tone: 'live', word: 'On site' })
    expect(eventStatus(ev(13, 14), 'job', now)).toEqual({ tone: 'upcoming', word: 'Scheduled' })
  })

  it('reads a coming visit for a lead or quote as a neutral visit', () => {
    expect(eventStatus(ev(13, 14), 'lead', now)).toEqual({ tone: 'visit', word: 'Visit' })
    expect(eventStatus(ev(13, 14), 'quote', now)).toEqual({ tone: 'visit', word: 'Visit' })
    expect(eventStatus(ev(13, 14), null, now).tone).toBe('upcoming')
  })

  it('counts a visit with no end as an hour long', () => {
    expect(eventStatus({ start_at: at(8).toISOString(), end_at: null }, 'job', at(8, 30)).tone).toBe('live')
    expect(eventStatus({ start_at: at(8).toISOString(), end_at: null }, 'job', at(9, 30)).tone).toBe('done')
  })
})

describe('crewHours', () => {
  it('adds the hours each person is booked and lists the busiest first', () => {
    const rows = [
      { assigned_to: 'terrence', start_at: at(8).toISOString(), end_at: at(11).toISOString() },
      { assigned_to: 'luis', start_at: at(8).toISOString(), end_at: at(9, 30).toISOString() },
      { assigned_to: 'terrence', start_at: at(13).toISOString(), end_at: at(14).toISOString() },
      { assigned_to: null, start_at: at(8).toISOString(), end_at: at(17).toISOString() }
    ]
    expect(crewHours(rows)).toEqual([{ id: 'terrence', hours: 4 }, { id: 'luis', hours: 1.5 }])
    expect(crewHours([])).toEqual([])
  })

  it('writes hours with a half hour step', () => {
    expect(hoursLabel(24)).toBe('24 h')
    expect(hoursLabel(1.5)).toBe('1.5 h')
    expect(hoursLabel(0.2)).toBe('0.5 h')
  })
})

describe('slot ids', () => {
  it('round trips a day and an hour', () => {
    const id = slotId(new Date(2026, 9, 9, 17, 45), 13)
    expect(id).toBe('slot:2026-10-09:13')
    const parsed = parseSlotId(id)!
    expect(ymdKey(parsed.day)).toBe('2026-10-09')
    expect(parsed.hour).toBe(13)
    expect(parseSlotId('job:c-job1')).toBeNull()
  })
})

describe('boardHours', () => {
  const days = [new Date(2026, 9, 9), new Date(2026, 9, 10)]
  const ev = (id: string, s: Date, e: Date) => ({ id, start_at: s.toISOString(), end_at: e.toISOString() })

  it('draws 7 am to 6 pm by default', () => {
    expect(boardHours(days, [])).toEqual({ first: 7, last: 18 })
    expect(boardHours(days, [ev('a', at(9), at(10))])).toEqual({ first: 7, last: 18 })
  })

  it('stretches to hold an early start and a late finish, and ignores visits on other days', () => {
    expect(boardHours(days, [ev('a', at(5, 30), at(6, 30))])).toEqual({ first: 5, last: 18 })
    expect(boardHours(days, [ev('a', at(16), at(19, 15))])).toEqual({ first: 7, last: 20 })
    const elsewhere = ev('b', new Date(2026, 9, 20, 4), new Date(2026, 9, 20, 22))
    expect(boardHours(days, [elsewhere])).toEqual({ first: 7, last: 18 })
  })

  it('stops a visit that runs past midnight at the bottom of its day', () => {
    expect(boardHours(days, [ev('a', at(22), new Date(2026, 9, 10, 2))])).toEqual({ first: 7, last: 24 })
  })
})

describe('dayLayout', () => {
  const ev = (id: string, s: Date, e: Date | null) => ({ id, start_at: s.toISOString(), end_at: e ? e.toISOString() : null })

  it('places a visit in pixels from the first hour', () => {
    const [item] = dayLayout(new Date(2026, 9, 9), [ev('a', at(9, 30), at(11))], 7, 60)
    expect(item).toEqual({ id: 'a', top: 150, height: 90, column: 0, columns: 1 })
  })

  it('draws a short visit at least 40 minutes tall and packs it at that length', () => {
    const items = dayLayout(new Date(2026, 9, 9), [
      ev('short', at(9), at(9, 15)),
      ev('next', at(9, 30), at(10))
    ], 7, 60)
    expect(items[0].height).toBe(40)
    // The short visit is drawn to 9:40, so the 9:30 one must sit beside it.
    expect(items.map((i) => i.columns)).toEqual([2, 2])
  })

  it('gives a visit with no end an hour, and skips visits on other days', () => {
    const items = dayLayout(new Date(2026, 9, 9), [
      ev('open', at(8), null),
      ev('other', new Date(2026, 9, 10, 8), new Date(2026, 9, 10, 9))
    ], 7, 60)
    expect(items).toHaveLength(1)
    expect(items[0].height).toBe(60)
  })

  it('cuts a visit that runs past midnight at the end of its day', () => {
    const [item] = dayLayout(new Date(2026, 9, 9), [ev('late', at(22), new Date(2026, 9, 10, 2))], 7, 60)
    expect(item.top + item.height).toBe((24 - 7) * 60)
  })
})

describe('job names', () => {
  it('names a job by its name, then its client, then its work', () => {
    expect(jobLabel({ name: ' Plumbing Bellevue ', job_title: 'Slab and trench' })).toBe('Plumbing Bellevue')
    expect(jobLabel({ name: null, fh_clients: { name: 'Jeff Roy' }, job_title: 'Patio' })).toBe('Jeff Roy')
    expect(jobLabel({ name: '', job_title: 'Patio' })).toBe('Patio')
    expect(jobLabel({})).toBe('Untitled job')
  })

  it('puts the work on the second line only when it adds something', () => {
    expect(jobSubline({ name: 'Plumbing Bellevue', job_title: 'Slab and trench' })).toBe('Slab and trench')
    expect(jobSubline({ name: 'Patio', job_title: 'Patio' })).toBe('')
    expect(jobSubline({ name: 'Patio' })).toBe('')
  })
})
