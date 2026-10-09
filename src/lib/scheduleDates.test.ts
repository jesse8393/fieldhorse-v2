import { describe, it, expect } from 'vitest'
import { startOfWeek, localDateTimeMs, eventDurationMs } from './scheduleDates.ts'

// These assert local wall clock results, so they hold in any timezone.
// Run with TZ=America/Chicago to exercise the daylight saving cases.

describe('startOfWeek', () => {
  it('anchors a midweek day on Monday or Sunday', () => {
    const wed = new Date(2026, 9, 14, 15, 30) // Wed Oct 14 2026
    const mon = startOfWeek(wed, 1)
    expect([mon.getFullYear(), mon.getMonth(), mon.getDate(), mon.getDay()]).toEqual([2026, 9, 12, 1])
    expect([mon.getHours(), mon.getMinutes()]).toEqual([0, 0])
    const sun = startOfWeek(wed, 0)
    expect([sun.getMonth(), sun.getDate(), sun.getDay()]).toEqual([9, 11, 0])
  })

  it('puts a Sunday at the end of its Monday week, not the start of the next', () => {
    const sunday = new Date(2026, 9, 11) // Sun Oct 11 2026
    const mon = startOfWeek(sunday, 1)
    expect([mon.getMonth(), mon.getDate()]).toEqual([9, 5])
    expect(startOfWeek(sunday, 0).getDate()).toBe(11)
  })

  it('keeps Monday on Monday', () => {
    const monday = new Date(2026, 9, 12, 9)
    expect(startOfWeek(monday, 1).getDate()).toBe(12)
  })

  it('does not mutate its input', () => {
    const d = new Date(2026, 9, 14, 15, 30)
    startOfWeek(d, 1)
    expect(d.getDate()).toBe(14)
    expect(d.getHours()).toBe(15)
  })
})

describe('localDateTimeMs', () => {
  it('reads date and time inputs as local wall clock time', () => {
    const ms = localDateTimeMs('2026-10-28', '08:00')!
    const d = new Date(ms)
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 28, 8, 0])
  })

  it('keeps the same local hour for weekly repeats across the fall DST change', () => {
    // Oct 28 to Nov 25 2026 spans the US fall back on Nov 1.
    for (let i = 1; i <= 4; i++) {
      const d = new Date(localDateTimeMs('2026-10-28', '08:00', 7 * i)!)
      expect([d.getHours(), d.getMinutes()]).toEqual([8, 0])
      expect(d.getDay()).toBe(3)
    }
    const last = new Date(localDateTimeMs('2026-10-28', '08:00', 28)!)
    expect([last.getMonth(), last.getDate()]).toEqual([10, 25])
  })

  it('keeps the same local hour across the spring DST change', () => {
    const d = new Date(localDateTimeMs('2026-03-04', '08:00', 7)!) // spring forward Mar 8
    expect([d.getMonth(), d.getDate(), d.getHours()]).toEqual([2, 11, 8])
  })

  it('rolls days over month ends', () => {
    const d = new Date(localDateTimeMs('2026-01-30', '09:15', 3)!)
    expect([d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([1, 2, 9, 15])
  })

  it('returns null for cleared or malformed inputs', () => {
    expect(localDateTimeMs('', '08:00')).toBeNull()
    expect(localDateTimeMs('2026-10-28', '')).toBeNull()
    expect(localDateTimeMs('10/28/2026', '08:00')).toBeNull()
    expect(localDateTimeMs('2026-13-01', '08:00')).toBeNull()
    expect(localDateTimeMs('2026-10-28', '25:00')).toBeNull()
  })

  it('accepts a time value with seconds', () => {
    const d = new Date(localDateTimeMs('2026-10-28', '08:30:00')!)
    expect([d.getHours(), d.getMinutes()]).toEqual([8, 30])
  })
})

describe('eventDurationMs', () => {
  it('keeps the existing length of an event', () => {
    expect(eventDurationMs({ start_at: '2026-10-09T14:00:00Z', end_at: '2026-10-09T17:00:00Z' })).toBe(3 * 3600_000)
  })

  it('falls back to one hour without a usable end', () => {
    expect(eventDurationMs({ start_at: '2026-10-09T14:00:00Z', end_at: null })).toBe(3600_000)
    expect(eventDurationMs({ start_at: '2026-10-09T14:00:00Z', end_at: '2026-10-09T13:00:00Z' })).toBe(3600_000)
    expect(eventDurationMs({ start_at: '2026-10-09T14:00:00Z', end_at: 'garbage' })).toBe(3600_000)
    expect(eventDurationMs(null)).toBe(3600_000)
  })
})
