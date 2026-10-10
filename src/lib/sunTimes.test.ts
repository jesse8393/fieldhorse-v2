import { describe, expect, it } from 'vitest'
import { sunWindow, isValidLocation } from './sunTimes.ts'

// Reference times from the Open-Meteo forecast API (daily sunrise and
// sunset, timezone GMT), fetched on October 10, 2026. Open-Meteo rounds
// to the minute and snaps to its own grid point, so allow three minutes,
// and five near the Arctic Circle, where the sun meets the horizon at a
// shallow angle and a tiny difference in declination moves the time.
const MINUTE = 60_000

const FIXTURES: { place: string; lat: number; lon: number; date: [number, number, number]; sunrise: string; sunset: string; tolerance?: number }[] = [
  { place: 'Nashville, summer', lat: 36.1627, lon: -86.7816, date: [2026, 7, 21], sunrise: '2026-07-21T10:45Z', sunset: '2026-07-22T01:01Z' },
  { place: 'Nashville, fall', lat: 36.1627, lon: -86.7816, date: [2026, 10, 10], sunrise: '2026-10-10T11:49Z', sunset: '2026-10-10T23:17Z' },
  { place: 'Los Angeles, sunset past UTC midnight', lat: 34.0522, lon: -118.2437, date: [2026, 10, 10], sunrise: '2026-10-10T13:54Z', sunset: '2026-10-11T01:24Z' },
  { place: 'London, equinox', lat: 51.5074, lon: -0.1278, date: [2026, 9, 22], sunrise: '2026-09-22T05:46Z', sunset: '2026-09-22T17:59Z' },
  { place: 'Sydney, sunrise on the previous UTC day', lat: -33.8688, lon: 151.2093, date: [2026, 10, 10], sunrise: '2026-10-09T19:20Z', sunset: '2026-10-10T08:04Z' },
  { place: 'Reykjavik, long summer day', lat: 64.1466, lon: -21.9426, date: [2026, 7, 21], sunrise: '2026-07-21T03:59Z', sunset: '2026-07-21T23:06Z', tolerance: 5 }
]

describe('sunWindow', () => {
  for (const f of FIXTURES) {
    it(`matches Open-Meteo for ${f.place}`, () => {
      const w = sunWindow(...f.date, f.lat, f.lon)
      expect(w.kind).toBe('normal')
      if (w.kind !== 'normal') return
      const tolerance = (f.tolerance ?? 3) * MINUTE
      expect(Math.abs(w.sunrise - Date.parse(f.sunrise))).toBeLessThanOrEqual(tolerance)
      expect(Math.abs(w.sunset - Date.parse(f.sunset))).toBeLessThanOrEqual(tolerance)
    })
  }

  it('reports the midnight sun and the polar night', () => {
    expect(sunWindow(2026, 6, 21, 78.22, 15.65).kind).toBe('polar-day')
    expect(sunWindow(2026, 12, 21, 78.22, 15.65).kind).toBe('polar-night')
  })
})

describe('isValidLocation', () => {
  it('accepts real coordinates and rejects the rest', () => {
    expect(isValidLocation(36.16, -86.78)).toBe(true)
    expect(isValidLocation(null, -86.78)).toBe(false)
    expect(isValidLocation(36.16, undefined)).toBe(false)
    expect(isValidLocation(91, 0)).toBe(false)
    expect(isValidLocation(0, 181)).toBe(false)
    expect(isValidLocation(Number.NaN, 0)).toBe(false)
  })
})
