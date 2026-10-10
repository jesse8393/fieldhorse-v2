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

import { packDay, slotToRange, unscheduledJobs } from './scheduleBoard.ts'
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
