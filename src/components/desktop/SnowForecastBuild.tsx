// SnowForecastBuild, desktop /pour-window in the Build direction.
//
// Drop-in replacement for the PourWindow mobile flow at >=900px.
// Built around weather-sensitive day cards, current work window
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
import { dailyForecastStatus } from '../../lib/forecastAssessment.ts'
import ForecastBasis from '../ForecastBasis.tsx'
import MiniMetric from '../MiniMetric.tsx'
import PaletteKeyCap, { paletteShortcut } from './PaletteKeyCap.tsx'

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
  receivedAt: number | null
  currentWindow: WorkWindow | null | undefined
  daily: DailyRow[]
  tradeRows: TradeRow[]
  onPinLocation: () => void
  // Present only when the forecast request failed.
  onRetry?: () => void
  onGoToSchedule?: () => void
}

const STATUS_TONE: Record<string, 'good' | 'warn' | 'bad' | 'neutral'> = {
  go: 'good',
  caution: 'warn',
  warn: 'warn',
  stop: 'bad',
  'no-go': 'bad',
  nogo: 'bad',
}

function tone(status: string | undefined) {
  return STATUS_TONE[String(status || '').toLowerCase()] || 'neutral'
}

function fmtDay(iso: string) {
  if (!iso) return '\u2003'
  try {
    const d = new Date(iso + 'T12:00:00')
    return d.toLocaleDateString(undefined, { weekday: 'short' })
  } catch { return '\u2003' }
}

function fmtDate(iso: string) {
  if (!iso) return ''
  try {
    const d = new Date(iso + 'T12:00:00')
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch { return '' }
}


export default function SnowForecastBuild(props: Props) {
  const {
    loading, err, hasCoords, cityName, weather, receivedAt,
    currentWindow, daily, tradeRows,
    onPinLocation, onRetry, onGoToSchedule,
  } = props

  const current = weather?.current || {}
  const tMax = current.temperature_2m
  const wind = current.wind_speed_10m
  const humidity = current.relative_humidity_2m
  const rain = current.precipitation

  // No forecast yet (loading or failed): stay neutral instead of claiming
  // a clear day, and say what is going on.
  const hasForecast = Boolean(weather?.current)
  const windowTone = hasForecast ? tone(currentWindow?.status || 'go') : 'neutral'
  const windowLabel = !hasForecast
    ? (loading ? 'Loading forecast' : onRetry ? 'Forecast unavailable' : 'Awaiting forecast')
    : currentWindow?.label || (windowTone === 'good' ? 'Clear to work' : windowTone === 'warn' ? 'Proceed with caution' : 'Hold work')

  // Best work window over the next 7 days = first 'good' day
  const bestDay = daily.find((d) => dailyForecastStatus(d).tone === 'good')
  const rainKnownDays = daily.filter((d) => typeof d.rainPct === 'number' && Number.isFinite(d.rainPct))
  const rainRiskDays = rainKnownDays.filter((d) => d.rainPct! >= 50).length
  const noGoDays = daily.filter((d) => dailyForecastStatus(d).tone === 'bad').length
  const suggestedAction = !hasForecast || windowTone === 'neutral'
    ? 'Check the forecast before dispatch'
    : noGoDays >= 3
    ? 'Reschedule outdoor crews'
    : windowTone === 'bad'
      ? 'Hold and reassess'
      : windowTone === 'warn'
        ? 'Review before dispatch'
        : noGoDays > 0
          ? 'Review affected days'
          : 'Keep crews on plan'

  return (
    <div className="fh-build-page" data-build-screen="SnowForecastBuild">
      <header className="fh-build-topbar">
        <button
          type="button"
          className="fh-build-search"
          onClick={() => window.dispatchEvent(new CustomEvent('fh:open-palette'))}
          aria-label="Open command palette"
          aria-keyshortcuts={paletteShortcut().combo}
        >
          <Search size={14} />
          <span>Search jobs, clients, invoices, notes...</span>
          <PaletteKeyCap />
        </button>
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
            <span>Weather unavailable</span>
          )}
        </div>
        <button className="fh-build-icon-btn" type="button" onClick={() => window.dispatchEvent(new CustomEvent('fh:navigate', { detail: { to: '/activity' } }))} aria-label="Open activity" title="Activity"><Bell size={16} /></button>
        <button className="fh-build-new-btn" type="button" onClick={onPinLocation}>
          <MapPin size={15} /> {hasCoords ? 'Pin again' : 'Pin location'}
        </button>
      </header>

      <div className="fh-build-main">
        <section className="fh-build-hero-row fh-build-hero-row--page">
          <div>
            <div className="fh-build-good">Planning</div>
            <h1 className="fh-build-title">Forecast</h1>
          </div>

          <div className={`fh-build-focus fh-build-window-card is-${windowTone}`}>
            <div className="fh-build-eyebrow">Current work window</div>
            <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--v3-text)', margin: '8px 0 4px' }}>
              {windowLabel}
            </p>
            {currentWindow?.reasons && currentWindow.reasons.length > 0 && (
              <p style={{ marginTop: 4 }}>
                {currentWindow.reasons.slice(0, 2).join(' · ')}
              </p>
            )}
            {!hasCoords && (
              <p style={{ marginTop: 8, color: 'var(--v3-primary-text)' }}>
                Pin a location for accurate work window signals.
              </p>
            )}
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Temperature" value={tMax != null ? `${Math.round(tMax)}°` : '\u2003'} accent />
            <MiniMetric label="Wind" value={wind != null ? `${Math.round(wind)} mph` : '\u2003'} tone={(wind ?? 0) >= 20 ? 'warn' : undefined} />
            <MiniMetric label="Humidity" value={humidity != null ? `${Math.round(humidity)}%` : '\u2003'} />
            <MiniMetric label="Rain now" value={!hasForecast || rain == null ? '\u2003' : rain > 0 ? `${rain.toFixed(2)}″` : '0″'} tone={rain > 0 ? 'warn' : undefined} />
          </div>
        </section>

        <ForecastBasis weather={weather} receivedAt={receivedAt} generalOutlook trades={tradeRows.map((row) => row.trade)} />

        {err && (
          <div className="fh-build-banner is-warn" role="alert">
            <CloudRain size={14} />
            <span>{err}</span>
            {onRetry && (
              <button type="button" className="fh-build-banner__cta" onClick={onRetry} disabled={loading} style={{ background: 'none', border: 'none', cursor: loading ? 'wait' : 'pointer', minHeight: 44 }}>
                {loading ? 'Trying again' : 'Try again'}
              </button>
            )}
          </div>
        )}

        <section className="fh-build-content-grid fh-build-content-grid--forecast">
          <div className="fh-build-forecast-main">
            <section className="fh-build-card">
              <header className="fh-build-card-head">
                <div className="fh-build-eyebrow">7 day outlook</div>
                {onGoToSchedule && (
                  <button type="button" onClick={onGoToSchedule}>
                    <CalendarDays size={11} /> Open schedule
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
                  const s = dailyForecastStatus(d)
                  return (
                    <div key={d.time || i} className={`fh-build-forecast-day is-${s.tone}`}>
                      <div className="fh-build-forecast-day__head">
                        <span className="fh-build-forecast-day__weekday">{fmtDay(d.time)}</span>
                        <span className="fh-build-forecast-day__date">{fmtDate(d.time)}</span>
                      </div>
                      <div className="fh-build-forecast-day__temp">
                        <strong>{d.tMax != null ? `${Math.round(d.tMax)}°` : '\u2003'}</strong>
                        <span>{d.tMin != null ? `${Math.round(d.tMin)}°` : '\u2003'}</span>
                      </div>
                      <div className="fh-build-forecast-day__row">
                        <Droplets size={11} />
                        <span>{d.rainPct == null ? 'Unknown' : `${d.rainPct}%`}</span>
                        {(d.rainSum ?? 0) > 0 && <span className="fh-build-rel">{(d.rainSum ?? 0).toFixed(2)}″</span>}
                      </div>
                      <div className="fh-build-forecast-day__row">
                        <Wind size={11} />
                        <span>{d.windMax == null ? 'Unknown' : `${Math.round(d.windMax)} mph`}</span>
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
                  {hasCoords ? 'No trade data available.' : 'Pin a location to see specific trade signals.'}
                </div>
              ) : tradeRows.map((t: any) => {
                const tt = tone(t.status)
                return (
                  <div key={t.trade} className="fh-build-table__row is-trades">
                    <strong style={{ textTransform: 'capitalize' }}>{t.trade}</strong>
                    <span className={`fh-build-dot is-${tt}`}>{t.label || ({ go: 'Within limits', warn: 'Caution', stop: 'Review', unknown: 'Unknown' } as Record<string, string>)[t.status] || 'Unknown'}</span>
                    <span className="fh-build-truncate fh-build-rel" title={(t.reasons || []).join(' · ')}>
                      {(t.reasons || []).slice(0, 2).join(' · ') || 'No configured limit triggered.'}
                    </span>
                  </div>
                )
              })}
            </section>
          </div>

          <aside className="fh-build-rail fh-build-rail--page">
            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Best work window</div>
              <strong>{bestDay ? fmtDay(bestDay.time) : '\u2003'}</strong>
              <span>{bestDay ? fmtDate(bestDay.time) : daily.length ? 'No clear day identified' : 'No forecast yet'}</span>
              {bestDay && <div className="fh-build-spark is-gold" />}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Rain risk</div>
              <strong style={{ color: !rainKnownDays.length ? undefined : rainRiskDays > 0 ? 'var(--v3-primary-text)' : 'var(--v3-success-text)' }}>{rainKnownDays.length ? rainRiskDays : 'Unknown'}</strong>
              <span>{rainKnownDays.length ? `of ${rainKnownDays.length} assessed days at 50% rain or more` : 'Rain readings unavailable'}</span>
              {rainRiskDays > 0 && <div className="fh-build-spark is-gold" />}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Temperature</div>
              <strong>{tMax != null ? `${Math.round(tMax)}°F` : '\u2003'}</strong>
              <span>{tMax == null ? 'No reading yet' : (tMax > 90 || tMax < 40) ? 'Outside comfort range' : 'In comfort range'}</span>
              <div className="fh-build-rail-card__spark">
                <Thermometer size={14} />
                <span>{tMax != null ? (tMax > 90 ? 'Hot' : tMax < 50 ? 'Cold' : 'Comfortable') : '\u2003'}</span>
              </div>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Wind</div>
              <strong>{wind != null ? `${Math.round(wind)} mph` : '\u2003'}</strong>
              <span>{wind == null ? 'Reading unavailable' : wind >= 20 ? 'Review wind conditions' : 'Check applicable trade limits'}</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Suggested action</div>
              <strong>{suggestedAction}</strong>
              <span>
                {noGoDays} of {daily.length} forecast days trigger general limits
              </span>
              {onGoToSchedule && (
                <button type="button" className="fh-build-rail-card__action" onClick={onGoToSchedule}>
                  Open schedule <ChevronRight size={13} />
                </button>
              )}
            </section>
          </aside>
        </section>
      </div>
    </div>
  )
}

// weatherLabel is now imported from ../../lib/weather.ts so the
// desktop chrome stays in sync with whatever mapping the mobile flow
// already ships.
