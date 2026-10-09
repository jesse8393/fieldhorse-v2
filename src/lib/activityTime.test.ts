import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { paymentEventTime } from './activityTime.ts'

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
