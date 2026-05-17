import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { MapPin, Trash2, LogOut, Upload as UploadIcon } from 'lucide-react'
import BrandLogoPicker from '../components/BrandLogoPicker.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useProfile } from '../contexts/ProfileContext.jsx'
import { reverseGeocode } from '../lib/weather.js'
// useTheme import removed 5/17 with APPEARANCE section — restore alongside
// the toggle when full light-theme parity ships.
// import { useTheme } from '../contexts/ThemeContext.jsx'
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
  // const { theme, toggleTheme } = useTheme() // ← restore with APPEARANCE section
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState(profile?.full_name || '')
  const [companyName, setCompanyName] = useState(profile?.company_name || '')
  // Customer-facing branding fields (migration 015). Empty strings save
  // as null at submit time so downstream PDF code can use `is null`
  // checks without trim/null-trim ambiguity.
  const [companyPhone, setCompanyPhone] = useState(profile?.company_phone || '')
  const [companyEmail, setCompanyEmail] = useState(profile?.company_email || '')
  const [companyWebsite, setCompanyWebsite] = useState(profile?.company_website || '')
  const [companyAddress, setCompanyAddress] = useState(profile?.company_address || '')
  const [licenseNumber, setLicenseNumber] = useState(profile?.license_number || '')
  const [insuredText, setInsuredText] = useState(profile?.insured_text || '')
  const [warrantyDefault, setWarrantyDefault] = useState(profile?.warranty_default || '')
  // Dedupe on read — older onboarding flows wrote duplicates into
  // profile.services so the count shown ("24 picked") didn't match the
  // 12 visible chips. We persist the deduped version on next save.
  const [services, setServices] = useState(() => {
    const arr = profile?.services || []
    return Array.from(new Set(arr.map((s) => String(s || '').trim()).filter(Boolean)))
  })
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
    setCompanyPhone(profile?.company_phone || '')
    setCompanyEmail(profile?.company_email || '')
    setCompanyWebsite(profile?.company_website || '')
    setCompanyAddress(profile?.company_address || '')
    setLicenseNumber(profile?.license_number || '')
    setInsuredText(profile?.insured_text || '')
    setWarrantyDefault(profile?.warranty_default || '')
    setServices(Array.from(new Set((profile?.services || []).map((s) => String(s || '').trim()).filter(Boolean))))
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
    // Empty strings -> null so downstream PDF code can rely on `is null`
    // checks. company_name keeps its existing trim-and-pass behavior so
    // legacy callers (Invoices, Quote PDF) continue reading a non-null
    // string even if the operator clears the input briefly.
    const nullIfBlank = (s) => {
      const t = (s || '').trim()
      return t.length === 0 ? null : t
    }
    await upsertProfile({
      company_name: companyName,
      company_phone: nullIfBlank(companyPhone),
      company_email: nullIfBlank(companyEmail),
      company_website: nullIfBlank(companyWebsite),
      company_address: nullIfBlank(companyAddress),
      license_number: nullIfBlank(licenseNumber),
      insured_text: nullIfBlank(insuredText),
      warranty_default: nullIfBlank(warrantyDefault),
      services
    })
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

  // Reverse-geocode the saved coords so the Settings location card
  // surfaces "Murfreesboro, TN" instead of the raw 35.838 / -86.470
  // figures the 5/13 audit flagged. Helper lives in lib/weather.js
  // (used by Forecast page already) with a per-coord cache so the
  // fetch only fires once per coord pair per session.
  const [locationLabel, setLocationLabel] = useState('')
  useEffect(() => {
    let cancelled = false
    const lat = profile?.location_lat
    const lon = profile?.location_lon
    if (lat == null || lon == null) { setLocationLabel(''); return }
    reverseGeocode(lat, lon).then((label) => {
      if (!cancelled && label) setLocationLabel(label)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [profile?.location_lat, profile?.location_lon])

  const { stagger, item } = useFhMotion()

  return (
    <motion.div className="fh-screen" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: 120, position: 'relative' }}>
      {/* HEADER */}
      <motion.div variants={item} style={{ padding: '10px 20px 14px' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
          Profile
        </span>
        <h1 style={{ margin: '4px 0 0', fontSize: 'clamp(22px, 6vw, 30px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 600, color: 'var(--ink-strong)' }}>
          Your business,{' '}
          organized.
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

      {/* CUSTOMER-FACING DETAILS — Phase 4D-2A. Branding data the
          contractor's clients see on quotes, invoices, and approval
          certificates. Saved together via the bottom Save Changes bar. */}
      <Section
        variants={item}
        title={<>Customer-facing <em>details.</em></>}
        sub="These details strengthen your proposals, invoices, and approvals when filled in. Only company name is needed to get started — everything else is optional and can be added anytime."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <BrandField label="Company phone">
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={companyPhone}
              onChange={(e) => setCompanyPhone(e.target.value)}
              placeholder="(555) 555-0100"
              style={brandInputStyle}
            />
          </BrandField>

          <BrandField label="Company email">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={companyEmail}
              onChange={(e) => setCompanyEmail(e.target.value)}
              placeholder="hello@yourcompany.com"
              style={brandInputStyle}
            />
          </BrandField>

          <BrandField label="Company website" optional>
            <input
              type="url"
              inputMode="url"
              autoComplete="url"
              value={companyWebsite}
              onChange={(e) => setCompanyWebsite(e.target.value)}
              placeholder="yourcompany.com"
              style={brandInputStyle}
            />
          </BrandField>

          <BrandField label="Company address" optional hint="One line or several — used on cover pages.">
            <textarea
              rows={2}
              value={companyAddress}
              onChange={(e) => setCompanyAddress(e.target.value)}
              placeholder="1234 Main St · Murfreesboro, TN 37130"
              style={{ ...brandInputStyle, resize: 'vertical', lineHeight: 1.45 }}
            />
          </BrandField>

          <BrandField label="License number" optional>
            <input
              type="text"
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              placeholder="GC-12345"
              style={brandInputStyle}
            />
          </BrandField>

          <BrandField label="Insurance / insured text" optional hint="Short line shown in proposal trust block.">
            <input
              type="text"
              value={insuredText}
              onChange={(e) => setInsuredText(e.target.value)}
              placeholder="Insured · $2M general liability"
              style={brandInputStyle}
            />
          </BrandField>

          <BrandField label="Default warranty text" optional hint="Default workmanship warranty paragraph for new proposals.">
            <textarea
              rows={3}
              value={warrantyDefault}
              onChange={(e) => setWarrantyDefault(e.target.value)}
              placeholder="One-year workmanship warranty on all installed labor. Manufacturer warranties pass through to the customer."
              style={{ ...brandInputStyle, resize: 'vertical', lineHeight: 1.45 }}
            />
          </BrandField>
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

      {/* MARKET PIN — 5/17 audit fix: surface the city name reverse-geocoded
          from the saved coords ("Murfreesboro, TN") instead of the raw
          LAT/LON pair the audit called out as unfriendly. Raw coords stay
          available as muted secondary text so the operator can still
          eyeball precision when needed. */}
      <Section variants={item} title={<>Where you <em>work.</em></>}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{
            flex: 1,
            minWidth: 180,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: '10px 14px',
            borderRadius: 12,
            background: 'var(--surface-2)',
            border: '1px solid var(--rule)'
          }}>
            <span style={{
              fontFamily: 'var(--font-body)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--ink-muted)'
            }}>
              Service area
            </span>
            <span style={{
              fontFamily: 'var(--font-body)',
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--ink-strong)',
              lineHeight: 1.2
            }}>
              {profile?.location_lat
                ? (locationLabel || 'Locating…')
                : 'Not pinned'}
            </span>
            {profile?.location_lat && (
              <span style={{
                fontFamily: 'var(--font-body)',
                fontSize: 10,
                color: 'var(--ink-faint)',
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '0.02em'
              }}>
                {profile.location_lat.toFixed(3)}, {profile.location_lon?.toFixed(3) || '—'}
              </span>
            )}
          </div>
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

      {/* APPEARANCE section hidden 5/17 — light-theme parity is incomplete
          (only repaints cards, leaves sidebar + canvas dark per the 5/13
          audit). Audit recommendation was "either ship full light-mode
          support or hide the toggle until parity exists." Restoring this
          section is the right move once full parity ships. Original block:
            <Section title={<>Light or <em>dark.</em></>}>
              <Switch checked={theme === 'dark'} onCheckedChange={toggleTheme}/>
              ...
            </Section>
       */}

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

      {/* SAVE BAR — fixed strip above the bottom nav. position:sticky
          previously didn't actually stick because its containing block
          was the page (not a scroll container with overflow). position:
          fixed against the viewport works. Sits 96 px above the bottom
          edge (= bottom nav height) so it never overlaps the nav. */}
      <div
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 'calc(96px + env(safe-area-inset-bottom, 0px))',
          zIndex: 'calc(var(--z-nav, 40) - 1)',
          padding: '12px 20px',
          display: 'flex',
          justifyContent: 'flex-end',
          background: 'linear-gradient(180deg, rgba(20,20,20,0) 0%, rgba(20,20,20,0.88) 35%, rgba(20,20,20,0.96) 100%)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          pointerEvents: 'none'
        }}
      >
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={save} className="fh-press-instant"
          disabled={saving}
          style={{
            pointerEvents: 'auto',
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
      </div>
    </motion.div>
  )
}

function Section({ variants, title, sub, meta, metaTone, children }) {
  const metaBg = metaTone === 'red'
    ? { background: 'var(--v3-danger-soft)', border: '1px solid color-mix(in srgb, var(--v3-danger) 40%, transparent)', color: 'var(--v3-danger-bright)' }
    : { background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border-strong)', color: 'var(--v3-text-muted)' }
  return (
    <motion.section
      variants={variants}
      className="v3-section"
      style={{ margin: '0 var(--v3-gutter) 14px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: sub ? 4 : 10, gap: 10 }}>
        <h2
          style={{ margin: 0, fontSize: 18, lineHeight: 1.15, letterSpacing: '-0.01em', fontWeight: 600, color: 'var(--v3-text)' }}
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
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.45 }}>
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

function BrandField({ label, hint, optional, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--ink-muted)'
        }}>
          {label}
        </span>
        {optional && (
          <span style={{
            display: 'inline-flex', alignItems: 'center',
            padding: '1px 7px', borderRadius: 999,
            background: 'var(--surface-2)', border: '1px solid var(--rule)',
            fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: 'var(--ink-faint, var(--ink-muted))',
            fontFamily: 'var(--font-body)'
          }}>
            Optional
          </span>
        )}
      </span>
      {children}
      {hint && (
        <span style={{
          fontSize: 11, color: 'var(--ink-faint, var(--ink-muted))',
          fontFamily: 'var(--font-body)', lineHeight: 1.4
        }}>
          {hint}
        </span>
      )}
    </label>
  )
}

const brandInputStyle = {
  padding: '11px 14px',
  borderRadius: 12,
  background: 'var(--surface-2)',
  border: '1px solid var(--rule)',
  color: 'var(--ink-strong)',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box'
}
