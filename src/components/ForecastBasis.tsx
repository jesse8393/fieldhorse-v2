import { useNow } from '../lib/useNow.ts'
import { WEATHER_FRESH_MS } from '../lib/weather.ts'
import { tradeRuleBasis } from '../lib/forecastAssessment.ts'
import '../styles/forecast-audit.css'

export default function ForecastBasis({ weather, receivedAt, trades, generalOutlook = false }: { weather: any; receivedAt: number | null; trades: string[]; generalOutlook?: boolean }) {
  const now = useNow()
  const outdated = receivedAt != null && now.getTime() - receivedAt >= WEATHER_FRESH_MS
  return <section className="fh-forecast-basis" aria-label="Forecast source and decision basis">
    <p><strong>Source: Open Meteo.</strong> {receivedAt ? `Retrieved ${new Date(receivedAt).toLocaleString()}.` : 'Retrieval time unavailable.'}</p>
    <p>{weather?.current?.time ? `Conditions timestamp: ${String(weather.current.time).replace('T', ' ')} ${weather.timezone || '(forecast local time)'}.` : 'Conditions timestamp unavailable.'}</p>
    {outdated && <p role="status">Forecast retrieval exceeds 30 minutes. Refresh before planning work.</p>}
    <p>Planning guidance uses configured app limits. Check onsite conditions and material requirements before work.</p>
    <details><summary>View configured weather limits</summary><ul>{trades.map((trade) => <li key={trade}><strong>{trade}</strong><p>{tradeRuleBasis(trade)}</p></li>)}</ul>
      {generalOutlook ? <p>Daily outlook uses separate general limits. Caution starts at 30% rain, 15 mph wind, highs of 90°F or lows of 40°F. Review limits starts at 60% rain, 25 mph wind, highs of 100°F or lows of 32°F. These thresholds do not replace trade requirements.</p> : <p>Daily trade status uses hourly readings from 7am through 6pm at this location. Any missing required reading produces unknown status.</p>}
    </details>
  </section>
}
