// Open-Meteo, no API key needed. Forecast + aggregate work window for all trades.

export const MURFREESBORO = { lat: 35.8456, lon: -86.3903 }

// Reverse geocode lat/lon to "City, ST" via BigDataCloud's free client endpoint.
// No API key. Falls back to "{lat}, {lon}" if the call fails.
// Tiny in-memory cache keyed to 3-decimal coord pair (~100m precision) so the
// same location doesn't re-fetch within a session.
const _geocodeCache = new Map<string, string>()
export async function reverseGeocode(lat: number | null | undefined, lon: number | null | undefined) {
  if (lat == null || lon == null) return null
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`
  if (_geocodeCache.has(key)) return _geocodeCache.get(key)
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`
    )
    if (!res.ok) throw new Error('geocode failed')
    const d = await res.json()
    const city = d.city || d.locality || d.principalSubdivision || ''
    const region = d.principalSubdivisionCode
      ? d.principalSubdivisionCode.replace(/^[A-Z]{2}-/, '')
      : ''
    const out = city ? (region ? `${city}, ${region}` : city) : `${lat.toFixed(2)}, ${lon.toFixed(2)}`
    _geocodeCache.set(key, out)
    return out
  } catch {
    const fallback = `${lat.toFixed(2)}, ${lon.toFixed(2)}`
    _geocodeCache.set(key, fallback)
    return fallback
  }
}

export async function getWeather(lat = MURFREESBORO.lat, lon = MURFREESBORO.lon) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current:
      'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code,is_day',
    hourly:
      'temperature_2m,precipitation_probability,precipitation,wind_speed_10m,relative_humidity_2m,weather_code',
    daily:
      'temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: 'auto',
    forecast_days: '7'
  })
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
  if (!res.ok) throw new Error('weather fetch failed')
  return res.json()
}

// Per-trade work window constraints.
// stop  = hard blocker (safety or quality ruin)
// warn  = workable but margins tight
type RuleThresholds = { tempMin?: number; tempMax?: number; rain?: number; wind?: number; humidity?: number }
type TradeRule = { stop?: RuleThresholds; warn?: RuleThresholds }
type WeatherSnapshot = {
  temperature_2m?: number | null
  precipitation?: number | null
  wind_speed_10m?: number | null
  relative_humidity_2m?: number | null
}

export const TRADE_RULES: Record<string, TradeRule> = {
  concrete:   { stop: { tempMin: 40, tempMax: 95, rain: 0.05, wind: 30 },
                warn: { tempMin: 50, tempMax: 85, rain: 0.01, humidity: 85 } },
  roofing:    { stop: { tempMin: 35, tempMax: 100, rain: 0.01, wind: 20 },
                warn: { tempMin: 40, tempMax: 95, wind: 15 } },
  paint:      { stop: { tempMin: 45, tempMax: 95, rain: 0.01, humidity: 85 },
                warn: { tempMin: 50, tempMax: 85, humidity: 70 } },
  framing:    { stop: { tempMin: 15, tempMax: 105, rain: 0.25, wind: 35 },
                warn: { wind: 25 } },
  gc:         { stop: { tempMin: 15, tempMax: 105, rain: 0.5, wind: 35 },
                warn: { wind: 25 } },
  electrical: { stop: { rain: 0.1, wind: 35 },
                warn: { rain: 0.02 } },
  plumbing:   { stop: { tempMin: 20, rain: 0.5, wind: 40 },
                warn: { tempMin: 32 } },
  fencing:    { stop: { tempMin: 25, tempMax: 100, rain: 0.25, wind: 30 },
                warn: { rain: 0.05, wind: 20 } },
  outdoor:    { stop: { tempMin: 40, tempMax: 100, rain: 0.1, wind: 25 },
                warn: { rain: 0.02, humidity: 85 } },
  demo:       { stop: { tempMin: 15, tempMax: 105, rain: 0.25, wind: 35 },
                warn: { wind: 25 } }
}

// Status for a single trade given a weather snapshot.
// Returns { status: 'go' | 'warn' | 'stop', reasons: string[] }
export function tradeStatus(trade: string, snapshot: WeatherSnapshot | null | undefined): { status: 'go' | 'warn' | 'stop'; reasons: string[] } {
  const rules = TRADE_RULES[trade]
  if (!rules || !snapshot) return { status: 'go', reasons: [] }
  const t = snapshot.temperature_2m
  const rain = snapshot.precipitation ?? 0
  const wind = snapshot.wind_speed_10m ?? 0
  const rh = snapshot.relative_humidity_2m ?? 0

  const reasons: string[] = []
  let status: 'go' | 'warn' | 'stop' = 'go'

  const hit = (level: 'stop' | 'warn') => {
    const r = rules[level]
    if (!r) return false
    if (r.tempMin != null && t != null && t < r.tempMin) {
      reasons.push(`${Math.round(t)}°F below ${r.tempMin}°F`)
      return true
    }
    if (r.tempMax != null && t != null && t > r.tempMax) {
      reasons.push(`${Math.round(t)}°F over ${r.tempMax}°F`)
      return true
    }
    if (r.rain != null && rain > r.rain) {
      reasons.push(`rain ${rain.toFixed(2)}"`)
      return true
    }
    if (r.wind != null && wind > r.wind) {
      reasons.push(`wind ${Math.round(wind)} mph`)
      return true
    }
    if (r.humidity != null && rh > r.humidity) {
      reasons.push(`humidity ${Math.round(rh)}%`)
      return true
    }
    return false
  }

  if (hit('stop')) status = 'stop'
  else if (hit('warn')) status = 'warn'
  return { status, reasons }
}

// Aggregate across all selected trades. Worst status wins. With no trades
// picked, read the general building rules, key 'gc' (the same fallback the
// Forecast trade list uses) instead of calling every hour clear.
export function workWindow(snapshot: WeatherSnapshot | null | undefined, services: string[] = []): { status: 'go' | 'warn' | 'stop'; label: string; reasons: string[] } {
  if (!snapshot) return { status: 'go', label: 'Awaiting forecast', reasons: [] }
  const trades = services.length ? services : ['gc']
  let worst: 'go' | 'warn' | 'stop' = 'go'
  const allReasons = new Set<string>()
  for (const s of trades) {
    const { status, reasons } = tradeStatus(s, snapshot)
    reasons.forEach((r) => allReasons.add(r))
    if (status === 'stop') worst = 'stop'
    else if (status === 'warn' && worst !== 'stop') worst = 'warn'
  }
  const label =
    worst === 'stop' ? 'Stand down'
    : worst === 'warn' ? 'Tight window'
    : 'Clear to work'
  return { status: worst, label, reasons: [...allReasons] }
}

// Index of the hourly slot that holds `now`, or -1 when every slot is
// already over. Open-Meteo's hourly arrays start at local midnight today,
// so reading from index 0 shows hours that are gone. `now` is either the
// forecast's own current.time ("2026-10-09T16:15", local to the forecast
// spot, compared by hour as text) or epoch ms.
function currentHourIndex(times: string[], now: string | number): number {
  if (typeof now === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}/.test(now)) {
    const hour = now.slice(0, 13)
    return times.findIndex((t) => String(t).slice(0, 13) >= hour)
  }
  const ms = typeof now === 'number' && Number.isFinite(now) ? now : Date.now()
  return times.findIndex((t) => new Date(t).getTime() + 3_600_000 > ms)
}

// Hourly go/warn/stop dots for the next N hours across selected trades,
// starting with the hour in progress.
export function hourlyStrip(hourly: any, services: string[] = [], hours = 24, now: string | number = Date.now()) {
  if (!hourly?.time) return []
  const start = currentHourIndex(hourly.time, now)
  if (start < 0) return []
  const end = Math.min(start + hours, hourly.time.length)
  const out: { time: string; status: string; temp: number | undefined; rain: number }[] = []
  for (let i = start; i < end; i++) {
    const snap = {
      temperature_2m: hourly.temperature_2m?.[i],
      precipitation: hourly.precipitation?.[i],
      wind_speed_10m: hourly.wind_speed_10m?.[i],
      relative_humidity_2m: hourly.relative_humidity_2m?.[i]
    }
    const w = workWindow(snap, services)
    out.push({
      time: hourly.time[i],
      status: w.status,
      temp: snap.temperature_2m,
      rain: hourly.precipitation_probability?.[i] ?? 0
    })
  }
  return out
}

// Friendly weather_code label. WMO codes.
export function weatherLabel(code: number | null | undefined) {
  if (code == null) return '\u2003'
  if (code === 0) return 'Clear'
  if (code === 1) return 'Mostly clear'
  if (code === 2) return 'Partly cloudy'
  if (code === 3) return 'Overcast'
  if (code === 45 || code === 48) return 'Fog'
  if (code >= 51 && code <= 57) return 'Drizzle'
  if (code >= 61 && code <= 67) return 'Rain'
  if (code >= 71 && code <= 77) return 'Snow'
  if (code >= 80 && code <= 82) return 'Rain showers'
  if (code >= 85 && code <= 86) return 'Snow showers'
  if (code >= 95) return 'Thunderstorm'
  return '\u2003'
}

export function pourRating(current: WeatherSnapshot | null | undefined) {
  if (!current) return { label: '\u2003', tone: 'neutral' }
  const w = workWindow(current, ['concrete'])
  const tone = w.status === 'stop' ? 'alert' : w.status === 'warn' ? 'warn' : 'ok'
  return { label: w.label, tone }
}
