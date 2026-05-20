import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useProfile } from '../contexts/ProfileContext.tsx'
import { toastSuccess, toastError } from '../lib/toast.ts'
import { hapticTap, hapticMedium, hapticSuccess } from '../lib/haptics.ts'
import { supabase } from '../lib/supabase.ts'
import { seedDemoData } from '../lib/demoSeed.ts'
import Wordmark from '../components/Wordmark.tsx'
import LogoUploader from '../components/LogoUploader.tsx'

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
    key: 'framing',
    label: 'Framing',
    code: '02·FRM',
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
    key: 'roofing',
    label: 'Roofing',
    code: '03·ROOF',
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M3 18 L16 6 L29 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M6 18 L6 26 L26 26 L26 18" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M14 26 L14 20 L18 20 L18 26" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    )
  },
  {
    key: 'electrical',
    label: 'Electrical',
    code: '04·ELEC',
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M18 3 L8 18 L15 18 L13 29 L24 13 L17 13 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    )
  },
  {
    key: 'plumbing',
    label: 'Plumbing',
    code: '05·PLMB',
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M4 10 L14 10 Q18 10 18 14 L18 22 Q18 26 22 26 L28 26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="2" y="7" width="4" height="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <rect x="26" y="23" width="4" height="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    )
  },
  {
    key: 'hvac',
    label: 'HVAC',
    code: '06·HVAC',
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect x="5" y="7" width="22" height="18" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <line x1="8" y1="12" x2="24" y2="12" stroke="currentColor" strokeWidth="1.3" />
        <line x1="8" y1="16" x2="24" y2="16" stroke="currentColor" strokeWidth="1.3" />
        <line x1="8" y1="20" x2="24" y2="20" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    )
  },
  {
    key: 'drywall',
    label: 'Drywall',
    code: '07·DRY',
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect x="5" y="5" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <line x1="16" y1="5" x2="16" y2="27" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2,2" />
        <path d="M 20 13 L 22 15 L 20 17" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M 12 13 L 10 15 L 12 17" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  },
  {
    key: 'paint',
    label: 'Paint',
    code: '08·PNT',
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M20 4 L26 10 L14 22 L8 22 L8 16 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M8 22 L5 28" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M14 22 L11 28" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  },
  {
    key: 'tile',
    label: 'Tile',
    code: '09·TILE',
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect x="5" y="5" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <line x1="12.3" y1="5" x2="12.3" y2="27" stroke="currentColor" strokeWidth="1.3" />
        <line x1="19.6" y1="5" x2="19.6" y2="27" stroke="currentColor" strokeWidth="1.3" />
        <line x1="5" y1="12.3" x2="27" y2="12.3" stroke="currentColor" strokeWidth="1.3" />
        <line x1="5" y1="19.6" x2="27" y2="19.6" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    )
  },
  {
    key: 'landscaping',
    label: 'Landscaping',
    code: '10·LAND',
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M16 4 L10 13 L13 13 L8 21 L14 21 L13 25 L19 25 L18 21 L24 21 L19 13 L22 13 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <line x1="16" y1="25" x2="16" y2="28" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="4" y1="28" x2="28" y2="28" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  },
  {
    key: 'excavation',
    label: 'Excavation',
    code: '11·EXCA',
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M4 22 L10 22 L10 17 L17 17 L17 22 L28 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="19" y="10" width="6" height="5" rx="0.5" transform="rotate(-15 22 12.5)" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <line x1="17" y1="17" x2="20" y2="13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="12" cy="25" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="22" cy="25" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    )
  },
  {
    key: 'insulation',
    label: 'Insulation',
    code: '12·INSL',
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M4 10 Q8 6 12 10 T 20 10 T 28 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M4 16 Q8 12 12 16 T 20 16 T 28 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M4 22 Q8 18 12 22 T 20 22 T 28 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
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

  // First-run seed flag — true means "after profile saves, also seed
  // demo data so the user lands on a stocked Home instead of em-dashes."
  // Settings → Reset everything is the explicit undo path. Default true
  // because the empty-state churn rate is brutal; user can opt out.
  async function finish({ withSeed }) {
    if (!canSubmit || busy) return
    setBusy(true)
    setError('')
    const { error: profErr } = await upsertProfile({
      company_name: companyName.trim(),
      services,
      location_lat: coords?.lat ?? null,
      location_lon: coords?.lon ?? null,
      onboarded_at: new Date().toISOString()
    })
    if (profErr) {
      setBusy(false)
      setError(profErr.message || 'Could not save profile')
      return
    }
    if (withSeed && user?.id) {
      try {
        const counts = await seedDemoData(supabase, user.id)
        hapticSuccess()
        toastSuccess('Workspace ready', `Seeded ${counts.clients} clients, ${counts.jobs} jobs, ${counts.events} events`)
      } catch (ex) {
        // Don't block the user — they still have a clean account, just no demo
        toastError("Couldn't seed sample data", ex?.message || 'Continuing with empty workspace.')
      }
    } else {
      toastSuccess('Welcome aboard', 'Your workspace is ready')
    }
    setBusy(false)
    navigate('/', { replace: true })
  }

  async function onSubmit(e) {
    // Form's default submit (Enter key) seeds — matches the recommended path.
    e.preventDefault()
    finish({ withSeed: true })
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
        <h1 className="fh-onb__title fh-font-serif" style={{ fontWeight: 400 }}>
          Set up<br />
          shop.
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
            <h2 className="fh-onb__section-title fh-font-serif" style={{ fontWeight: 400 }}>
              Your company.
            </h2>
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
            <h2 className="fh-onb__section-title fh-font-serif" style={{ fontWeight: 400 }}>
              What you run.
            </h2>
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
              {services.length} trade{services.length === 1 ? '' : 's'} picked
            </p>
          )}
        </section>

        <section className="fh-onb__section" style={{ animationDelay: '280ms' }}>
          <div className="fh-onb__section-head">
            <h2 className="fh-onb__section-title fh-font-serif" style={{ fontWeight: 400 }}>
              Lock your location.
            </h2>
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
                  {services.length === 1 ? 'Trade picked' : 'Trades picked'}
                </div>
                <div className="fh-counter__desc">Rate card + templates tuned to match</div>
              </div>
            </div>
            <button
              type="submit"
              className="fh-btn fh-btn--primary fh-onb__submit"
              disabled={!canSubmit || busy}
              title="Recommended — seeds demo clients, jobs, and a schedule so you can see the whole app working"
            >
              {busy ? 'Saving…' : 'Start with sample data'}
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
            <p className="fh-onb__meta" style={{ margin: 0 }}>
              Sample data shows you the whole app immediately. Wipe anytime in Settings.
            </p>
            <button
              type="button"
              onClick={() => finish({ withSeed: false })}
              disabled={!canSubmit || busy}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '4px 0',
                color: 'var(--ink-muted)',
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                cursor: (canSubmit && !busy) ? 'pointer' : 'default',
                opacity: (canSubmit && !busy) ? 1 : 0.5,
                textDecoration: 'underline',
                textUnderlineOffset: 3
              }}
            >
              Skip — start fresh
            </button>
          </div>
          <p className="fh-onb__meta" style={{ marginTop: 14 }}>
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
