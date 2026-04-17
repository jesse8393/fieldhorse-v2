import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useProfile } from '../contexts/ProfileContext.jsx'
import Wordmark from '../components/Wordmark.jsx'
import LogoUploader from '../components/LogoUploader.jsx'

const SERVICES = [
  {
    key: 'concrete',
    label: 'Concrete',
    code: '01·CONC',
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect x="4" y="10" width="24" height="14" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="10" cy="16" r="1" fill="currentColor" />
        <circle cx="16" cy="20" r="1" fill="currentColor" />
        <circle cx="22" cy="14" r="1" fill="currentColor" />
        <circle cx="14" cy="14" r="1" fill="currentColor" />
        <circle cx="20" cy="20" r="1" fill="currentColor" />
        <path d="M4 10 L16 4 L28 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    )
  },
  {
    key: 'roofing',
    label: 'Roofing',
    code: '02·ROOF',
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M3 18 L16 6 L29 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M6 18 L6 26 L26 26 L26 18" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M14 26 L14 20 L18 20 L18 26" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    )
  },
  {
    key: 'paint',
    label: 'Paint',
    code: '03·PNT',
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M20 4 L26 10 L14 22 L8 22 L8 16 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M8 22 L5 28" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M14 22 L11 28" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  },
  {
    key: 'framing',
    label: 'Framing',
    code: '04·FRM',
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect x="5" y="5" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <line x1="11" y1="5" x2="11" y2="27" stroke="currentColor" strokeWidth="1.4" />
        <line x1="16" y1="5" x2="16" y2="27" stroke="currentColor" strokeWidth="1.4" />
        <line x1="21" y1="5" x2="21" y2="27" stroke="currentColor" strokeWidth="1.4" />
        <line x1="5" y1="16" x2="27" y2="16" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    )
  },
  {
    key: 'gc',
    label: 'General Contracting',
    code: '05·GC',
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect x="7" y="5" width="18" height="22" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <rect x="12" y="3" width="8" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <line x1="11" y1="13" x2="21" y2="13" stroke="currentColor" strokeWidth="1.4" />
        <line x1="11" y1="17" x2="21" y2="17" stroke="currentColor" strokeWidth="1.4" />
        <line x1="11" y1="21" x2="17" y2="21" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    )
  },
  {
    key: 'electrical',
    label: 'Electrical',
    code: '06·ELEC',
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M18 3 L8 18 L15 18 L13 29 L24 13 L17 13 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    )
  },
  {
    key: 'plumbing',
    label: 'Plumbing',
    code: '07·PLMB',
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M4 10 L14 10 Q18 10 18 14 L18 22 Q18 26 22 26 L28 26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="2" y="7" width="4" height="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <rect x="26" y="23" width="4" height="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    )
  },
  {
    key: 'fencing',
    label: 'Fencing',
    code: '08·FENC',
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M6 12 L6 26 L10 26 L10 12 L8 9 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M14 12 L14 26 L18 26 L18 12 L16 9 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M22 12 L22 26 L26 26 L26 12 L24 9 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <line x1="4" y1="16" x2="28" y2="16" stroke="currentColor" strokeWidth="1.4" />
        <line x1="4" y1="22" x2="28" y2="22" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    )
  },
  {
    key: 'outdoor',
    label: 'Outdoor Living',
    code: '09·OUT',
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M16 6 L16 22" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M16 10 Q8 10 6 18 Q12 14 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M16 10 Q24 10 26 18 Q20 14 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <line x1="4" y1="26" x2="28" y2="26" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  },
  {
    key: 'demo',
    label: 'Demolition',
    code: '10·DEMO',
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M5 27 L16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <rect x="14" y="10" width="12" height="8" rx="1" transform="rotate(-20 20 14)" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <line x1="18" y1="8" x2="26" y2="5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    )
  }
]

export default function Onboarding() {
  const { user, signOut } = useAuth()
  const { profile, loading, isOnboarded, upsertProfile } = useProfile()
  const navigate = useNavigate()

  // Onboarding is for fresh signups. Never read from an existing profile —
  // those values belong to a different session/user and leak if prefilled.
  const [companyName, setCompanyName] = useState('')
  const [services, setServices] = useState([])
  const [coords, setCoords] = useState(null)
  const [locStatus, setLocStatus] = useState('idle') // idle | requesting | ok | error
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const canSubmit = useMemo(
    () => companyName.trim().length >= 2 && services.length >= 1,
    [companyName, services]
  )

  if (loading) return null
  if (isOnboarded) return <Navigate to="/" replace />

  function toggleService(key) {
    setServices((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]))
  }

  function requestLocation() {
    if (!('geolocation' in navigator)) {
      setLocStatus('error')
      return
    }
    setLocStatus('requesting')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setLocStatus('ok')
      },
      () => setLocStatus('error'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60 * 60 * 1000 }
    )
  }

  async function onSubmit(e) {
    e.preventDefault()
    if (!canSubmit || busy) return
    setBusy(true)
    setError('')
    const { error } = await upsertProfile({
      company_name: companyName.trim(),
      services,
      location_lat: coords?.lat ?? null,
      location_lon: coords?.lon ?? null,
      onboarded_at: new Date().toISOString()
    })
    setBusy(false)
    if (error) {
      setError(error.message || 'Could not save profile')
      return
    }
    navigate('/', { replace: true })
  }

  return (
    <main className="fh-onb">
      <header className="fh-onb__top">
        <Wordmark size="1.6rem" />
        <div className="fh-onb__spec">
          <span className="fh-onb__spec-k">Setup</span>
        </div>
      </header>

      <section className="fh-onb__hero" style={{ animationDelay: '40ms' }}>
        <p className="fh-onb__eyebrow">Onboarding · Three steps</p>
        <h1 className="fh-onb__title">
          Set up<br />
          <span className="fh-outline-text">your rig.</span>
        </h1>
        <p className="fh-onb__lede">
          Three things to lock in before the work day starts.
        </p>
        <p className="fh-hero-coord">
          {coords ? `${coords.lat.toFixed(4)}° N` : 'COORDS PENDING'}
          <span className="fh-hero-coord__dot">·</span>
          {coords ? `${coords.lon.toFixed(4)}° W` : 'NO LOCK'}
          <span className="fh-hero-coord__dot">·</span>
          {(companyName || 'NEW OPERATOR').toUpperCase()}
        </p>
      </section>

      <form className="fh-onb__form" onSubmit={onSubmit} noValidate>
        <section className="fh-onb__section" style={{ animationDelay: '120ms' }}>
          <div className="fh-onb__section-head">
            <h2 className="fh-onb__section-title">Your company.</h2>
            <span className="fh-onb__section-hint">Shows on bids, invoices, and every schedule notification.</span>
          </div>
          <div className="fh-onb__company-row">
            <div className="fh-onb__logo-slot">
              <span className="fh-onb__logo-label">Logo</span>
              <LogoUploader
                logoUrl={null}
                companyName={companyName}
                onUpload={async (url) => { await upsertProfile({ logo_url: url }) }}
                size="lg"
              />
              <span className="fh-onb__logo-hint">Optional · PNG, JPG, SVG up to 2 MB</span>
            </div>
            <label className="fh-field fh-onb__name-field">
              <span className="fh-field__label">Company name</span>
              <input
                className="fh-field__input"
                type="text"
                autoComplete="organization"
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Your company name"
                disabled={busy}
              />
            </label>
          </div>
        </section>

        <section className="fh-onb__section" style={{ animationDelay: '200ms' }}>
          <div className="fh-onb__section-head">
            <h2 className="fh-onb__section-title">What you run.</h2>
            <span className="fh-onb__section-hint">Pick every trade. This configures your rate card and pour-condition rules.</span>
          </div>
          <div className="fh-svc-grid" role="group" aria-label="Trade services">
            {SERVICES.map((svc) => {
              const on = services.includes(svc.key)
              return (
                <button
                  key={svc.key}
                  type="button"
                  className={`fh-svc${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggleService(svc.key)}
                  disabled={busy}
                >
                  <span className="fh-spec-code" aria-hidden="true">{svc.code}</span>
                  <span className="fh-svc__glyph" aria-hidden="true">{svc.glyph}</span>
                  <span className="fh-svc__label">{svc.label}</span>
                  <span className="fh-svc__mark" aria-hidden="true">
                    <svg viewBox="0 0 16 16">
                      <path
                        d="M3 8.5 L6.5 12 L13 4.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </button>
              )
            })}
          </div>
          {services.length > 0 && (
            <p className="fh-onb__count">
              {services.length} trade{services.length === 1 ? '' : 's'} on the rig
            </p>
          )}
        </section>

        <section className="fh-onb__section" style={{ animationDelay: '280ms' }}>
          <div className="fh-onb__section-head">
            <h2 className="fh-onb__section-title">Lock your location.</h2>
            <span className="fh-onb__section-hint">Weather and pour windows anchor to this point.</span>
          </div>
          <div className="fh-loc">
            <button
              type="button"
              className={`fh-loc__btn${locStatus === 'ok' ? ' is-ok' : ''}`}
              onClick={requestLocation}
              disabled={busy || locStatus === 'requesting'}
            >
              <span className="fh-loc__dot" aria-hidden="true" />
              {locStatus === 'idle' && 'Use my current location'}
              {locStatus === 'requesting' && 'Sighting…'}
              {locStatus === 'ok' && 'Location locked'}
              {locStatus === 'error' && 'Location denied · tap to retry'}
            </button>
            {coords && (
              <p className="fh-loc__read">
                {coords.lat.toFixed(3)}° N · {coords.lon.toFixed(3)}° W
              </p>
            )}
            {locStatus !== 'ok' && (
              <p className="fh-loc__note">Optional. You can set it later in Settings.</p>
            )}
          </div>
        </section>

        {error && (
          <p className="fh-auth__error" role="alert" style={{ marginTop: 'var(--space-4)' }}>
            {error}
          </p>
        )}

        <div className="fh-onb__cta" style={{ animationDelay: '360ms' }}>
          <div className="fh-counter-row">
            <div className="fh-counter">
              <div className="fh-counter__num">{services.length}</div>
              <div>
                <div className="fh-counter__label">
                  {services.length === 1 ? 'Trade on the rig' : 'Trades on the rig'}
                </div>
                <div className="fh-counter__desc">Rate card + templates tuned to match</div>
              </div>
            </div>
            <button
              type="submit"
              className="fh-btn fh-btn--primary fh-onb__submit"
              disabled={!canSubmit || busy}
            >
              {busy ? 'Saving…' : 'Start the work day'}
            </button>
          </div>
          <p className="fh-onb__meta">
            Signed in as <span>{user?.email}</span> ·{' '}
            <button
              type="button"
              className="fh-onb__link"
              onClick={async () => {
                await signOut()
                navigate('/login', { replace: true })
              }}
            >
              sign out
            </button>
          </p>
        </div>
      </form>

      <footer className="fh-onb__foot">
        <span>Fieldhorse</span>
        <span className="fh-onb__foot-sep" />
        <span>Built for the jobsite</span>
      </footer>
    </main>
  )
}
