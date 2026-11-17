// formats-12: one clock time format, always with am or pm, so a payment
// logged at 8:15 pm never reads as "8:15" beside a morning visit.
import { describe, expect, it } from 'vitest'
import { timeOfDay } from './dates.ts'

describe('timeOfDay', () => {
  it('writes the hour and minutes with am or pm', () => {
    expect(timeOfDay(new Date(2026, 10, 18, 7, 0))).toBe('7:00 am')
    expect(timeOfDay(new Date(2026, 10, 12, 20, 15))).toBe('8:15 pm')
    expect(timeOfDay(new Date(2026, 10, 12, 0, 30))).toBe('12:30 am')
    expect(timeOfDay(new Date(2026, 10, 12, 12, 5))).toBe('12:05 pm')
  })

  it('reads a timestamp and gives nothing for a missing or broken one', () => {
    expect(timeOfDay(new Date(2026, 10, 18, 11, 0).toISOString())).toBe('11:00 am')
    expect(timeOfDay(null)).toBe('')
    expect(timeOfDay('not a time')).toBe('')
  })
})
