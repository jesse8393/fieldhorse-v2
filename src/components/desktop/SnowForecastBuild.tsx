// SnowForecastBuild — desktop /pour-window in the Build direction.
//
// Drop-in replacement for the PourWindow mobile flow at >=900px.
// Built around weather-sensitive day cards, current work-window
// signals, and per-trade status. Same weather data, same handlers,
// new visual chrome.

import {
  Bell,
  CloudRain,
  MapPin,
  Search,
  Sun,
  Thermometer,
  Wind,
  Droplets,
  ChevronRight,
  CalendarDays,
} from 'lucide-react'
import { weatherLabel } from '../../lib/weather.ts'

type DailyRow = {
  time: string
  tMax?: number
  tMin?: number
  rainPct?: number
  rainSum?: number
  windMax?: number
}

type TradeRow = {
  trade: string
  status?: 'go' | 'caution' | 'no-go' | string
  label?: string
  reasons?: string[]
}

type WorkWindow = {
  status?: 'go' | 'caution' | 'no-go' | string
  label?: string
  reasons?: string[]
}

type Props = {
  loading: boolean
  err: string
  hasCoords: boolean
  cityName: string
  weather: any
  currentWindow: WorkWindow | null | undefined
  daily: DailyRow[]
  tradeRows: TradeRow[]
  onPinLocation: () => void
  onGoToSchedule?: () => void
}

const STATUS_TONE: Record<string, 'good' | 'warn' | 'bad' | 'neutral'> = {
  go: 'good',
  caution: 'warn',
  'no-go': 'bad',
  nogo: 'bad',
}

function tone(status: string | undefined) {
  return STATUS_TONE[String(status || '').toLowerCase()] || 'neutral'
}

function fmtDay(iso: string) {
  if (!iso) return '—'
  try {
    const d = new Date(iso + 'T12:00:00')
    return d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()
  } catch { return '—' }
}

function fmtDate(iso: string) {
  if (!iso) return ''
  try {
    const d = new Date(iso + 'T12:00:00')
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch { return '' }
}

function dayWorkStatus(d: DailyRow): { tone: 'good' | 'warn' | 'bad'; label: string } {
  const rain = d.rainPct ?? 0
  const wind = d.windMax ?? 0
  const tMax = d.tMax ?? 70
  const tMin = d.tMin ?? 50
  if (rain >= 60 || wind >= 25 || tMax >= 100 || tMin <= 32) return { tone: 'bad', label: 'No-go' }
  if (rain >= 30 || wind >= 15 || tMax >= 90 || tMin <= 40) return { tone: 'warn', label: 'Caution' }
  return { tone: 'good', label: 'Go' }
}

export default function SnowForecastBuild(props: Props) {
  const {
    loading, err, hasCoords, cityName, weather,
    currentWindow, daily, tradeRows,
    onPinLocation, onGoToSchedule,
  } = props

  const current = weather?.current || {}
  const tMax = current.temperature_2m
  const wind = current.wind_speed_10m
  const humidity = current.relative_humidity_2m
  const rain = current.precipitation ?? 0

  const windowTone = tone(currentWindow?.status || 'go')
  const windowLabel = currentWindow?.label || (windowTone === 'good' ? 'Clear to work' : windowTone === 'warn' ? 'Proceed with caution' : 'Hold work')

  // Best work window over the next 7 days = first 'good' day
  const bestDay = daily.find((d) => dayWorkStatus(d).tone === 'good')
  const rainRiskDays = daily.filter((d) => (d.rainPct ?? 0) >= 50).length
  const noGoDays = daily.filter((d) => dayWorkStatus(d).tone === 'bad').length

  return (
    <div className="fh-build-page">
      <header className="fh-build-topbar">
        <div className="fh-build-search">
          <Search size={14} />
          <span>Search jobs, clients, invoices, notes...</span>
          <kbd>⌘K</kbd>
        </div>
        <div className="fh-build-topbar__meta">
          <span>
            <MapPin size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: '-1px' }} />
            {cityName || (hasCoords ? 'Pinned location' : 'No location pinned')}
          </span>
          <span className="fh-build-vline" />
          {tMax != null ? (
            <>
              <span>{Math.round(tMax)}° · {weatherLabel(current.weather_code)}</span>
              <Sun size={16} className="fh-build-sun" />
            </>
          ) : (
            <span>—</span>
          )}
        </div>
        <button className="fh-build-icon-btn" type="button"><Bell size={16} /></button>
        <button className="fh-build-new-btn" type="button" onClick={onPinLocation}>
          <MapPin size={15} /> {hasCoords ? 'Re-pin' : 'Pin location'}
        </button>
      </header>

      <main className="fh-build-main">
        <section className="fh-build-hero-row fh-build-hero-row--page">
          <div>
            <div className="fh-build-good">Forecast</div>
            <h1 className="fh-build-title">PLAN THE WORK.</h1>
          </div>

          <div className={`fh-build-focus fh-build-window-card is-${windowTone}`}>
            <div className="fh-build-eyebrow">Current work window</div>
            <p style={{ fontSize: 17, fontWeight: 700, color: '#f4f1ea', margin: '8px 0 4px' }}>
              {windowLabel}
            </p>
            {currentWindow?.reasons && currentWindow.reasons.length > 0 && (
              <p style={{ marginTop: 4 }}>
                {currentWindow.reasons.slice(0, 2).join(' · ')}
              </p>
            )}
            {!hasCoords && (
              <p style={{ marginTop: 8, color: '#e0a141' }}>
                Pin a location for accurate work-window signals.
              </p>
            )}
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Temperature" value={tMax != null ? `${Math.round(tMax)}°` : '—'} accent />
            <MiniMetric label="Wind" value={wind != null ? `${Math.round(wind)} mph` : '—'} tone={(wind ?? 0) >= 20 ? 'warn' : undefined} />
            <MiniMetric label="Humidity" value={humidity != null ? `${Math.round(humidity)}%` : '—'} />
            <MiniMetric label="Rain now" value={rain > 0 ? `${rain.toFixed(2)}″` : '0″'} tone={rain > 0 ? 'warn' : undefined} />
          </div>
        </section>

        {err && (
          <div className="fh-build-banner is-warn">
            <CloudRain size={14} />
            <span>{err}</span>
          </div>
        )}

        <section className="fh-build-content-grid fh-build-content-grid--forecast">
          <div className="fh-build-forecast-main">
            <section className="fh-build-card">
              <header className="fh-build-card-head">
                <div className="fh-build-eyebrow">7-day outlook</div>
                {onGoToSchedule && (
                  <button type="button" onClick={onGoToSchedule}>
                    <CalendarDays size={11} /> Open Schedule
                  </button>
                )}
              </header>
              <div className="fh-build-forecast-days">
                {loading ? (
                  <div className="fh-build-table__empty">Loading forecast…</div>
                ) : daily.length === 0 ? (
                  <div className="fh-build-table__empty">
                    {hasCoords ? 'Forecast unavailable.' : 'Pin a location to load the forecast.'}
                  </div>
                ) : daily.slice(0, 7).map((d, i) => {
                  const s = dayWorkStatus(d)
                  return (
                    <div key={d.time || i} className={`fh-build-forecast-day is-${s.tone}`}>
                      <div className="fh-build-forecast-day__head">
                        <span className="fh-build-forecast-day__weekday">{fmtDay(d.time)}</span>
                        <span className="fh-build-forecast-day__date">{fmtDate(d.time)}</span>
                      </div>
                      <div className="fh-build-forecast-day__temp">
                        <strong>{d.tMax != null ? `${Math.round(d.tMax)}°` : '—'}</strong>
                        <span>{d.tMin != null ? `${Math.round(d.tMin)}°` : '—'}</span>
                      </div>
                      <div className="fh-build-forecast-day__row">
                        <Droplets size={11} />
                        <span>{(d.rainPct ?? 0)}%</span>
                        {(d.rainSum ?? 0) > 0 && <span className="fh-build-rel">{(d.rainSum ?? 0).toFixed(2)}″</span>}
                      </div>
                      <div className="fh-build-forecast-day__row">
                        <Wind size={11} />
                        <span>{Math.round(d.windMax ?? 0)} mph</span>
                      </div>
                      <span className={`fh-build-dot is-${s.tone}`}>{s.label}</span>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="fh-build-card fh-build-table">
              <header className="fh-build-card-head">
                <div className="fh-build-eyebrow">Trade status · current conditions</div>
                <span className="fh-build-rel">{tradeRows.length} {tradeRows.length === 1 ? 'trade' : 'trades'}</span>
              </header>
              <div className="fh-build-table__head is-trades">
                <span>Trade</span>
                <span>Status</span>
                <span>Notes</span>
              </div>
              {tradeRows.length === 0 ? (
                <div className="fh-build-table__empty">
                  {hasCoords ? 'No trade data available.' : 'Pin a location to see trade-specific signals.'}
                </div>
              ) : tradeRows.map((t: any) => {
                const tt = tone(t.status)
                return (
                  <div key={t.trade} className="fh-build-table__row is-trades">
                    <strong style={{ textTransform: 'capitalize' }}>{t.trade}</strong>
                    <span className={`fh-build-dot is-${tt}`}>{t.label || t.status || 'Unknown'}</span>
                    <span className="fh-build-truncate fh-build-rel" title={(t.reasons || []).join(' · ')}>
                      {(t.reasons || []).slice(0, 2).join(' · ') || '—'}
                    </span>
                  </div>
                )
              })}
            </section>
          </div>

          <aside className="fh-build-rail fh-build-rail--page">
            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Best work window</div>
              <strong>{bestDay ? fmtDay(bestDay.time) : '—'}</strong>
              <span>{bestDay ? fmtDate(bestDay.time) : 'No clear days ahead'}</span>
              {bestDay && <div className="fh-build-spark is-gold" />}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Rain risk</div>
              <strong style={{ color: rainRiskDays > 0 ? '#e0a141' : '#73c982' }}>{rainRiskDays}</strong>
              <span>days ≥ 50% chance</span>
              {rainRiskDays > 0 && <div className="fh-build-spark is-gold" />}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Temperature</div>
              <strong>{tMax != null ? `${Math.round(tMax)}°F` : '—'}</strong>
              <span>{tMax != null && (tMax > 90 || tMax < 40) ? 'Outside comfort range' : 'In comfort range'}</span>
              <div className="fh-build-rail-card__spark">
                <Thermometer size={14} />
                <span>{tMax != null ? (tMax > 80 ? 'hot' : tMax < 50 ? 'cool' : 'mild') : '—'}</span>
              </div>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Wind</div>
              <strong>{wind != null ? `${Math.round(wind)} mph` : '—'}</strong>
              <span>{(wind ?? 0) >= 20 ? 'Lift work risky' : 'Within limits'}</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Suggested action</div>
              <strong>
                {noGoDays >= 3 ? 'Reschedule outdoor crews' : windowTone === 'good' ? 'Push schedule forward' : 'Hold + reassess'}
              </strong>
              <span>
                {noGoDays} of next 7 days marked no-go
              </span>
              {onGoToSchedule && (
                <button type="button" className="fh-build-rail-card__action" onClick={onGoToSchedule}>
                  Open Schedule <ChevronRight size={13} />
                </button>
              )}
            </section>
          </aside>
        </section>
      </main>
    </div>
  )
}

function MiniMetric({ label, value, accent, tone: t }: { label: string; value: string; accent?: boolean; tone?: 'warn' | 'bad' }) {
  return (
    <div className="fh-build-mini">
      <strong style={{
        color: t === 'bad' ? '#ee4942' : t === 'warn' ? '#e0a141' : accent ? 'var(--v3-primary, #c9963a)' : undefined,
      }}>
        {value}
      </strong>
      <span>{label}</span>
    </div>
  )
}

// weatherLabel is now imported from ../../lib/weather.ts so the
// desktop chrome stays in sync with whatever mapping the mobile flow
// already ships.
