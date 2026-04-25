import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { MapPin, Trash2, LogOut, Upload as UploadIcon } from 'lucide-react'
import BrandLogoPicker from '../components/BrandLogoPicker.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useProfile } from '../contexts/ProfileContext.jsx'
import { useTheme } from '../contexts/ThemeContext.jsx'
import { toastSuccess } from '../lib/toast.js'
import { hapticMedium, hapticSuccess } from '../lib/haptics.js'
import { useFhMotion } from '../lib/motion.js'
import { Switch } from '@/components/ui/switch'

const SERVICES = ['Concrete', 'Framing', 'Roofing', 'Electrical', 'Plumbing', 'HVAC', 'Drywall', 'Paint', 'Tile', 'Landscaping', 'Excavation', 'Insulation']

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
  const [displayName, setDisplayName] = useState(profile?.full_name || '')
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
      toastSuccess(`Cleared ${total} rows`, 'All test data wiped')
      setConfirmWipe(false)
    } catch (e) {
      setWipeResult(`Wipe failed: ${e.message}`)
    } finally {
      setWiping(false)
      setTimeout(() => setWipeResult(''), 4000)
    }
  }

  useEffect(() => {
    setDisplayName(profile?.full_name || '')
    setCompanyName(profile?.company_name || '')
    setServices(profile?.services || [])
  }, [profile])

  async function saveDisplayName() {
    const next = displayName.trim()
    if (next === (profile?.full_name || '')) return
    await upsertProfile({ full_name: next || null })
    refresh()
  }

  function toggleService(s) {
    setServices((arr) => arr.includes(s) ? arr.filter((x) => x !== s) : [...arr, s])
  }

  async function save() {
    setSaving(true)
    await upsertProfile({ company_name: companyName, services })
    refresh()
    setSaving(false)
    setSaved(true)
    hapticSuccess()
    toastSuccess('Saved', 'Settings updated')
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

  const { stagger, item } = useFhMotion()

  return (
    <motion.div className="fh-screen" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: 120, position: 'relative' }}>
      {/* HEADER */}
      <motion.div variants={item} style={{ padding: '10px 20px 14px' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
          Profile
        </span>
        <h1 className="fh-font-serif" style={{ margin: '4px 0 0', fontSize: 'clamp(22px, 6vw, 30px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}>
          Run your{' '}
          operation.
        </h1>
      </motion.div>

      {/* BRAND */}
      <Section variants={item} title={<>Your <em>brand.</em></>} sub="Make Fieldhorse feel like your app.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>Display name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onBlur={saveDisplayName}
              placeholder="First name or full name"
              style={{ padding: '11px 14px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 14, outline: 'none' }}
            />
            <span style={{ fontSize: 11, color: 'var(--ink-faint)', fontFamily: 'var(--font-body)' }}>Shown on the greeting and avatar initials.</span>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>Company name</span>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Your company"
              style={{ padding: '11px 14px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 14, outline: 'none' }}
            />
          </label>

          <BrandLogoPicker
            logoUrl={profile?.logo_url}
            companyName={profile?.company_name}
            fullName={profile?.full_name}
            onSaved={async (url) => {
              await upsertProfile({ logo_url: url, logo_uploaded_at: new Date().toISOString() })
              refresh()
            }}
            onRemoved={async () => {
              await upsertProfile({ logo_url: null, logo_uploaded_at: null })
              refresh()
            }}
          />
        </div>
      </Section>

      {/* SERVICES */}
      <Section variants={item} title={<>What you <em>do.</em></>} meta={`${services.length} picked`}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {SERVICES.map((s) => {
            const isOn = services.includes(s)
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleService(s)}
                style={{
                  padding: '7px 12px',
                  borderRadius: 999,
                  border: isOn ? '1px solid rgba(201,150,58,0.4)' : '1px solid var(--rule)',
                  background: isOn ? 'rgba(201,150,58,0.14)' : 'var(--surface-2)',
                  color: isOn ? 'var(--field-gold-bright)' : 'var(--ink-muted)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 160ms ease'
                }}
              >
                {s}
              </button>
            )
          })}
        </div>
      </Section>

      {/* MARKET PIN */}
      <Section variants={item} title={<>Where you <em>work.</em></>}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Meta label="Lat" value={profile?.location_lat ? profile.location_lat.toFixed(3) : '—'} />
          <Meta label="Lon" value={profile?.location_lon ? profile.location_lon.toFixed(3) : '—'} />
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={pinLocation}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 12, background: 'rgba(201,150,58,0.08)', border: '1px solid rgba(201,150,58,0.25)', color: 'var(--field-gold-bright)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            <MapPin size={16} />
            {profile?.location_lat ? 'Repin' : 'Pin location'}
          </motion.button>
        </div>
      </Section>

      {/* APPEARANCE */}
      <Section variants={item} title={<>Light or <em>dark.</em></>}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
          <Switch
            checked={theme === 'dark'}
            onCheckedChange={() => toggleTheme()}
            aria-label="Toggle dark theme"
          />
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-strong)' }}>
            {theme === 'dark' ? 'Dark theme' : 'Light theme'}
          </span>
        </div>
      </Section>

      {/* ACCOUNT */}
      <Section variants={item} title={<>Your <em>session.</em></>}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--rule)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--ink-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.email}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>Signed in</div>
          </div>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={handleSignOut} className="fh-press-instant"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 10, background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.35)', color: 'var(--alert-red)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            <LogOut size={14} />
            Sign out
          </motion.button>
        </div>
      </Section>

      {/* DEV · CLEANUP */}
      {canWipe && (
        <Section
          variants={item}
          title={<>Reset <em>everything.</em></>}
          meta={DEV_BUILD ? 'LOCAL' : 'TEST USER'}
          metaTone="red"
        >
          <p style={{ margin: 0, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', fontSize: 12 }}>
            Deletes every contact, note, schedule item, sub, expense, inspection, payment, and mileage row owned by this user. RLS-scoped so it can only touch your own data.
          </p>
          <div style={{ marginTop: 10 }}>
            {!confirmWipe ? (
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={() => setConfirmWipe(true)} className="fh-press-instant"
                disabled={wiping}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 12, background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.35)', color: 'var(--alert-red)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >
                <Trash2 size={14} />
                Clear all my test data
              </motion.button>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setConfirmWipe(false)}
                  disabled={wiping}
                  style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.97 }}
                  onClick={wipeTestData}
                  disabled={wiping}
                  style={{ padding: '10px 14px', borderRadius: 12, background: 'linear-gradient(135deg, #c0392b, #8b1a0d)', border: 'none', color: 'var(--raw-linen)', fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: '0.1em', cursor: 'pointer', boxShadow: '0 6px 16px rgba(192,57,43,0.4)' }}
                >
                  {wiping ? 'CLEARING…' : 'YES, DELETE EVERYTHING'}
                </motion.button>
              </div>
            )}
            {wipeResult && (
              <p style={{ margin: '10px 0 0', color: wipeResult.startsWith('Wipe failed') ? 'var(--alert-red)' : 'var(--signal-green)', fontSize: 12, fontFamily: 'var(--font-body)' }}>
                {wipeResult}
              </p>
            )}
          </div>
        </Section>
      )}

      {/* SAVE BAR */}
      <motion.div variants={item} style={{ padding: '0 20px 10px', display: 'flex', justifyContent: 'flex-end' }}>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={save} className="fh-press-instant"
          disabled={saving}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 22px',
            borderRadius: 12,
            background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
            color: 'var(--onyx)',
            fontFamily: 'var(--font-display)',
            fontSize: 15,
            letterSpacing: '0.14em',
            border: 'none',
            cursor: saving ? 'default' : 'pointer',
            boxShadow: '0 8px 20px rgba(201,150,58,0.35)',
            opacity: saving ? 0.65 : 1
          }}
        >
          <UploadIcon size={16} />
          {saving ? 'SAVING…' : saved ? 'SAVED' : 'SAVE CHANGES'}
        </motion.button>
      </motion.div>
    </motion.div>
  )
}

function Section({ variants, title, sub, meta, metaTone, children }) {
  const metaBg = metaTone === 'red'
    ? { background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.35)', color: 'var(--alert-red)' }
    : { background: 'var(--surface-2)', border: '1px solid var(--rule)', color: 'var(--ink-muted)' }
  return (
    <motion.section variants={variants} style={{ padding: '0 20px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: sub ? 4 : 10, gap: 10 }}>
        <h2
          className="fh-font-serif"
          style={{ margin: 0, fontSize: 20, lineHeight: 1.15, letterSpacing: '-0.01em', fontWeight: 400, color: 'var(--ink-strong)' }}
        >
          {renderSectionTitle(title)}
        </h2>
        {meta && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '3px 9px',
              borderRadius: 999,
              fontFamily: 'var(--font-body)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              ...metaBg
            }}
          >
            {meta}
          </span>
        )}
      </div>
      {sub && (
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.45 }}>
          {sub}
        </p>
      )}
      {children}
    </motion.section>
  )
}

function renderSectionTitle(node) {
  // node is a React fragment with <em> around the accent word.
  // Wrap the <em> in a span with the italic gradient class so the rendered word is gold-italic.
  if (node && node.props && Array.isArray(node.props.children)) {
    return node.props.children.map((child, i) => {
      if (child && child.type === 'em') {
        return <span key={i}>{child.props.children}</span>
      }
      return child
    })
  }
  return node
}

function Meta({ label, value }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)', minWidth: 80 }}>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, letterSpacing: '0.02em', color: 'var(--ink-strong)' }}>{value}</span>
    </div>
  )
}
