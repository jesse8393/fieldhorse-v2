import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { activityBucketLabel, paymentEventTime } from './activityTime.ts'

// The bug only shows west of UTC, so pin a US timezone for these cases.
const originalTz = process.env.TZ
beforeAll(() => { process.env.TZ = 'America/Chicago' })
afterAll(() => { process.env.TZ = originalTz })

describe('paymentEventTime', () => {
  it('keeps a date-only paid_on on its own calendar day', () => {
    const { when, dateOnly } = paymentEventTime('2026-10-09', '2026-10-12T15:20:00Z')
    expect(when?.getFullYear()).toBe(2026)
    expect(when?.getMonth()).toBe(9)
    expect(when?.getDate()).toBe(9)
    // No time of day to show for a backdated payment.
    expect(dateOnly).toBe(true)
  })

  it('uses the logged time when the payment was recorded that same day', () => {
    // 3:20 PM Chicago on Oct 9.
    const { when, dateOnly } = paymentEventTime('2026-10-09', '2026-10-09T20:20:00Z')
    expect(when?.toISOString()).toBe('2026-10-09T20:20:00.000Z')
    expect(dateOnly).toBe(false)
  })

  it('falls back to created_at when there is no paid_on', () => {
    const { when, dateOnly } = paymentEventTime(null, '2026-10-09T20:20:00Z')
    expect(when?.toISOString()).toBe('2026-10-09T20:20:00.000Z')
    expect(dateOnly).toBe(false)
  })

  it('returns null when neither date is usable', () => {
    expect(paymentEventTime(null, null)).toEqual({ when: null, dateOnly: false })
  })
})

describe('activity calendar periods', () => {
  it('does not label a rolling week or month as a calendar period', () => {
    const sunday = new Date(2026, 9, 25, 12)
    expect(activityBucketLabel(new Date(2026, 9, 23), sunday)).toBe('This month')
    expect(activityBucketLabel(new Date(2026, 8, 30), sunday)).toBe('September 2026')
    expect(activityBucketLabel(new Date(2026, 9, 24), sunday)).toBe('Yesterday')
    expect(activityBucketLabel(new Date(2026, 9, 25), sunday)).toBe('Today')
    expect(activityBucketLabel(new Date(2026, 9, 26), sunday)).toBe('Upcoming')
  })

  it('uses Sunday calendar weeks and handles yesterday across daylight saving', () => {
    expect(activityBucketLabel(new Date(2026, 9, 25), new Date(2026, 9, 28))).toBe('This week')
    expect(activityBucketLabel(new Date(2026, 10, 1), new Date(2026, 10, 2))).toBe('Yesterday')
  })
})
