// formats-12: one clock time format, always with am or pm, so a payment
// logged at 8:15 pm never reads as "8:15" beside a morning visit.
import { describe, expect, it } from 'vitest'
import { dateAndTime, timeOfDay } from './dates.ts'

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

// A date with its time ("Nov 18, 7:00 am") writes the time the same way.
describe('dateAndTime', () => {
  const at = new Date(2026, 10, 18, 19, 5)
  it('writes the day, then the time with am or pm', () => {
    expect(dateAndTime(at)).toBe('Nov 18, 7:05 pm')
    expect(dateAndTime(at, { year: true })).toBe('Nov 18, 2026, 7:05 pm')
    expect(dateAndTime(at, { weekday: true })).toBe('Wed, Nov 18, 7:05 pm')
  })

  it('gives nothing for a missing or broken value', () => {
    expect(dateAndTime(null)).toBe('')
    expect(dateAndTime('not a time')).toBe('')
  })
})
