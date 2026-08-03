import { lazy, Suspense, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { MapPin, Trash2, LogOut, Upload as UploadIcon, Bell, SunMedium, CalendarClock } from 'lucide-react'
import BrandLogoPicker from '../components/BrandLogoPicker.tsx'
import RateCardEditor from '../components/settings/RateCardEditor.tsx'
const SnowSettingsBuild = lazy(() => import('../components/desktop/SnowSettingsBuild.tsx'))
import { useIsDesktop } from '../lib/useMediaQuery.ts'
import { supabase } from '../lib/supabase.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useProfile } from '../contexts/ProfileContext.tsx'
import { reverseGeocode } from '../lib/weather.ts'
import { useTheme } from '../contexts/ThemeContext.tsx'
import { toastSuccess, toastError } from '../lib/toast.ts'
import { pushSupport, pushEnabled, enablePush, disablePush } from '../lib/push.ts'
import { safePayUrl } from '../lib/payLink.ts'
import { hapticMedium, hapticSuccess } from '../lib/haptics.ts'
import { useFhMotion } from '../lib/motion.ts'
import { Switch } from '@/components/ui/switch'
import { Eyebrow } from '../components/v3'
import {
  mergeQuoteFollowUpPreferences,
  QUOTE_FOLLOW_UP_DAY_OPTIONS,
  readQuoteFollowUpPreferences,
} from '../lib/quoteFollowUp.ts'

const SERVICES = ['Concrete', 'Framing', 'Roofing', 'Electrical', 'Plumbing', 'HVAC', 'Drywall', 'Paint', 'Tile', 'Landscaping', 'Excavation', 'Insulation']

// Child tables the demo seed writes keyed by contact_id, deleted first
// (scoped to the demo contact ids) before the contacts, in case a child FK
// isn't ON DELETE CASCADE. Mirrors what seedDemoData() inserts.
// Each child table plus the column that foreign-keys back to the demo
// contact. Most use `contact_id`; fh_job_todos keys on `job_id` (its FK
// column name, see migration 006). Using the wrong column silently
// deletes nothing and, since we only read { count }, swallows the
// "column does not exist" error.
const DEMO_CHILD_TABLES: { table: string; fk: string }[] = [
  { table: 'fh_expenses',  fk: 'contact_id' },
  { table: 'fh_schedule',  fk: 'contact_id' },
  { table: 'fh_notes',     fk: 'contact_id' },
  { table: 'fh_job_todos', fk: 'job_id' }
]

export default function Settings() {
  const { user, signOut } = useAuth()
  const { profile, upsertProfile, refresh } = useProfile()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState(profile?.full_name || '')
  const [companyName, setCompanyName] = useState(profile?.company_name || '')
  // Customer facing branding fields (migration 015). Empty strings save
  // as null at submit time so downstream PDF code can use `is null`
  // checks without trim/null-trim ambiguity.
  const [companyPhone, setCompanyPhone] = useState(profile?.company_phone || '')
  const [companyEmail, setCompanyEmail] = useState(profile?.company_email || '')
  const [companyWebsite, setCompanyWebsite] = useState(profile?.company_website || '')
  const [companyAddress, setCompanyAddress] = useState(profile?.company_address || '')
  const [licenseNumber, setLicenseNumber] = useState(profile?.license_number || '')
  const [insuredText, setInsuredText] = useState(profile?.insured_text || '')
  const [warrantyDefault, setWarrantyDefault] = useState(profile?.warranty_default || '')
  // Bring-your-own pay link (Venmo / Zelle / Square / a Stripe Payment
  // Link the contractor created themselves), renders as a "Pay now"
  // button on invoices, statements, and the customer facing pages.
  const [paymentLink, setPaymentLink] = useState((profile as any)?.payment_link || '')
  const [paymentInstructions, setPaymentInstructions] = useState((profile as any)?.payment_instructions || '')
  // Brand accent hex (validated #RRGGBB by migration 015's CHECK
  // constraint). Drives every gold accent on the customer-visible
  // surfaces, top rule on each PDF, status pills, eyebrows, hero
  // money numbers. Empty → save as null → downstream pdf.js +
  // template tokens fall back to the system default (#C9963A).
  const [brandAccentHex, setBrandAccentHex] = useState(profile?.brand_accent_hex || '')
  // Estimate/proposal design (migration 031). One default per company;
  // drives the HTML preview, the public client page, and the PDF export.
  const [estimateTemplate, setEstimateTemplate] = useState((profile as any)?.estimate_template || 'classic')
  const [quoteFollowUpEnabled, setQuoteFollowUpEnabled] = useState(
    () => readQuoteFollowUpPreferences(profile?.preferences).enabled,
  )
  const [quoteFollowUpDays, setQuoteFollowUpDays] = useState(
    () => readQuoteFollowUpPreferences(profile?.preferences).days,
  )
  // Dedupe + canonicalize on read. Older onboarding flows wrote both
  // duplicates AND ghost entries (typos, deprecated names like
  // "Painters" / "Drywaller") into profile.services. The chip
  // renderer iterates the canonical SERVICES list so ghost entries
  // never render as chips, but the counter used to read the raw
  // length, producing the audit's "24 picked but only 12 chips"
  // discrepancy. We now also intersect with SERVICES so the count
  // matches what the user can actually see. Persists on next save.
  const [services, setServices] = useState(() => {
    const arr = profile?.services || []
    const canonical = new Set(SERVICES)
    return Array.from(new Set(
      arr.map((s) => String(s || '').trim()).filter((s) => s && canonical.has(s))
    ))
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [wiping, setWiping] = useState(false)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [wipeResult, setWipeResult] = useState('')

  // Available to everyone (onboarding promises "wipe anytime"). Scoped to
  // demo-seeded rows only (source = 'demo'), so it can never touch real
  // work, safe to expose without the old dev-only gate.
  const canWipe = true

  async function wipeTestData() {
    if (!user) return
    setWiping(true)
    setWipeResult('')
    try {
      // Resolve the demo contacts, delete their children explicitly (in case
      // a child FK isn't ON DELETE CASCADE), then the contacts, then the
      // demo clients. Everything is scoped to source='demo' + this user.
      const { data: demoContacts, error: dcErr } = await supabase
        .from('fh_contacts')
        .select('id')
        .eq('user_id', user.id)
        .eq('source' as any, 'demo')
      if (dcErr) throw new Error(dcErr.message)
      const ids = (demoContacts || []).map((c: any) => c.id)

      let total = 0
      if (ids.length) {
        for (const { table, fk } of DEMO_CHILD_TABLES) {
          const { error: childErr, count } = await supabase
            .from(table as any)
            .delete({ count: 'exact' })
            .eq('user_id', user.id)
            .in(fk, ids)
          // Surface a real failure instead of quietly under-counting.
          if (childErr) throw new Error(`${table}: ${childErr.message}`)
          total += count ?? 0
        }
        const { error: cErr, count: cCount } = await supabase
          .from('fh_contacts')
          .delete({ count: 'exact' })
          .eq('user_id', user.id)
          .in('id', ids)
        if (cErr) throw new Error(cErr.message)
        total += cCount ?? 0
      }

      const { error: clErr, count: clCount } = await supabase
        .from('fh_clients')
        .delete({ count: 'exact' })
        .eq('user_id', user.id)
        .eq('source' as any, 'demo')
      if (clErr) throw new Error(clErr.message)
      total += clCount ?? 0

      setWipeResult(total > 0 ? `Removed ${total} sample rows.` : 'No sample data to remove.')
      toastSuccess('Sample data removed', total > 0 ? `${total} demo rows cleared` : 'Nothing to remove')
      setConfirmWipe(false)
    } catch (e: any) {
      setWipeResult(`Couldn't remove sample data: ${e.message}`)
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
    setPaymentLink((profile as any)?.payment_link || '')
    setPaymentInstructions((profile as any)?.payment_instructions || '')
    setBrandAccentHex(profile?.brand_accent_hex || '')
    setEstimateTemplate((profile as any)?.estimate_template || 'classic')
    const quoteFollowUp = readQuoteFollowUpPreferences(profile?.preferences)
    setQuoteFollowUpEnabled(quoteFollowUp.enabled)
    setQuoteFollowUpDays(quoteFollowUp.days)
    setServices(() => {
      const canonical = new Set(SERVICES)
      return Array.from(new Set(
        (profile?.services || []).map((s) => String(s || '').trim()).filter((s) => s && canonical.has(s))
      ))
    })
  }, [profile])

  const profileQuoteFollowUp = readQuoteFollowUpPreferences(profile?.preferences)
  const profileServices = Array.from(new Set(
    (profile?.services || [])
      .map((service) => String(service || '').trim())
      .filter((service) => service && SERVICES.includes(service))
  )).sort()
  const hasUnsavedChanges = Boolean(profile) && (
    displayName !== (profile?.full_name || '') ||
    companyName !== (profile?.company_name || '') ||
    companyPhone !== (profile?.company_phone || '') ||
    companyEmail !== (profile?.company_email || '') ||
    companyWebsite !== (profile?.company_website || '') ||
    companyAddress !== (profile?.company_address || '') ||
    licenseNumber !== (profile?.license_number || '') ||
    insuredText !== (profile?.insured_text || '') ||
    warrantyDefault !== (profile?.warranty_default || '') ||
    paymentLink !== ((profile as any)?.payment_link || '') ||
    paymentInstructions !== ((profile as any)?.payment_instructions || '') ||
    brandAccentHex.toLowerCase() !== (profile?.brand_accent_hex || '').toLowerCase() ||
    estimateTemplate !== ((profile as any)?.estimate_template || 'classic') ||
    quoteFollowUpEnabled !== profileQuoteFollowUp.enabled ||
    quoteFollowUpDays !== profileQuoteFollowUp.days ||
    JSON.stringify([...services].sort()) !== JSON.stringify(profileServices)
  )

  async function saveDisplayName() {
    const next = displayName.trim()
    if (next === (profile?.full_name || '')) return
    await upsertProfile({ full_name: next || null })
    refresh()
  }

  function toggleService(s: any) {
    setServices((arr) => arr.includes(s) ? arr.filter((x) => x !== s) : [...arr, s])
  }

  async function save() {
    setSaving(true)
    // Empty strings -> null so downstream PDF code can rely on `is null`
    // checks. company_name keeps its existing trim-and-pass behavior so
    // legacy callers (Invoices, Quote PDF) continue reading a non-null
    // string even if the operator clears the input briefly.
    const nullIfBlank = (s: any) => {
      const t = (s || '').trim()
      return t.length === 0 ? null : t
    }
    // Pay links pasted from an app often drop the scheme ("venmo.com/…").
    // Prepend https:// so the stored value is a real clickable URL :
    // unless it's already a deep-link scheme (venmo://, etc.).
    // safePayUrl (shared) allow-lists the scheme so a dangerous link
    // (javascript:, data:, …) is never stored and later rendered as an
    // href on a customer facing page.
    // Validate brand accent before save. Migration 015's CHECK
    // constraint will reject anything off-format with an opaque
    // Postgres error; catching it here lets us surface a friendly
    // toast instead.
    const rawAccent = (brandAccentHex || '').trim()
    let safeAccent = null
    if (rawAccent) {
      if (!/^#[0-9a-fA-F]{6}$/.test(rawAccent)) {
        toastError(
          'Brand color must be a #RRGGBB hex',
          `"${rawAccent}" doesn't look like a 6-digit hex (e.g. #C9963A). Settings not saved.`
        )
        setSaving(false)
        return
      }
      safeAccent = rawAccent.toLowerCase()
    }

    const { error } = await upsertProfile({
      full_name: nullIfBlank(displayName),
      company_name: companyName,
      company_phone: nullIfBlank(companyPhone),
      company_email: nullIfBlank(companyEmail),
      company_website: nullIfBlank(companyWebsite),
      company_address: nullIfBlank(companyAddress),
      license_number: nullIfBlank(licenseNumber),
      insured_text: nullIfBlank(insuredText),
      warranty_default: nullIfBlank(warrantyDefault),
      payment_link: nullIfBlank(safePayUrl(paymentLink)),
      payment_instructions: nullIfBlank(paymentInstructions),
      brand_accent_hex: safeAccent,
      estimate_template: estimateTemplate || 'classic',
      preferences: mergeQuoteFollowUpPreferences(profile?.preferences, {
        enabled: quoteFollowUpEnabled,
        days: quoteFollowUpDays,
      }),
      services
    })
    if (error) {
      setSaving(false)
      toastError("Couldn't save settings", error.message || 'Try again in a moment.')
      return
    }
    await refresh()
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
  // figures the 5/13 audit flagged. Helper lives in lib/weather.ts
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
  const isDesktop = useIsDesktop()

  // Sidebar "Templates" item routes to /settings#templates and the
  // anchor lives on the Estimate-template picker further down the
  // page. Honor the hash on first paint + on later hash changes.
  //
  // Audit M1 (Jun 10): the single 50ms timeout missed because the
  // template list above the anchor loads async, at 50ms the element
  // exists, scrollIntoView lands, but more layout shifts in below
  // and the user ends up back at top. Retry at 50/250/600/1200ms
  // and treat the page as scrolled once scrollY > 0, so settling
  // layout doesn't undo the jump. Also listen for popstate since
  // React Router's programmatic navigate uses pushState (which does
  // NOT fire hashchange), the prior code only re-fired the jump on
  // a real <a> click between hash routes.
  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false
    let timer: number | undefined
    // Verify-and-retry until the anchor exists AND the jump actually
    // landed. Fixed-schedule timers (50/250/600/1200ms) missed on cold
    // loads because the desktop body is a lazy chunk
    // (SnowSettingsBuild) + a profile fetch, the #templates anchor
    // wasn't in the DOM until after the last retry (Jun 10 spot-check:
    // scrollY pinned at 0 with the anchor at 1944px). behavior:'auto'
    // (instant) so the landing check isn't racing a smooth animation.
    function attemptScroll(deadline: number) {
      if (cancelled) return
      const hash = window.location.hash
      if (!hash) return
      const el = document.getElementById(hash.slice(1))
      if (el) {
        el.scrollIntoView({ behavior: 'auto', block: 'start' })
        const top = el.getBoundingClientRect().top
        if (top >= -8 && top < 240) return // landed, stop retrying
      }
      if (Date.now() < deadline) {
        timer = window.setTimeout(() => attemptScroll(deadline), 250)
      }
    }
    function jumpToHash() {
      if (timer) window.clearTimeout(timer)
      attemptScroll(Date.now() + 8000)
    }
    jumpToHash()
    window.addEventListener('hashchange', jumpToHash)
    window.addEventListener('popstate', jumpToHash)
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
      window.removeEventListener('hashchange', jumpToHash)
      window.removeEventListener('popstate', jumpToHash)
    }
  }, [])

  // Real, honest "setup readiness" calculation, only counts fields
  // that actually map to columns the profile screen exposes. No fake
  // weight to inflate the percentage.
  const profileChecks = [
    { key: 'companyName', filled: !!(companyName && companyName.trim()), label: 'Company name' },
    { key: 'companyPhone', filled: !!(companyPhone && companyPhone.trim()), label: 'Company phone' },
    { key: 'companyEmail', filled: !!(companyEmail && companyEmail.trim()), label: 'Company email' },
    { key: 'companyAddress', filled: !!(companyAddress && companyAddress.trim()), label: 'Company address' },
    { key: 'licenseNumber', filled: !!(licenseNumber && licenseNumber.trim()), label: 'License number' },
    { key: 'logo', filled: !!profile?.logo_url, label: 'Brand logo' },
    { key: 'services', filled: services.length > 0, label: 'Services configured' },
    { key: 'location', filled: !!(profile?.location_lat && profile?.location_lon), label: 'Pin business location' },
  ]
  const filledCount = profileChecks.filter((c) => c.filled).length
  const profileCompletePct = Math.round((filledCount / profileChecks.length) * 100)
  const missingItems = profileChecks.filter((c) => !c.filled).map((c) => c.label)
  const brandReady = !!profile?.logo_url || !!(brandAccentHex && brandAccentHex.trim())
  const hasLogo = !!profile?.logo_url
  const hasLocation = !!(profile?.location_lat && profile?.location_lon)

  const sections = (
    <>

      {/* BRAND */}
      <Section variants={item} title={<>Your <em>brand.</em></>} sub="Make Fieldhorse feel like your app.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Eyebrow style={{ color: 'var(--ink-muted)' }}>Display name</Eyebrow>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onBlur={saveDisplayName}
              placeholder="First name or full name"
              style={{ padding: '12px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 14, outline: 'none' }}
            />
            <span style={{ fontSize: 12, color: 'var(--ink-faint)', fontFamily: 'var(--font-body)' }}>Shown on the greeting and avatar initials.</span>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Eyebrow style={{ color: 'var(--ink-muted)' }}>Company name</Eyebrow>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Your company"
              style={{ padding: '12px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 14, outline: 'none' }}
            />
          </label>

          <BrandLogoPicker
            logoUrl={profile?.logo_url}
            companyName={profile?.company_name}
            fullName={profile?.full_name}
            onSaved={async (url: any) => {
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

      {/* CUSTOMER-FACING DETAILS, Phase 4D-2A. Branding data the
          contractor's clients see on quotes, invoices, and approval
          certificates. Saved together via the bottom Save Changes bar. */}
      <Section
        variants={item}
        title={<>Customer facing <em>details.</em></>}
        sub="These details strengthen your proposals, invoices, and approvals when filled in. Only company name is needed to get started, everything else is optional and can be added anytime."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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

          <BrandField label="Company address" optional hint="One line or several, used on cover pages.">
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
              placeholder="One year workmanship warranty on all installed labor. Manufacturer warranties pass through to the customer."
              style={{ ...brandInputStyle, resize: 'vertical', lineHeight: 1.45 }}
            />
          </BrandField>

          <BrandField
            label="Brand accent color"
            optional
            hint="The accent color on your customer documents, proposals, invoices, and statements. Leave blank to use the default."
          >
            <BrandColorEditor
              value={brandAccentHex}
              onChange={setBrandAccentHex}
              companyName={companyName}
            />
          </BrandField>

          <div id="templates" style={{ scrollMarginTop: 96 }}>
            <BrandField
              label="Estimate template"
              hint="The design used for every estimate you preview, share, or send. Your logo and details fill in automatically."
            >
              <EstimateTemplatePicker value={estimateTemplate} onChange={setEstimateTemplate} />
            </BrandField>
          </div>
        </div>
      </Section>

      <Section variants={item} title={<>Quote <em>follow ups.</em></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            padding: '12px 12px', borderRadius: 10,
            background: 'var(--surface-2)', border: '1px solid var(--rule)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <span aria-hidden="true" style={{
                flexShrink: 0, width: 34, height: 34, borderRadius: 10,
                display: 'grid', placeItems: 'center',
                background: quoteFollowUpEnabled ? 'var(--v3-primary-soft)' : 'var(--v3-surface-2)',
                border: '1px solid var(--v3-border-strong)',
                color: quoteFollowUpEnabled ? 'var(--v3-primary)' : 'var(--v3-text-muted)'
              }}>
                <CalendarClock size={16} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--ink-strong)' }}>
                  Set reminder when quote is sent
                </div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>
                  {quoteFollowUpEnabled ? `${quoteFollowUpDays} ${quoteFollowUpDays === 1 ? 'day' : 'days'} after sending` : 'Off'}
                </div>
              </div>
            </div>
            <Switch
              checked={quoteFollowUpEnabled}
              onCheckedChange={(on: boolean) => { hapticMedium(); setQuoteFollowUpEnabled(on) }}
              aria-label="Set a reminder when a quote is sent"
            />
          </div>

          {quoteFollowUpEnabled && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Eyebrow style={{ color: 'var(--ink-muted)' }}>Reminder delay</Eyebrow>
              <select
                value={quoteFollowUpDays}
                onChange={(event) => setQuoteFollowUpDays(Number(event.target.value))}
                aria-label="Quote reminder delay"
                style={{ ...brandInputStyle, width: 'auto', minWidth: 112, padding: '8px 12px' }}
              >
                {QUOTE_FOLLOW_UP_DAY_OPTIONS.map((days) => (
                  <option key={days} value={days}>{days} {days === 1 ? 'day' : 'days'}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </Section>

      {/* GETTING PAID, bring-your-own pay link. We don't integrate with
          any processor; the contractor pastes a link they already have
          (Venmo / Zelle / Square / PayPal / their own Stripe Payment
          Link) and it becomes a "Pay now" button everywhere money goes
          out. Saved with the bottom Save Changes bar. */}
      <Section
        variants={item}
        title={<>Getting <em>paid.</em></>}
        sub="Paste a payment link you already use, Venmo, Zelle, Square, PayPal, or a Stripe Payment Link. It becomes a “Pay now” button on every invoice and statement you send. Leave blank to keep collecting the way you do now."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <BrandField label="Payment link" optional hint="The page customers land on to pay you. We don't touch the money, it goes straight to your account.">
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              value={paymentLink}
              onChange={(e) => setPaymentLink(e.target.value)}
              placeholder="venmo.com/u/yourname  ·  buy.stripe.com/…"
              style={brandInputStyle}
            />
          </BrandField>

          <BrandField label="Payment instructions" optional hint="Shown under the button, checks payable to, mailing address, Zelle email/phone, etc.">
            <textarea
              rows={3}
              value={paymentInstructions}
              onChange={(e) => setPaymentInstructions(e.target.value)}
              placeholder="Checks payable to Parker Construction Co. · Zelle: pay@parkerconstructioncompany.com"
              style={{ ...brandInputStyle, resize: 'vertical', lineHeight: 1.45 }}
            />
          </BrandField>
        </div>
      </Section>

      {/* SERVICES */}
      <Section variants={item} title={<>What you <em>do.</em></>} meta={`${services.length} picked`}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {SERVICES.map((s) => {
            const isOn = services.includes(s)
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleService(s)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
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

      {/* RATE CARD, per-tenant overrides for the AI bid engine. Edits
          persist to fh_rate_cards (migration 026); Bid.jsx loads the
          merged view on mount via loadUserRateCard(). */}
      <Section variants={item} title={<>Your <em>rates.</em></>} sub="Override the AI bid defaults or add trades you bid often.">
        <RateCardEditor />
      </Section>

      {/* MARKET PIN, 5/17 audit fix: surface the city name reverse-geocoded
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
            padding: '12px 12px',
            borderRadius: 10,
            background: 'var(--surface-2)',
            border: '1px solid var(--rule)'
          }}>
            <Eyebrow style={{ color: 'var(--ink-muted)' }}>
              Service area
            </Eyebrow>
            <span style={{
              fontFamily: 'var(--font-body)',
              fontSize: 14,
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
                fontSize: 12,
                color: 'var(--ink-faint)',
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: 0
              }}>
                {profile.location_lat.toFixed(3)}, {profile.location_lon?.toFixed(3) || '\u2003'}
              </span>
            )}
          </div>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={pinLocation}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 12px', borderRadius: 10, background: 'rgba(201,150,58,0.08)', border: '1px solid rgba(201,150,58,0.25)', color: 'var(--field-gold-bright)', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            <MapPin size={16} />
            {profile?.location_lat ? 'Repin' : 'Pin location'}
          </motion.button>
        </div>
      </Section>

      {/* APPEARANCE, daylight mode. Restored after the light-theme
          parity pass (theme_parity token sweep + chrome veil tokens);
          desktop joined after the fh-build sweep (desktop_parity), so
          the toggle now applies on every viewport. Framed as a field
          feature: high-contrast warm paper for direct sunlight. */}
      <Section
        variants={item}
        title={<>Built for <em>daylight.</em></>}
        sub="High contrast light theme for reading the app in direct sun."
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '4px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <span aria-hidden="true" style={{
              flexShrink: 0, width: 34, height: 34, borderRadius: 10,
              display: 'grid', placeItems: 'center',
              background: theme === 'light' ? 'var(--v3-primary-soft)' : 'var(--v3-surface-2)',
              border: theme === 'light'
                ? '1px solid color-mix(in srgb, var(--v3-primary) 40%, transparent)'
                : '1px solid var(--v3-border-strong)',
              color: theme === 'light' ? 'var(--v3-primary)' : 'var(--v3-text-muted)'
            }}>
              <SunMedium size={16} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--v3-text)' }}>
                Daylight mode
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--v3-text-muted)', lineHeight: 1.4 }}>
                Warm paper, readable in direct sun. Applies everywhere.
              </div>
            </div>
          </div>
          <Switch
            checked={theme === 'light'}
            onCheckedChange={(on: boolean) => { hapticMedium(); setTheme(on ? 'light' : 'dark') }}
            aria-label="Toggle daylight mode"
          />
        </div>
      </Section>

      {/* ACCOUNT */}
      <Section
        variants={item}
        title={<>On your <em>lock screen.</em></>}
        sub="Get pinged the moment a quote is approved or a new lead lands."
      >
        <PushRow userId={user?.id} />
      </Section>

      <Section variants={item} title={<>Your <em>session.</em></>}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--ink-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.email}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>Signed in</div>
          </div>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={handleSignOut} className="fh-press-instant"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.35)', color: 'var(--alert-red)', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
          >
            <LogOut size={14} />
            Sign out
          </motion.button>
        </div>
        <DeleteAccountRow onDone={handleSignOut} />
      </Section>

      {/* DEV · CLEANUP */}
      {canWipe && (
        <Section
          variants={item}
          title={<>Remove <em>sample data.</em></>}
          meta="DEMO"
          metaTone="red"
        >
          <p style={{ margin: 0, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', fontSize: 12 }}>
            Clears the example clients, jobs, and activity that were loaded to show you around. Only removes sample data, your own clients and jobs are never touched.
          </p>
          <div style={{ marginTop: 10 }}>
            {!confirmWipe ? (
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={() => setConfirmWipe(true)} className="fh-press-instant"
                disabled={wiping}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 12px', borderRadius: 10, background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.35)', color: 'var(--alert-red)', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >
                <Trash2 size={14} />
                Remove sample data
              </motion.button>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setConfirmWipe(false)}
                  disabled={wiping}
                  style={{ padding: '12px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.97 }}
                  onClick={wipeTestData}
                  disabled={wiping}
                  style={{ padding: '12px 12px', borderRadius: 10, background: 'linear-gradient(135deg, #C0392B, #C0392B)', border: 'none', color: 'var(--raw-linen)', fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: 0, cursor: 'pointer', boxShadow: '0 6px 16px rgba(192,57,43,0.4)' }}
                >
                  {wiping ? 'REMOVING…' : 'REMOVE SAMPLE DATA'}
                </motion.button>
              </div>
            )}
            {wipeResult && (
              <p style={{ margin: '10px 0 0', color: wipeResult.startsWith("Couldn't") ? 'var(--alert-red)' : 'var(--signal-green)', fontSize: 12, fontFamily: 'var(--font-body)' }}>
                {wipeResult}
              </p>
            )}
          </div>
        </Section>
      )}

      {/* Desktop keeps the action in flow. Mobile only shows a compact
          floating action after a field changes, leaving ordinary
          scrolling with one persistent chrome layer instead of three. */}
      {(isDesktop || hasUnsavedChanges || saving || saved) && <div
        className="fh-settings-save-bar"
        style={{
          position: isDesktop ? 'static' : 'fixed',
          left: 'auto',
          right: isDesktop ? 'auto' : 80,
          bottom: isDesktop ? 'auto' : 'calc(var(--fh-mobile-dock-height) + 16px)',
          zIndex: 'calc(var(--z-nav, 40) - 1)',
          padding: isDesktop ? '12px 0 0' : 0,
          display: 'flex',
          justifyContent: 'flex-end',
          background: 'transparent',
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
            height: 40,
            minHeight: 40,
            padding: '0 16px',
            borderRadius: 10,
            background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
            color: 'var(--onyx)',
            fontFamily: 'var(--font-body)',
            fontSize: 14,
            letterSpacing: 0,
            border: 'none',
            cursor: saving ? 'default' : 'pointer',
            boxShadow: '0 8px 20px rgba(201,150,58,0.35)',
            opacity: saving ? 0.65 : 1
          }}
        >
          <UploadIcon size={16} />
          {saving ? 'SAVING...' : saved ? 'SAVED' : 'SAVE CHANGES'}
        </motion.button>
      </div>}
    </>
  )

  if (isDesktop) {
    return (
      <Suspense fallback={null}><SnowSettingsBuild
        userEmail={user?.email}
        companyName={companyName}
        profileCompletePct={profileCompletePct}
        brandReady={brandReady}
        servicesCount={services.length}
        hasLogo={hasLogo}
        hasLocation={hasLocation}
        missingItems={missingItems}
        onSignOut={async () => { await signOut(); navigate('/login', { replace: true }) }}
      >
        {sections}
      </SnowSettingsBuild></Suspense>
    )
  }

  return (
    <motion.div className="fh-screen" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: hasUnsavedChanges || saving || saved ? 56 : 0, position: 'relative' }}>
      {/* HEADER */}
      <motion.div variants={item} style={{ padding: '12px 24px 12px' }}>
        <Eyebrow>
          Profile
        </Eyebrow>
        <h1 style={{ margin: '4px 0 0', fontSize: 24, lineHeight: 1.1, letterSpacing: 0, fontWeight: 600, color: 'var(--ink-strong)' }}>
          Your business,{' '}
          organized.
        </h1>
      </motion.div>
      {sections}
    </motion.div>
  )
}

/* Push notifications row. Three device states:
   - ready          → Enable / Enabled toggle
   - needs-install  → iOS Safari tab: push only works once the app is
                      added to the Home Screen, so say exactly that
   - unsupported    → hide the noise, show a quiet dash */
function PushRow({ userId }: { userId?: string }) {
  const support = pushSupport()
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => { pushEnabled().then(setEnabled) }, [])

  async function toggle() {
    if (busy || !userId) return
    setBusy(true)
    try {
      if (enabled) {
        await disablePush()
        setEnabled(false)
        toastSuccess('Push off', 'This device will stay quiet')
      } else {
        const r = await enablePush(userId)
        if (r === 'enabled') {
          setEnabled(true)
          toastSuccess('Push on', "You'll get pinged on this device")
        } else if (r === 'denied') {
          toastError('Notifications blocked', 'Allow notifications for Fieldhorse in system settings')
        } else {
          toastError("Couldn't enable push", 'Try again in a minute')
        }
      }
    } finally {
      setBusy(false)
    }
  }

  const rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)' } as const

  if (support === 'needs-install') {
    return (
      <div style={rowStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--ink-strong)' }}>
            Add to Home Screen first
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>
            iPhone: Share → Add to Home Screen, then open Fieldhorse from the icon and flip this on.
          </div>
        </div>
      </div>
    )
  }

  if (support === 'unsupported') {
    return (
      <div style={rowStyle}>
        <div style={{ fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)' }}>
          This browser doesn't support push notifications.
        </div>
      </div>
    )
  }

  return (
    <div style={rowStyle}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--ink-strong)' }}>
          Push notifications
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>
          {enabled ? 'On for this device' : 'Off, approvals and new leads stay silent'}
        </div>
      </div>
      <motion.button
        type="button"
        whileTap={{ scale: 0.97 }}
        onClick={toggle} className="fh-press-instant"
        disabled={busy || !userId}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10,
          background: enabled ? 'var(--v3-surface-2)' : 'var(--v3-primary-soft)',
          border: enabled ? '1px solid var(--v3-border-strong)' : '1px solid color-mix(in srgb, var(--v3-primary) 40%, transparent)',
          color: enabled ? 'var(--v3-text-muted)' : 'var(--v3-primary)',
          fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          opacity: busy ? 0.6 : 1
        }}
      >
        <Bell size={14} />
        {busy ? 'Working…' : enabled ? 'Turn off' : 'Enable'}
      </motion.button>
    </div>
  )
}

/* Permanent account deletion, wires the existing /api/delete-account
   endpoint (previously mobile-only) into web Settings. Type-to-confirm
   guards the irreversible wipe; on success we sign the user out. */
function DeleteAccountRow({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)

  async function doDelete() {
    if (confirmText.trim().toUpperCase() !== 'DELETE' || busy) return
    setBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { toastError('Not signed in', 'Please sign in again.'); setBusy(false); return }
      const res = await fetch('/api/delete-account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body?.ok) {
        toastError("Couldn't delete account", body?.message || body?.error || 'Try again.')
        setBusy(false)
        return
      }
      toastSuccess('Account deleted', 'Signing you out…')
      onDone()
    } catch (e: any) {
      toastError("Couldn't delete account", e?.message || 'Try again.')
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ marginTop: 10, background: 'none', border: 'none', padding: '4px 4px', color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
      >
        Delete my account
      </button>
    )
  }

  return (
    <div style={{ marginTop: 10, padding: '12px', borderRadius: 10, background: 'rgba(192,57,43,0.08)', border: '1px solid rgba(192,57,43,0.35)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--alert-red)', marginBottom: 4 }}>Permanently delete your account</div>
      <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.5 }}>
        This erases every contact, job, quote, invoice, payment, photo, and file you own, and closes your login. It can't be undone. Type <strong>DELETE</strong> to confirm.
      </p>
      <input
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder="DELETE"
        autoCapitalize="characters"
        disabled={busy}
        style={{ width: '100%', boxSizing: 'border-box', padding: '12px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 14, outline: 'none', marginBottom: 10 }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => { setOpen(false); setConfirmText('') }} disabled={busy} style={{ flex: 1, padding: '12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
        <button type="button" onClick={doDelete} disabled={busy || confirmText.trim().toUpperCase() !== 'DELETE'} style={{ flex: 1, padding: '12px', borderRadius: 10, background: 'rgba(192,57,43,0.16)', border: '1px solid rgba(192,57,43,0.5)', color: 'var(--alert-red)', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: busy || confirmText.trim().toUpperCase() !== 'DELETE' ? 0.5 : 1 }}>
          {busy ? 'Deleting…' : 'Delete forever'}
        </button>
      </div>
    </div>
  )
}

function Section({ variants, title, sub, meta, metaTone, children }: any) {
  const metaBg = metaTone === 'red'
    ? { background: 'var(--v3-danger-soft)', border: '1px solid color-mix(in srgb, var(--v3-danger) 40%, transparent)', color: 'var(--v3-danger-bright)' }
    : { background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border-strong)', color: 'var(--v3-text-muted)' }
  return (
    <motion.section
      variants={variants}
      className="v3-section"
      style={{ margin: '0 var(--v3-gutter) 14px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: sub ? 4 : 10, gap: 12 }}>
        <h2
          style={{ margin: 0, fontSize: 20, lineHeight: 1.15, letterSpacing: 0, fontWeight: 600, color: 'var(--v3-text)' }}
        >
          {renderSectionTitle(title)}
        </h2>
        {meta && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '4px 8px',
              borderRadius: 10,
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0,
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

function renderSectionTitle(node: any) {
  // node is a React fragment with <em> around the accent word.
  // Wrap the <em> in a span with the italic gradient class so the rendered word is gold-italic.
  if (node && node.props && Array.isArray(node.props.children)) {
    return node.props.children.map((child: any, i: any) => {
      if (child && child.type === 'em') {
        return <span key={i}>{child.props.children}</span>
      }
      return child
    })
  }
  return node
}

function Meta({ label, value }: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)', minWidth: 80 }}>
      <Eyebrow style={{ color: 'var(--ink-muted)' }}>{label}</Eyebrow>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, letterSpacing: 0, color: 'var(--ink-strong)' }}>{value}</span>
    </div>
  )
}

function BrandField({ label, hint, optional, children }: any) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <Eyebrow style={{ color: 'var(--ink-muted)' }}>
          {label}
        </Eyebrow>
        {optional && (
          <Eyebrow style={{ padding: '4px 8px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)', color: 'var(--ink-faint, var(--ink-muted))' }}>
            Optional
          </Eyebrow>
        )}
      </span>
      {children}
      {hint && (
        <span style={{
          fontSize: 12, color: 'var(--ink-faint, var(--ink-muted))',
          fontFamily: 'var(--font-body)', lineHeight: 1.4
        }}>
          {hint}
        </span>
      )}
    </label>
  )
}

const brandInputStyle: import('react').CSSProperties = {
  padding: '12px 12px',
  borderRadius: 10,
  background: 'var(--surface-2)',
  border: '1px solid var(--rule)',
  color: 'var(--ink-strong)',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box'
}

/**
 * Brand color editor, native color picker + hex input + live preview
 * strip showing how the chosen color will render on customer facing
 * surfaces (top rule, status pill, eyebrow, hero money number).
 *
 * Validation is deferred to save() so the editor stays permissive
 * while the operator's typing, the picker + preset palette can only
 * emit valid hex, but the manual hex input could be mid-type.
 */
const COLOR_PRESETS = [
  { hex: '#C9963A', name: 'FieldGold (default)' },
  { hex: '#5C5C5C', name: 'Indigo' },
  { hex: '#2D7A4F', name: 'Forest' },
  { hex: '#C0392B', name: 'Brick' },
  { hex: '#141414', name: 'Onyx' }
]

const ESTIMATE_TEMPLATES = [
  { key: 'classic',   name: 'Classic',   blurb: 'Editorial dark accent layout grouped by trade.', swatch: ['#141414', '#C9963A', '#F2EDE4'] },
  { key: 'slate',     name: 'Slate',     blurb: 'Gray header bar, From/For blocks, itemized rows.', swatch: ['#5C5C5C', '#F2EDE4', '#F2EDE4'] },
  { key: 'mint',      name: 'Mint',      blurb: 'Large green ESTIMATE wordmark, itemized rows.', swatch: ['#5C5C5C', '#F2EDE4', '#F2EDE4'] },
  { key: 'editorial', name: 'Editorial', blurb: 'Sand + serif, Scope of Work and Cost Breakdown.', swatch: ['#F2EDE4', '#C9963A', '#141414'] }
]

function EstimateTemplatePicker({ value, onChange }: any) {
  const selected = value || 'classic'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
      {ESTIMATE_TEMPLATES.map((t) => {
        const on = selected === t.key
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            aria-pressed={on}
            style={{
              textAlign: 'left',
              padding: 12,
              borderRadius: 10,
              cursor: 'pointer',
              background: on ? 'var(--v3-primary-soft, rgba(201, 150, 58,0.12))' : 'var(--surface, transparent)',
              border: on ? '2px solid var(--v3-primary, #C9963A)' : '1px solid var(--rule)',
              display: 'flex', flexDirection: 'column', gap: 8
            }}
          >
            <div style={{ display: 'flex', gap: 4 }}>
              {t.swatch.map((c, i) => (
                <span key={i} style={{ width: 22, height: 22, borderRadius: 10, background: c, border: '1px solid rgba(20, 20, 20,0.08)' }} />
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{t.name}</span>
              {on && <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0, color: 'var(--v3-primary, #C9963A)' }}>SELECTED</span>}
            </div>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, lineHeight: 1.4, color: 'var(--ink-muted)' }}>{t.blurb}</span>
          </button>
        )
      })}
    </div>
  )
}

function BrandColorEditor({ value, onChange, companyName }: any) {
  const v = (value || '').trim()
  const isHex = /^#[0-9a-fA-F]{6}$/.test(v)
  const previewColor = isHex ? v : '#C9963A'
  const usingDefault = !isHex

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Input row: color picker swatch + hex text input + reset */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <label
          aria-label="Pick brand color"
          style={{
            position: 'relative',
            width: 44, height: 44, borderRadius: 10,
            background: previewColor,
            border: '1px solid var(--rule)',
            cursor: 'pointer',
            flexShrink: 0,
            boxShadow: 'inset 0 1px 0 var(--v3-border-mid)'
          }}
        >
          <input
            type="color"
            value={isHex ? v : '#C9963A'}
            onChange={(e) => onChange(e.target.value)}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
          />
        </label>
        <input
          type="text"
          value={v}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#C9963A"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          style={{
            ...brandInputStyle,
            flex: 1,
            fontFamily: 'var(--font-mono, var(--font-body))',
            fontVariantNumeric: 'tabular-nums',
            textTransform: 'lowercase'
          }}
        />
        {v && (
          <button
            type="button"
            onClick={() => onChange('')}
            style={{
              padding: '8px 12px', borderRadius: 10,
              background: 'transparent', border: '1px solid var(--rule)',
              color: 'var(--ink-muted)', fontFamily: 'var(--font-body)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer'
            }}
          >
            Reset
          </button>
        )}
      </div>

      {/* Preset palette, common contractor brand colors */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {COLOR_PRESETS.map((p) => {
          const isOn = isHex && v.toLowerCase() === p.hex.toLowerCase()
          return (
            <button
              key={p.hex}
              type="button"
              onClick={() => onChange(p.hex)}
              aria-label={`Use ${p.name}`}
              title={p.name}
              style={{
                width: 28, height: 28, borderRadius: 10,
                background: p.hex,
                border: isOn ? '2px solid var(--ink-strong)' : '1px solid var(--rule)',
                cursor: 'pointer',
                padding: 0
              }}
            />
          )
        })}
      </div>

      {/* Live preview, shows how the chosen color renders on the
          three most identity-loaded customer-visible surfaces. */}
      <div style={{
        marginTop: 4,
        padding: '12px 16px',
        background: '#F2EDE4',
        border: '1px solid #F2EDE4',
        borderRadius: 10,
        display: 'flex', flexDirection: 'column', gap: 12
      }}>
        {/* Top rule */}
        <div style={{ height: 3, background: previewColor, borderRadius: 10 }} />
        {/* Eyebrow + hero number row */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <Eyebrow as="div" style={{ color: previewColor }}>
              Invoice
            </Eyebrow>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 20, fontWeight: 600,
              letterSpacing: 0,
              color: '#141414', marginTop: 2,
              textTransform: 'uppercase'
            }}>
              {(companyName || 'My Company').toUpperCase()}
            </div>
          </div>
          {/* Status pill */}
          <Eyebrow style={{ padding: '4px 8px', borderRadius: 10, background: `color-mix(in srgb, ${previewColor} 16%, white)`, border: `1px solid ${previewColor}`, color: previewColor }}>
            Sample
          </Eyebrow>
        </div>
        {/* Hero money */}
        <div style={{
          fontFamily: 'var(--font-serif, Georgia, serif)',
          fontSize: 24, fontWeight: 600, letterSpacing: 0,
          color: previewColor, lineHeight: 1
        }}>
          $24,400
        </div>
      </div>

      {usingDefault && (
        <span style={{
          fontFamily: 'var(--font-body)', fontSize: 12,
          color: 'var(--ink-faint, var(--ink-muted))'
        }}>
          Using the FieldHorse default. Pick a preset, paste a hex (e.g. <code>#5C5C5C</code>), or tap the swatch to choose your own.
        </span>
      )}
    </div>
  )
}
