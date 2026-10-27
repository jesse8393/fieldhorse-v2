import { TRADE_RULES, tradeStatus, hourlyStrip } from './weather.ts'

export type ForecastStatus = 'go' | 'warn' | 'stop' | 'unknown'
type Snapshot = Parameters<typeof tradeStatus>[1]
const INPUTS = { tempMin: ['temperature_2m', 'temperature'], tempMax: ['temperature_2m', 'temperature'], rain: ['precipitation', 'rain'], wind: ['wind_speed_10m', 'wind'], humidity: ['relative_humidity_2m', 'humidity'] } as const

/** Preserve configured thresholds; unknown inputs never imply a work clearance. */
export function assessTrade(trade: string, snapshot: Snapshot): { status: ForecastStatus; reasons: string[] } {
  const key = trade.trim().toLowerCase()
  const rule = TRADE_RULES[key]
  if (!rule) return { status: 'unknown', reasons: ['No weather rules configured for this trade.'] }
  if (!snapshot) return { status: 'unknown', reasons: ['Current conditions unavailable.'] }
  const missing = new Set<string>()
  for (const limits of [rule.warn, rule.stop]) {
    for (const name of Object.keys(limits ?? {}) as (keyof typeof INPUTS)[]) {
      const [field, label] = INPUTS[name]
      if (typeof snapshot[field] !== 'number' || !Number.isFinite(snapshot[field])) missing.add(label)
    }
  }
  if (missing.size) return { status: 'unknown', reasons: [`Missing readings: ${[...missing].join(', ')}.`] }
  const result = tradeStatus(key, snapshot)
  return { ...result, reasons: result.reasons.length ? result.reasons : ['No configured limit triggered.'] }
}

export function assessWorkWindow(snapshot: Snapshot, services: string[] = []) {
  const trades = [...new Set((services.length ? services : ['gc']).map((s) => s.trim().toLowerCase()).filter(Boolean))]
  if (!trades.length) trades.push('gc')
  const rows = trades.map((trade) => ({ trade, ...assessTrade(trade, snapshot) }))
  const status: ForecastStatus = rows.some((r) => r.status === 'stop') ? 'stop' : rows.some((r) => r.status === 'unknown') ? 'unknown' : rows.some((r) => r.status === 'warn') ? 'warn' : 'go'
  const label = { stop: 'Review work restrictions', warn: 'Review weather limits', unknown: 'Work suitability unknown', go: 'Within configured weather limits' }[status]
  return { status, label, reasons: rows.filter((r) => r.status !== 'go').flatMap((r) => r.reasons.map((reason) => `${r.trade}: ${reason}`)) }
}

export function tradeRuleBasis(trade: string): string {
  const rule = TRADE_RULES[trade.trim().toLowerCase()]
  if (!rule) return 'No weather rules configured.'
  return (['stop', 'warn'] as const).flatMap((level) => {
    const r = rule[level]
    if (!r) return []
    const parts = [r.tempMin != null && `temperature below ${r.tempMin}°F`, r.tempMax != null && `temperature above ${r.tempMax}°F`, r.rain != null && `rain above ${r.rain} inches`, r.wind != null && `wind above ${r.wind} mph`, r.humidity != null && `humidity above ${r.humidity}%`].filter(Boolean)
    return parts.length ? [`${level === 'stop' ? 'Stop' : 'Caution'}: ${parts.join(', ')}.`] : []
  }).join(' ')
}

export function assessedHourlyStrip(hourly: any, services: string[], now?: string) {
  return hourlyStrip(hourly, services, 24, now).map((hour) => {
    const i = hourly.time.indexOf(hour.time)
    const snapshot = { temperature_2m: hourly.temperature_2m?.[i], precipitation: hourly.precipitation?.[i], wind_speed_10m: hourly.wind_speed_10m?.[i], relative_humidity_2m: hourly.relative_humidity_2m?.[i] }
    return { ...hour, status: assessWorkWindow(snapshot, services).status }
  })
}

/** Existing desktop outlook thresholds, with missing values represented honestly. */
export function dailyForecastStatus(d: { rainPct?: number; windMax?: number; tMax?: number; tMin?: number }): { tone: 'good' | 'warn' | 'bad' | 'neutral'; label: string } {
  if (![d.rainPct, d.windMax, d.tMax, d.tMin].every((n) => typeof n === 'number' && Number.isFinite(n))) return { tone: 'neutral', label: 'Unknown' }
  const { rainPct: rain = 0, windMax: wind = 0, tMax = 0, tMin = 0 } = d
  if (rain >= 60 || wind >= 25 || tMax >= 100 || tMin <= 32) return { tone: 'bad', label: 'Review limits' }
  if (rain >= 30 || wind >= 15 || tMax >= 90 || tMin <= 40) return { tone: 'warn', label: 'Caution' }
  return { tone: 'good', label: 'Within app limits' }
}
