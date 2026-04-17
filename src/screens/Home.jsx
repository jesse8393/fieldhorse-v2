import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useProfile } from '../contexts/ProfileContext.jsx'
import Wordmark from '../components/Wordmark.jsx'
import LogoUploader from '../components/LogoUploader.jsx'
import { getWeather, workWindow, hourlyStrip, weatherLabel } from '../lib/weather.js'

function formatDay(d) {
  return d.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase()
}
function formatDate(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase()
}
function formatHour(iso) {
  const d = new Date(iso)
  const h = d.getHours()
  const suffix = h >= 12 ? 'p' : 'a'
  const hr = ((h + 11) % 12) + 1
  return `${hr}${suffix}`
}

export default function Home() {
  const { user } = useAuth()
  const { profile, upsertProfile, refresh } = useProfile()
  const navigate = useNavigate()

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const [weather, setWeather] = useState(null)
  const [weatherErr, setWeatherErr] = useState('')
  const [weatherLoading, setWeatherLoading] = useState(false)

  const hasCoords = profile?.location_lat != null && profile?.location_lon != null

  useEffect(() => {
    let cancelled = false
    if (!hasCoords) {
      setWeather(null)
      return
    }
    setWeatherLoading(true)
    setWeatherErr('')
    getWeather(profile.location_lat, profile.location_lon)
      .then((d) => { if (!cancelled) setWeather(d) })
      .catch((e) => { if (!cancelled) setWeatherErr(e.message || 'Forecast unavailable') })
      .finally(() => { if (!cancelled) setWeatherLoading(false) })
    return () => { cancelled = true }
  }, [profile?.location_lat, profile?.location_lon, hasCoords])

  const windowRead = useMemo(
    () => workWindow(weather?.current, profile?.services || []),
    [weather, profile?.services]
  )

  const strip = useMemo(
    () => hourlyStrip(weather?.hourly, profile?.services || [], 24),
    [weather, profile?.services]
  )

  async function pinLocation() {
    if (!('geolocation' in navigator)) {
      setWeatherErr('Geolocation not supported')
      return
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await upsertProfile({
          location_lat: pos.coords.latitude,
          location_lon: pos.coords.longitude
        })
        refresh()
      },
      () => setWeatherErr('Location denied'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60 * 60 * 1000 }
    )
  }

  // Inline-edit greeting
  const [editingGreeting, setEditingGreeting] = useState(false)
  const [greetingDraft, setGreetingDraft] = useState(profile?.greeting || '')
  const greetingRef = useRef(null)
  useEffect(() => {
    if (!editingGreeting) setGreetingDraft(profile?.greeting || '')
  }, [profile?.greeting, editingGreeting])
  useEffect(() => {
    if (editingGreeting && greetingRef.current) {
      greetingRef.current.focus()
      greetingRef.current.select()
    }
  }, [editingGreeting])

  async function saveGreeting() {
    const next = greetingDraft.trim().slice(0, 90)
    setEditingGreeting(false)
    if (next !== (profile?.greeting || '')) {
      await upsertProfile({ greeting: next || null })
    }
  }

  return (
    <main className="fh-home">
      <header className="fh-home__top">
        <Wordmark size="1.6rem" />
        <div className="fh-home__topRight">
          <span className={`fh-status-pill ${weather ? '' : 'fh-status-pill--steel'}`}>
            {weatherLoading ? 'Syncing' : weather ? 'Live' : hasCoords ? 'Offline' : 'No pin'}
          </span>
          <div className="fh-home__brand">
            <LogoUploader
              logoUrl={profile?.logo_url}
              companyName={profile?.company_name}
              onUpload={async (url) => {
                await upsertProfile({ logo_url: url })
                refresh()
              }}
              size="sm"
            />
            <span className="fh-home__company">{profile?.company_name || ''}</span>
          </div>
        </div>
      </header>

      <section className="fh-home__hero">
        <div className="fh-home__date">
          <div className="fh-home__day">{formatDay(now)}</div>
          <div className="fh-home__dateline">
            <span className="fh-home__month">{formatDate(now)}</span>
            <span className="fh-home__year">{now.getFullYear()}</span>
          </div>
        </div>

        <div className="fh-home__greet">
          {editingGreeting ? (
            <textarea
              ref={greetingRef}
              className="fh-home__greet-input"
              value={greetingDraft}
              onChange={(e) => setGreetingDraft(e.target.value)}
              onBlur={saveGreeting}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveGreeting() }
                if (e.key === 'Escape') { setGreetingDraft(profile?.greeting || ''); setEditingGreeting(false) }
              }}
              maxLength={90}
              rows={2}
              placeholder="Set your line for the day…"
            />
          ) : (
            <button
              type="button"
              className={`fh-home__greet-btn${profile?.greeting ? '' : ' is-empty'}`}
              onClick={() => setEditingGreeting(true)}
              aria-label="Edit daily line"
            >
              {profile?.greeting || 'Set your line for the day'}
              <span className="fh-home__greet-edit" aria-hidden="true">
                <svg viewBox="0 0 16 16" width="12" height="12">
                  <path
                    d="M2 11.5 L2 14 L4.5 14 L12 6.5 L9.5 4 Z M11 3 L13 5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>
          )}
        </div>
      </section>

      {!hasCoords && (
        <section className="fh-pinbanner">
          <div className="fh-pinbanner__body">
            <span className="fh-pinbanner__eye">Missing · Market pin</span>
            <p className="fh-pinbanner__msg">Pin your market to unlock the forecast + work window.</p>
          </div>
          <button type="button" className="fh-pinbanner__cta" onClick={pinLocation}>
            Pin location
          </button>
        </section>
      )}

      {hasCoords && (
        <section className={`fh-window fh-window--${windowRead.status}`}>
          <header className="fh-window__head">
            <span className="fh-window__eye">Work window · now</span>
            <span className="fh-window__stamp">{weather?.current ? weatherLabel(weather.current.weather_code) : '—'}</span>
          </header>

          <div className="fh-window__row">
            <div className="fh-window__temp">
              {weather?.current?.temperature_2m != null
                ? `${Math.round(weather.current.temperature_2m)}°`
                : '—'}
            </div>
            <div className="fh-window__meta">
              <Meta label="Wind" value={weather?.current?.wind_speed_10m != null ? `${Math.round(weather.current.wind_speed_10m)} mph` : '—'} />
              <Meta label="Humidity" value={weather?.current?.relative_humidity_2m != null ? `${Math.round(weather.current.relative_humidity_2m)}%` : '—'} />
              <Meta label="Rain" value={weather?.current?.precipitation != null ? `${weather.current.precipitation.toFixed(2)}"` : '—'} />
            </div>
          </div>

          <div className="fh-window__verdict">
            <span className="fh-window__dot" aria-hidden="true" />
            <span className="fh-window__label">{windowRead.label}</span>
            {windowRead.reasons.length > 0 && (
              <span className="fh-window__reason">{windowRead.reasons.join(' · ')}</span>
            )}
          </div>

          {strip.length > 0 && (
            <div className="fh-strip" aria-label="Next 24 hours">
              {strip.map((h, i) => (
                <div key={i} className={`fh-strip__cell fh-strip__cell--${h.status}`} title={`${formatHour(h.time)} · ${Math.round(h.temp)}°`}>
                  <span className="fh-strip__bar" />
                  {i % 3 === 0 && <span className="fh-strip__tick">{formatHour(h.time)}</span>}
                </div>
              ))}
            </div>
          )}

          {weatherLoading && <p className="fh-window__note">Pulling forecast…</p>}
          {weatherErr && <p className="fh-window__note fh-window__note--err">{weatherErr}</p>}
        </section>
      )}

      <section className="fh-quick">
        <span className="fh-sec-tag">
          <span className="fh-sec-tag__num">§ 01</span>
          <span className="fh-sec-tag__label">Quick actions</span>
        </span>
        <div className="fh-quick__grid">
          <QuickAction code="QA·01" label="Field note" sub="Log what you saw" icon="note" onClick={() => navigate('/notes')} />
          <QuickAction code="QA·02" label="New job" sub="Open a pipeline card" icon="job" onClick={() => navigate('/jobs?new=1')} />
          <QuickAction code="QA·03" label="AI compose" sub="Draft the next message" icon="ai" onClick={() => navigate('/compose')} />
          <QuickAction code="QA·04" label="Bid engine" sub="Scope to number, fast" icon="bid" onClick={() => navigate('/bid')} />
        </div>
      </section>

      <section className="fh-sched">
        <header className="fh-sched__head">
          <span className="fh-sec-tag">
            <span className="fh-sec-tag__num">§ 02</span>
            <span className="fh-sec-tag__label">Today</span>
          </span>
          <span className="fh-status-pill fh-status-pill--steel">0 jobs</span>
        </header>
        <div className="fh-sched__empty">
          <p>No jobs on the board yet.</p>
          <button type="button" className="fh-link" onClick={() => navigate('/jobs?new=1')}>Add the first one →</button>
        </div>
      </section>

      <footer className="fh-home__foot">
        <span>Fieldhorse</span>
        <span className="fh-home__foot-dot" />
        <span>{user?.email}</span>
      </footer>
    </main>
  )
}

function Meta({ label, value }) {
  return (
    <div className="fh-meta">
      <span className="fh-meta__k">{label}</span>
      <span className="fh-meta__v">{value}</span>
    </div>
  )
}

function QuickAction({ label, sub, icon, onClick, code }) {
  return (
    <button type="button" className="fh-qa" onClick={onClick}>
      {code && <span className="fh-spec-code" aria-hidden="true">{code}</span>}
      <span className="fh-qa__icon" aria-hidden="true">{icon === 'note' && <IconNote />}{icon === 'job' && <IconJob />}{icon === 'ai' && <IconAI />}{icon === 'bid' && <IconBid />}</span>
      <span className="fh-qa__body">
        <span className="fh-qa__label">{label}</span>
        <span className="fh-qa__sub">{sub}</span>
      </span>
      <span className="fh-qa__arrow" aria-hidden="true">→</span>
    </button>
  )
}

function IconNote() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M9 8h8M9 12h8M9 16h5" />
    </svg>
  )
}
function IconJob() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="14" rx="1.5" />
      <path d="M8 6V4h8v2" />
      <path d="M3 12h18" />
    </svg>
  )
}
function IconAI() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" />
      <path d="M18 14l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" />
    </svg>
  )
}
function IconBid() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h12l4 4v12H4z" />
      <path d="M8 12h8M8 16h5" />
      <path d="M16 4v4h4" />
    </svg>
  )
}
