import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/icons/Icon.jsx'
import LogoUploader from '../components/LogoUploader.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useProfile } from '../contexts/ProfileContext.jsx'
import { useTheme } from '../contexts/ThemeContext.jsx'

const SERVICES = ['Concrete', 'Framing', 'Roofing', 'Electrical', 'Plumbing', 'HVAC', 'Drywall', 'Paint', 'Flooring', 'Landscaping', 'Excavation', 'Remodel']

const CLEANUP_TABLES = [
  'fh_payments',
  'fh_inspections',
  'fh_subs',
  'fh_expenses',
  'fh_schedule',
  'fh_notes',
  'fh_mileage',
  'fh_contacts'
]

const DEV_BUILD = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV

export default function Settings() {
  const { user, signOut } = useAuth()
  const { profile, upsertProfile, refresh } = useProfile()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [companyName, setCompanyName] = useState(profile?.company_name || '')
  const [services, setServices] = useState(profile?.services || [])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [wiping, setWiping] = useState(false)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [wipeResult, setWipeResult] = useState('')

  const canWipe = DEV_BUILD || user?.email === 'test@test.com'

  async function wipeTestData() {
    if (!user) return
    setWiping(true)
    setWipeResult('')
    try {
      const counts = {}
      for (const table of CLEANUP_TABLES) {
        const { error, count } = await supabase
          .from(table)
          .delete({ count: 'exact' })
          .eq('user_id', user.id)
        if (error) throw new Error(`${table}: ${error.message}`)
        counts[table] = count ?? 0
      }
      const total = Object.values(counts).reduce((a, b) => a + b, 0)
      setWipeResult(`Cleared ${total} rows across ${CLEANUP_TABLES.length} tables.`)
      setConfirmWipe(false)
    } catch (e) {
      setWipeResult(`Wipe failed: ${e.message}`)
    } finally {
      setWiping(false)
      setTimeout(() => setWipeResult(''), 4000)
    }
  }

  useEffect(() => {
    setCompanyName(profile?.company_name || '')
    setServices(profile?.services || [])
  }, [profile])

  function toggleService(s) {
    setServices((arr) => arr.includes(s) ? arr.filter((x) => x !== s) : [...arr, s])
  }

  async function save() {
    setSaving(true)
    await upsertProfile({ company_name: companyName, services })
    refresh()
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 1600)
  }

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  async function pinLocation() {
    if (!('geolocation' in navigator)) return
    navigator.geolocation.getCurrentPosition(async (pos) => {
      await upsertProfile({ location_lat: pos.coords.latitude, location_lon: pos.coords.longitude })
      refresh()
    })
  }

  return (
    <section className="fh-page">
      <header className="fh-page__head">
        <div>
          <span className="fh-sec-tag">
            <span className="fh-sec-tag__label">Your rig</span>
          </span>
          <h1 className="fh-page__title">Settings</h1>
        </div>
      </header>

      <section className="fh-section">
        <div className="fh-section__head">
          <span className="fh-section__title">Brand</span>
        </div>
        <div className="fh-settings__row">
          <LogoUploader
            logoUrl={profile?.logo_url}
            companyName={profile?.company_name}
            onUpload={async (url) => { await upsertProfile({ logo_url: url }); refresh() }}
            size="lg"
          />
          <label className="fh-field" style={{ flex: 1 }}>
            <span className="fh-field__k">Company name</span>
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </label>
        </div>
      </section>

      <section className="fh-section">
        <div className="fh-section__head">
          <span className="fh-section__title">Services</span>
          <span className="fh-pill">{services.length} picked</span>
        </div>
        <div className="fh-chips">
          {SERVICES.map((s) => (
            <button key={s} type="button" className={`fh-chip${services.includes(s) ? ' is-active' : ''}`} onClick={() => toggleService(s)}>
              {s}
            </button>
          ))}
        </div>
      </section>

      <section className="fh-section">
        <div className="fh-section__head">
          <span className="fh-section__title">Market pin</span>
        </div>
        <div className="fh-settings__row">
          <div className="fh-meta">
            <span className="fh-meta__k">Lat</span>
            <span className="fh-meta__v">{profile?.location_lat ? profile.location_lat.toFixed(3) : '—'}</span>
          </div>
          <div className="fh-meta">
            <span className="fh-meta__k">Lon</span>
            <span className="fh-meta__v">{profile?.location_lon ? profile.location_lon.toFixed(3) : '—'}</span>
          </div>
          <button type="button" className="fh-btn fh-btn--ghost" onClick={pinLocation}>
            <Icon name="pin" size={16} />
            {profile?.location_lat ? 'Repin' : 'Pin location'}
          </button>
        </div>
      </section>

      <section className="fh-section">
        <div className="fh-section__head">
          <span className="fh-section__title">Appearance</span>
        </div>
        <label className={`fh-toggle${theme === 'dark' ? ' is-on' : ''}`} onClick={toggleTheme}>
          <span className="fh-toggle__rail" />
          <span className="fh-toggle__label">{theme === 'dark' ? 'Dark theme' : 'Light theme'}</span>
        </label>
      </section>

      <section className="fh-section">
        <div className="fh-section__head">
          <span className="fh-section__title">Account</span>
        </div>
        <div className="fh-rows">
          <div className="fh-row">
            <div style={{ flex: 1 }}>
              <div className="fh-row__k">{user?.email}</div>
              <div className="fh-row__sub">Signed in</div>
            </div>
            <button type="button" className="fh-btn fh-btn--danger" onClick={handleSignOut}>Sign out</button>
          </div>
        </div>
      </section>

      {canWipe && (
        <section className="fh-section" style={{ borderColor: 'rgba(192, 57, 43, 0.25)' }}>
          <div className="fh-section__head">
            <span className="fh-section__title">Dev · Cleanup</span>
            <span className="fh-status-pill fh-status-pill--red">{DEV_BUILD ? 'LOCAL' : 'TEST USER'}</span>
          </div>
          <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
            Deletes every contact, note, schedule item, sub, expense, inspection, payment, and mileage row owned by this user. RLS-scoped so it can only touch your own data.
          </p>
          {!confirmWipe ? (
            <button
              type="button"
              className="fh-btn fh-btn--danger"
              onClick={() => setConfirmWipe(true)}
              disabled={wiping}
            >
              <Icon name="trash" size={16} />
              Clear all my test data
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="fh-btn fh-btn--ghost"
                onClick={() => setConfirmWipe(false)}
                disabled={wiping}
              >
                Cancel
              </button>
              <button
                type="button"
                className="fh-btn fh-btn--danger"
                onClick={wipeTestData}
                disabled={wiping}
              >
                {wiping ? 'Clearing…' : 'Yes, delete everything'}
              </button>
            </div>
          )}
          {wipeResult && (
            <p style={{ margin: 0, color: wipeResult.startsWith('Wipe failed') ? 'var(--alert-red)' : 'var(--signal-green)', fontSize: '0.9rem' }}>
              {wipeResult}
            </p>
          )}
        </section>
      )}

      <div className="fh-settings__save">
        <button type="button" className="fh-btn fh-btn--gold" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
        </button>
      </div>
    </section>
  )
}
