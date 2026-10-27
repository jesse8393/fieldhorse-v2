import { describe, expect, it } from 'vitest'
import { assessTrade, assessWorkWindow, assessedHourlyStrip, dailyForecastStatus, tradeRuleBasis } from './forecastAssessment.ts'
import { tradeStatus } from './weather.ts'
const clear = { temperature_2m: 72, precipitation: 0, wind_speed_10m: 5, relative_humidity_2m: 50 }

describe('forecast evidence coverage', () => {
  it('never clears unsupported trades or missing required readings', () => {
    expect(assessTrade('drywall', clear).status).toBe('unknown')
    expect(assessTrade('concrete', { ...clear, precipitation: null }).status).toBe('unknown')
    expect(assessTrade('concrete', { ...clear, temperature_2m: NaN }).status).toBe('unknown')
    expect(assessWorkWindow(clear, ['roofing', 'drywall']).status).toBe('unknown')
  })
  it('keeps documented numeric criteria for supported complete readings', () => {
    for (const snapshot of [clear, { ...clear, temperature_2m: 45 }, { ...clear, wind_speed_10m: 40 }]) {
      expect(assessTrade('concrete', snapshot).status).toBe(tradeStatus('concrete', snapshot).status)
    }
    expect(assessWorkWindow({ ...clear, wind_speed_10m: 40 }, ['roofing', 'drywall']).status).toBe('stop')
  })
  it('exposes actual configured thresholds instead of an unexplained within spec claim', () => {
    expect(tradeRuleBasis('roofing')).toContain('wind above 20 mph')
    expect(tradeRuleBasis('roofing')).toContain('wind above 15 mph')
    expect(tradeRuleBasis('drywall')).toBe('No weather rules configured.')
  })
  it('does not invent clear conditions from partial hourly or daily forecasts', () => {
    expect(assessedHourlyStrip({ time: ['2026-10-27T10:00'], temperature_2m: [72] }, ['concrete'], '2026-10-27T10:00')[0].status).toBe('unknown')
    expect(dailyForecastStatus({ tMax: 72, tMin: 50 }).tone).toBe('neutral')
    expect(dailyForecastStatus({ tMax: 72, tMin: 50, windMax: 5, rainPct: 10 }).tone).toBe('good')
    expect(dailyForecastStatus({ tMax: 72, tMin: 50, windMax: 25, rainPct: 10 }).tone).toBe('bad')
  })
})
