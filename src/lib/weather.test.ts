import { describe, it, expect } from 'vitest'
import { workWindow, hourlyStrip } from './weather.ts'

// Two forecast days of hourly slots in Open-Meteo's shape: local wall
// clock strings with no offset, starting at midnight today.
function hourly(days = 2, overrides: Record<number, Partial<Record<string, number>>> = {}) {
  const time: string[] = []
  const temperature_2m: number[] = []
  const precipitation: number[] = []
  const wind_speed_10m: number[] = []
  const relative_humidity_2m: number[] = []
  const precipitation_probability: number[] = []
  for (let i = 0; i < days * 24; i++) {
    const day = 9 + Math.floor(i / 24)
    time.push(`2026-10-${String(day).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00`)
    const o = overrides[i] || {}
    temperature_2m.push(o.temperature_2m ?? 70)
    precipitation.push(o.precipitation ?? 0)
    wind_speed_10m.push(o.wind_speed_10m ?? 5)
    relative_humidity_2m.push(o.relative_humidity_2m ?? 50)
    precipitation_probability.push(o.precipitation_probability ?? 10)
  }
  return { time, temperature_2m, precipitation, wind_speed_10m, relative_humidity_2m, precipitation_probability }
}

describe('workWindow', () => {
  it('falls back to the general building rules when no trades are set', () => {
    const storm = { temperature_2m: 60, precipitation: 0, wind_speed_10m: 40, relative_humidity_2m: 50 }
    const w = workWindow(storm, [])
    expect(w.status).toBe('stop')
    expect(w.label).toBe('Stand down')
    expect(w.reasons).toEqual(['wind 40 mph'])
  })

  it('still reads clear in calm weather with no trades set', () => {
    const calm = { temperature_2m: 70, precipitation: 0, wind_speed_10m: 5, relative_humidity_2m: 50 }
    expect(workWindow(calm, [])).toEqual({ status: 'go', label: 'Clear to work', reasons: [] })
  })

  it('uses the picked trades when there are some', () => {
    const breezy = { temperature_2m: 70, precipitation: 0, wind_speed_10m: 22, relative_humidity_2m: 50 }
    expect(workWindow(breezy, ['roofing']).status).toBe('stop')
    expect(workWindow(breezy, ['plumbing']).status).toBe('go')
  })

  it('waits for a forecast', () => {
    expect(workWindow(null, []).label).toBe('Awaiting forecast')
  })
})

describe('hourlyStrip', () => {
  it('starts at the hour in progress, not at midnight', () => {
    const strip = hourlyStrip(hourly(), ['gc'], 24, '2026-10-09T16:15')
    expect(strip).toHaveLength(24)
    expect(strip[0].time).toBe('2026-10-09T16:00')
    expect(strip[23].time).toBe('2026-10-10T15:00')
  })

  it('reaches into tomorrow morning', () => {
    const strip = hourlyStrip(hourly(), ['gc'], 24, '2026-10-09T16:15')
    expect(strip.map((h) => h.time)).toContain('2026-10-10T07:00')
  })

  it('accepts epoch ms for now', () => {
    const now = new Date('2026-10-09T16:15').getTime()
    const strip = hourlyStrip(hourly(), ['gc'], 24, now)
    expect(strip[0].time).toBe('2026-10-09T16:00')
  })

  it('stops at the end of the forecast', () => {
    const strip = hourlyStrip(hourly(), ['gc'], 24, '2026-10-10T20:00')
    expect(strip.map((h) => h.time)).toEqual([
      '2026-10-10T20:00', '2026-10-10T21:00', '2026-10-10T22:00', '2026-10-10T23:00'
    ])
  })

  it('is empty when every slot is in the past', () => {
    expect(hourlyStrip(hourly(), ['gc'], 24, '2026-10-12T08:00')).toEqual([])
  })

  it('flags stop hours with no trades set', () => {
    const h = hourly(2, { 17: { wind_speed_10m: 45 } })
    const strip = hourlyStrip(h, [], 3, '2026-10-09T16:05')
    expect(strip.map((s) => s.status)).toEqual(['go', 'stop', 'go'])
  })

  it('returns nothing without hourly data', () => {
    expect(hourlyStrip(null, ['gc'])).toEqual([])
  })
})
