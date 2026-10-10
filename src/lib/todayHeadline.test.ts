import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { dayHeadline, isPour, nightHeadline, type HeadlineStop } from './todayHeadline.ts'

// These checks read the local hour, day or week. Pin Central time, where
// Jesse works, so the result is the same on every machine and in CI (UTC).
// Set it as the file loads too, because the fixtures below build local
// dates before any hook runs.
const originalTz = process.env.TZ
process.env.TZ = 'America/Chicago'
beforeAll(() => { process.env.TZ = 'America/Chicago' })
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

// Local times, as the phone reads them.
function at(hours: number, minutes: number) {
  return new Date(2026, 9, 9, hours, minutes).toISOString()
}

function stop(hours: number, minutes: number, title: string | null): HeadlineStop {
  return { startAt: at(hours, minutes), title }
}

describe('dayHeadline', () => {
  it('names the first pour', () => {
    expect(dayHeadline([
      stop(7, 30, 'Pour slab, crew A'),
      stop(11, 30, 'Site visit'),
      stop(14, 30, 'Walkthrough')
    ]).title).toEqual(['Three stops.', 'First pour at 7:30.'])
  })

  it('only the first stop decides whether the line says pour', () => {
    expect(dayHeadline([
      stop(9, 0, 'Site visit'),
      stop(13, 0, 'Pour footings')
    ]).title).toEqual(['Two stops.', 'First at 9:00.'])
  })

  it('reads the afternoon on a 12 hour clock without am or pm', () => {
    expect(dayHeadline([stop(13, 15, 'Measure deck')]).title).toEqual(['One stop.', 'First at 1:15.'])
  })

  it('says clear day when nothing is scheduled', () => {
    expect(dayHeadline([]).title).toEqual(['Clear day.', 'Nothing on the schedule.'])
  })

  it('spells counts up to ten and uses numerals after', () => {
    const ten = Array.from({ length: 10 }, (_, i) => stop(7 + i, 0, 'Visit'))
    expect(dayHeadline(ten).title[0]).toBe('Ten stops.')
    const twelve = Array.from({ length: 12 }, (_, i) => stop(6 + i, 0, 'Visit'))
    expect(dayHeadline(twelve).title[0]).toBe('12 stops.')
  })

  it('lets the earliest start decide the second line when stops arrive out of order', () => {
    expect(dayHeadline([
      stop(14, 30, 'Walkthrough'),
      stop(6, 45, 'Pour the garage slab'),
      stop(9, 0, 'Site visit')
    ]).title).toEqual(['Three stops.', 'First pour at 6:45.'])
  })

  it('skips stops without a start time when it looks for the first', () => {
    expect(dayHeadline([
      { startAt: '', title: 'Pour later' },
      stop(10, 5, 'Estimate')
    ]).title).toEqual(['Two stops.', 'First at 10:05.'])
  })

  it('reads 12:30 after midnight as 12:30', () => {
    expect(dayHeadline([stop(0, 30, 'Night pour')]).title).toEqual(['One stop.', 'First pour at 12:30.'])
  })
})

describe('nightHeadline', () => {
  it('counts the stops done and what is left', () => {
    expect(nightHeadline({ stopsToday: 3, openAnswers: 2 }).title).toEqual(['Three stops done.', 'Two things before tomorrow.'])
  })

  it('says quiet day when nothing happened and nothing waits', () => {
    expect(nightHeadline({ stopsToday: 0, openAnswers: 0 }).title).toEqual(['Quiet day.', 'Nothing waiting on you.'])
  })

  it('uses the singular for one', () => {
    expect(nightHeadline({ stopsToday: 1, openAnswers: 1 }).title).toEqual(['One stop done.', 'One thing before tomorrow.'])
  })

  it('mixes a quiet day with open answers', () => {
    expect(nightHeadline({ stopsToday: 0, openAnswers: 11 }).title).toEqual(['Quiet day.', '11 things before tomorrow.'])
  })
})

describe('isPour', () => {
  it('is true for a word that starts with pour, in any case', () => {
    expect(isPour('Pour slab, crew A')).toBe(true)
    expect(isPour('Slab POURING day')).toBe(true)
    expect(isPour('footings (pour)')).toBe(true)
  })

  it('is false for other words, and for nothing', () => {
    expect(isPour('Parking lot repour')).toBe(false)
    expect(isPour('Downpour cleanup')).toBe(false)
    expect(isPour('Site visit')).toBe(false)
    expect(isPour(null)).toBe(false)
    expect(isPour('')).toBe(false)
  })
})
