import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, Phone, Mail, Hammer, FileText, ShieldCheck, CreditCard,
  Upload, Trash2, ExternalLink, AlertTriangle, CheckCircle2, Plus,
  Bell, Search, MapPin
} from 'lucide-react'
import { supabase } from '../lib/supabase.ts'
import { useSubDetail, subDetailKey } from '../lib/queries.ts'
import { formatPhone } from '../lib/utils.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import { hapticTap, hapticSuccess } from '../lib/haptics.ts'
import { useFhMotion } from '../lib/motion.ts'
import SectionHeader from '../components/v3/SectionHeader.tsx'
import { Eyebrow, StampNumber } from '../components/v3'
import { toastSuccess, toastError } from '../lib/toast.ts'
import MiniMetric from '../components/MiniMetric.tsx'
import DataErrorState from '../components/DataErrorState.tsx'
import { useIsDesktop } from '../lib/useMediaQuery.ts'
import { useMembership } from '../contexts/MembershipContext.tsx'

// SubDetail — vendor profile surface at /subs/:key.
//
// :key is the same lowercased phone-or-name rollup key the Subs
// directory builds (see Subs.jsx). The page joins three things:
//   1. fh_subs rows matching that key  → per-job history rollup
//   2. fh_sub_profiles row matching     → vendor identity (insurance,
//      banking, EIN, license, documents, notes)
//   3. fh_contacts for the matching contact_ids → job names/titles
//
// If no profile exists yet for the rollup key, the page shows a
// "Create profile" CTA that inserts a profile prefilled with the
// rolled-up name + phone, then re-fetches.

const PAYMENT_METHODS = [
  { value: '',         label: '— Not set —' },
  { value: 'check',    label: 'Check' },
  { value: 'ach',      label: 'ACH / Direct deposit' },
  { value: 'zelle',    label: 'Zelle' },
  { value: 'venmo',    label: 'Venmo' },
  { value: 'cashapp',  label: 'Cash App' },
  { value: 'cash',     label: 'Cash' },
  { value: 'other',    label: 'Other' }
]

const DOC_SLOTS = [
  { id: 'w9',      label: 'W-9',                 path: 'w9_path',      hint: 'Required for 1099 reporting' },
  { id: 'coi',     label: 'Certificate of Insurance', path: 'coi_path', hint: 'COI / liability cert' },
  { id: 'license', label: 'License',             path: 'license_path', hint: 'Trade or contractor license' }
]

function fmtRelativeDate(d: any) {
  if (!d) return ''
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function daysUntil(dateStr: any) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  return Math.floor((d.getTime() - Date.now()) / 86400000)
}

function fmtDate(dateStr: any) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function SubDetail() {
  const { key: rawKey } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { stagger, item } = useFhMotion()
  const isDesktop = useIsDesktop()
  const membership = useMembership()
  const scopeOrgId = membership.loading ? undefined : membership.orgId

  const key = useMemo(() => {
    try { return decodeURIComponent(rawKey || '').trim().toLowerCase() }
    catch { return (rawKey || '').trim().toLowerCase() }
  }, [rawKey])

  const queryClient = useQueryClient()
  const { data: bundle, isPending: queryPending, isError, error: queryError } = useSubDetail(key, user?.id, scopeOrgId)
  const loading = membership.loading || queryPending
  const subRows = bundle?.subRows ?? []
  const contacts = bundle?.contacts ?? {}
  const profile = bundle?.profile ?? null
  const error = isError ? (queryError?.message || 'Could not load sub') : ''
  const [creating, setCreating] = useState(false)

  // Profile create / edit writes straight to the cached bundle so the
  // panel reflects the change without a refetch.
  const setProfile = (next: any) =>
    queryClient.setQueryData(subDetailKey(key, user?.id, scopeOrgId), (prev) =>
      prev ? { ...prev, profile: next } : prev)

  // Display name + phone derived from whichever source has data.
  // Profile wins when present; rollup is the fallback.
  const displayName = profile?.name || subRows[0]?.name || '(Unnamed sub)'
  const displayPhone = profile?.phone || subRows[0]?.phone || ''

  const totals = useMemo(() => {
    let billed = 0
    const trades = new Set()
    let lastWorked = null
    for (const r of subRows) {
      billed += Number(r.rate || 0)
      if (r.trade) trades.add(r.trade)
      const c = r.created_at ? new Date(r.created_at) : null
      if (c && (!lastWorked || c > lastWorked)) lastWorked = c
    }
    return { billed, trades: Array.from(trades), lastWorked }
  }, [subRows])

  async function handleCreate() {
    if (!user?.id || creating) return
    setCreating(true)
    const seedName = (subRows[0]?.name || '').trim() || displayName.trim() || 'New sub'
    const seedPhone = (subRows[0]?.phone || '').trim() || null
    const seedTrade = subRows[0]?.trade ? [subRows[0].trade] : []
    const { error: insErr, data } = await supabase
      .from('fh_sub_profiles')
      .insert({
        user_id: user.id,
        org_id: scopeOrgId ?? null,
        name: seedName,
        phone: seedPhone,
        trades: seedTrade
      })
      .select()
      .maybeSingle()
    setCreating(false)
    if (insErr) {
      toastError("Couldn't create profile", insErr.message)
      return
    }
    hapticSuccess()
    setProfile(data)
    toastSuccess('Profile created', seedName)
  }

  if (loading) {
    if (isDesktop) {
      return (
        <SubDetailStatePage
          loading
          title="Loading vendor profile"
          message="Pulling profile, compliance, documents, and job history."
          onBack={() => navigate('/subs')}
        />
      )
    }

    return (
      <div style={{ padding: '24px 20px' }}>
        <div className="v3-skeleton" style={{ height: 28, width: 220, borderRadius: 6, marginBottom: 12 }} />
        <div className="v3-skeleton" style={{ height: 120, width: '100%', borderRadius: 14, marginBottom: 12 }} />
        <div className="v3-skeleton" style={{ height: 200, width: '100%', borderRadius: 14 }} />
      </div>
    )
  }

  if (error) {
    if (isDesktop) {
      return (
        <SubDetailStatePage
          title="Could not load vendor profile"
          message={error}
          onBack={() => navigate('/subs')}
        />
      )
    }

    return (
      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <BackButton onClick={() => { hapticTap(); navigate('/subs') }} />
        <div className="v3-empty">
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
            {error}
          </div>
          <div style={{ fontSize: 12 }}>Try again, or check the Sub Directory.</div>
        </div>
      </div>
    )
  }

  // Nothing matches — neither a profile nor any per-job sub rows.
  // Treat as a clean miss; route them back to the directory.
  if (!profile && subRows.length === 0) {
    if (isDesktop) {
      return (
        <SubDetailStatePage
          title="Sub not found"
          message="This vendor is not in the directory yet."
          onBack={() => navigate('/subs')}
        />
      )
    }

    return (
      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <BackButton onClick={() => { hapticTap(); navigate('/subs') }} />
        <div className="v3-empty">
          <Hammer size={20} color="var(--v3-text-muted)" style={{ margin: '0 auto 8px' }} />
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
            Sub not found.
          </div>
          <div style={{ fontSize: 12 }}>This sub isn't in the directory yet.</div>
        </div>
      </div>
    )
  }

  if (isDesktop) {
    return (
      <SubDetailDesktop
        displayName={displayName}
        displayPhone={displayPhone}
        profile={profile}
        subRows={subRows}
        contacts={contacts}
        totals={totals}
        creating={creating}
        onCreate={handleCreate}
        onBack={() => navigate('/subs')}
        onSaved={(updated: any) => setProfile(updated)}
      />
    )
  }

  return (
    <motion.div
      className="v3-screen"
      variants={stagger}
      initial="hidden"
      animate="show"
      style={{ paddingBottom: 120, position: 'relative', background: 'var(--v3-bg)' }}
    >
      {/* Top bar */}
      <motion.div variants={item} style={{ padding: '8px 20px 4px' }}>
        <BackButton onClick={() => { hapticTap(); navigate('/subs') }} />
      </motion.div>

      {/* Cockpit */}
      <motion.div variants={item} style={{ padding: '8px 20px 12px' }}>
        <div style={{
          padding: '14px 16px',
          borderRadius: 16,
          background: 'var(--v3-surface)',
          border: '1px solid var(--v3-border)',
          boxShadow: '0 1px 0 rgba(255, 240, 210, 0.04) inset, 0 8px 22px rgba(0, 0, 0, 0.40)'
        }}>
          <Eyebrow tone="gold">
            <Hammer size={11} aria-hidden="true" />
            Vendor profile
          </Eyebrow>
          <h1 style={{
            margin: '6px 0 0',
            fontFamily: 'var(--font-body)',
            fontSize: 'clamp(22px, 6vw, 28px)',
            lineHeight: 1.05,
            letterSpacing: '-0.015em',
            fontWeight: 700,
            color: 'var(--v3-text)'
          }}>
            {displayName}
          </h1>

          {/* Quick contact row */}
          {(displayPhone || profile?.email) && (
            <div style={{
              marginTop: 10,
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              fontSize: 12,
              color: 'var(--v3-text-muted)',
              fontFamily: 'var(--font-body)'
            }}>
              {displayPhone && (
                <a href={`tel:${displayPhone}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--v3-text)', textDecoration: 'none', fontWeight: 600 }}>
                  <Phone size={11} />
                  {formatPhone(displayPhone)}
                </a>
              )}
              {profile?.email && (
                <a href={`mailto:${profile.email}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--v3-text)', textDecoration: 'none', fontWeight: 600 }}>
                  <Mail size={11} />
                  {profile.email}
                </a>
              )}
            </div>
          )}

          {/* KPI strip */}
          <div style={{
            marginTop: 14,
            display: 'grid',
            gridTemplateColumns: '1fr 1px 1fr',
            alignItems: 'end',
            gap: 12
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <Eyebrow tone="gold">Billed</Eyebrow>
              <StampNumber size="2xl" tone="gold" style={{ display: 'block', lineHeight: 0.95 }}>
                ${totals.billed.toLocaleString()}
              </StampNumber>
              <Eyebrow as="div" style={{ marginTop: 2 }}>
                across {subRows.length} {subRows.length === 1 ? 'job' : 'jobs'}
              </Eyebrow>
            </div>
            <span aria-hidden="true" style={{ background: 'var(--v3-border)', alignSelf: 'stretch' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <Eyebrow>Trades</Eyebrow>
              <StampNumber size="xl" style={{ display: 'block', lineHeight: 0.95 }}>
                {totals.trades.length || '—'}
              </StampNumber>
              <Eyebrow as="div" style={{ marginTop: 2 }}>
                {totals.lastWorked ? `Last: ${fmtRelativeDate(totals.lastWorked)}` : 'No work yet'}
              </Eyebrow>
            </div>
          </div>
        </div>
      </motion.div>

      {/* No profile yet — surface a single Create CTA */}
      {!profile && (
        <motion.div variants={item} style={{ padding: '0 20px 12px' }}>
          <div style={{
            padding: '14px 16px',
            borderRadius: 14,
            background: 'var(--v3-surface)',
            border: '1px dashed color-mix(in srgb, var(--v3-primary) 36%, transparent)',
            display: 'flex',
            alignItems: 'center',
            gap: 12
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: 'var(--v3-text)' }}>
                No vendor profile yet
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--v3-text-muted)', marginTop: 3, lineHeight: 1.4 }}>
                Add insurance, banking, W-9 and license info so it's all in one place next time you call them.
              </div>
            </div>
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={handleCreate}
              disabled={creating}
              style={{
                flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', gap: 6,
                minHeight: 40, padding: '0 14px 0 12px',
                borderRadius: 999,
                border: '1px solid color-mix(in srgb, var(--v3-primary) 50%, transparent)',
                background: 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
                color: 'var(--v3-on-primary)',
                fontFamily: 'var(--font-body)',
                fontSize: 10, fontWeight: 700,
                letterSpacing: '0.16em', textTransform: 'uppercase',
                cursor: creating ? 'default' : 'pointer',
                opacity: creating ? 0.6 : 1,
                boxShadow: '0 0 0 2px rgba(228, 190, 111, 0.14), 0 4px 10px rgba(201, 150, 58, 0.28)',
                WebkitTapHighlightColor: 'transparent'
              }}
            >
              <Plus size={13} strokeWidth={2.6} />
              {creating ? 'Creating…' : 'Create profile'}
            </motion.button>
          </div>
        </motion.div>
      )}

      {/* Profile editor — only when a profile row exists */}
      {profile && (
        <ProfileEditor
          profile={profile}
          onSaved={(updated: any) => setProfile(updated)}
        />
      )}

      {/* Job history — read-only */}
      {subRows.length > 0 && (
        <motion.div variants={item} className="v3-section" style={{ margin: '0 20px 28px' }}>
          <SectionHeader label="Job history" />
          <ul style={{
            listStyle: 'none',
            padding: 0,
            margin: '4px 0 0',
            display: 'flex', flexDirection: 'column', gap: 2,
            background: 'var(--v3-surface)',
            border: '1px solid var(--v3-border)',
            borderRadius: 14,
            overflow: 'hidden'
          }}>
            {subRows.map((r, i) => {
              const c = contacts[r.contact_id as string]
              return (
                <li key={r.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    padding: '12px 14px',
                    borderBottom: i < subRows.length - 1 ? '1px solid var(--v3-border)' : 'none',
                    fontFamily: 'var(--font-body)',
                    fontSize: 12
                  }}
                >
                  {c ? (
                    <Link to={`/jobs/${c.id}`}
                      style={{ color: 'var(--v3-text)', textDecoration: 'none', display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                      <span style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.name}
                      </span>
                      {c.job_title && (
                        <span style={{ color: 'var(--v3-text-muted)', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {c.job_title}
                        </span>
                      )}
                    </Link>
                  ) : (
                    <span style={{ color: 'var(--v3-text-muted)', flex: 1 }}>(Job not found)</span>
                  )}
                  <span style={{
                    flexShrink: 0,
                    fontFamily: 'var(--font-display)',
                    fontSize: 13,
                    color: 'var(--v3-text)',
                    fontVariantNumeric: 'tabular-nums'
                  }}>
                    {Number(r.rate || 0) > 0 ? `$${Number(r.rate).toLocaleString()}` : '—'}
                  </span>
                </li>
              )
            })}
          </ul>
        </motion.div>
      )}
    </motion.div>
  )
}

type SubDetailDesktopProps = {
  displayName: string
  displayPhone: string
  profile: any
  subRows: any[]
  contacts: Record<string, any>
  totals: { billed: number; trades: any[]; lastWorked: any }
  creating: boolean
  onCreate: () => void
  onBack: () => void
  onSaved: (updated: any) => void
}

function SubDetailDesktop({
  displayName,
  displayPhone,
  profile,
  subRows,
  contacts,
  totals,
  creating,
  onCreate,
  onBack,
  onSaved,
}: SubDetailDesktopProps) {
  const navigate = useNavigate()
  const insuranceDays = daysUntil(profile?.insurance_expires_on)
  const insuranceLabel = !profile
    ? 'No profile'
    : insuranceDays === null
      ? 'Not on file'
      : insuranceDays < 0
        ? 'Expired'
        : insuranceDays <= 30
          ? 'Expires soon'
          : 'Current'
  const insuranceTone: 'warn' | 'bad' | undefined = insuranceDays === null
    ? undefined
    : insuranceDays < 0
      ? 'bad'
      : insuranceDays <= 30
        ? 'warn'
        : undefined
  const primaryTrade = totals.trades.length > 0 ? String(totals.trades[0]) : 'No trade tagged'
  const email = profile?.email || ''
  const address = profile?.address || ''

  return (
    <div className="fh-build-page fh-subdetail-build" data-build-screen="SubDetail">
      <header className="fh-build-topbar">
        <button type="button" className="fh-build-secondary-btn" onClick={onBack}>
          <ChevronLeft size={15} aria-hidden="true" />
          Subs
        </button>
        <button
          type="button"
          className="fh-build-search"
          onClick={() => window.dispatchEvent(new CustomEvent('fh:open-palette'))}
          aria-label="Open command palette"
        >
          <Search size={14} />
          <span>Search vendors, jobs, payments...</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div className="fh-build-topbar__meta">
          <span>{subRows.length.toLocaleString()} job links</span>
          <span className="fh-build-vline" />
          <span style={{ opacity: 0.6 }}>{primaryTrade}</span>
        </div>
        <button
          className="fh-build-icon-btn"
          type="button"
          onClick={() => navigate('/activity')}
          aria-label="Open activity"
          title="Activity"
        >
          <Bell size={16} />
        </button>
      </header>

      <main className="fh-build-main">
        <section className="fh-build-hero-row fh-build-hero-row--page">
          <div>
            <div className="fh-build-good">Vendor profile</div>
            <h1 className="fh-build-title">{displayName}</h1>
          </div>

          <div className="fh-build-focus fh-subdetail-contact-card">
            <div className="fh-build-eyebrow">Contact file</div>
            <strong>{profile?.company || 'Independent vendor'}</strong>
            <div className="fh-subdetail-contact-lines">
              {displayPhone ? (
                <a href={`tel:${displayPhone}`}>
                  <Phone size={13} aria-hidden="true" />
                  {formatPhone(displayPhone)}
                </a>
              ) : (
                <span>No phone on file</span>
              )}
              {email && (
                <a href={`mailto:${email}`}>
                  <Mail size={13} aria-hidden="true" />
                  {email}
                </a>
              )}
              {address && (
                <span>
                  <MapPin size={13} aria-hidden="true" />
                  {address}
                </span>
              )}
            </div>
            {!profile && (
              <button type="button" className="fh-build-primary-btn" onClick={onCreate} disabled={creating}>
                <Plus size={14} aria-hidden="true" />
                {creating ? 'Creating...' : 'Create profile'}
              </button>
            )}
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Billed" value={`$${totals.billed.toLocaleString()}`} accent />
            <MiniMetric label="Job history" value={String(subRows.length)} />
            <MiniMetric label="Trades" value={String(totals.trades.length || 0)} />
            <MiniMetric label="Insurance" value={insuranceLabel} tone={insuranceTone} />
          </div>
        </section>

        <section className="fh-build-content-grid fh-build-content-grid--jobs">
          <div className="fh-subdetail-main-stack">
            <section className="fh-build-card">
              <header className="fh-build-card-head">
                <div className="fh-build-eyebrow">Profile summary</div>
                {profile ? <span className={`fh-build-dot is-${insuranceTone || 'neutral'}`}>{insuranceLabel}</span> : null}
              </header>

              {!profile ? (
                <DataErrorState
                  compact
                  title="No vendor profile yet"
                  message="Create a profile to track insurance, documents, payment preferences, and notes."
                  actionLabel={creating ? 'Creating...' : 'Create profile'}
                  onRetry={creating ? undefined : onCreate}
                />
              ) : (
                <div className="fh-subdetail-profile-grid">
                  <DetailRow label="Company" value={profile.company || 'Independent vendor'} />
                  <DetailRow label="Phone" value={displayPhone ? formatPhone(displayPhone) : 'Not on file'} />
                  <DetailRow label="Email" value={email || 'Not on file'} />
                  <DetailRow label="Address" value={address || 'Not on file'} />
                  <DetailRow label="EIN" value={profile.ein || 'Not on file'} />
                  <DetailRow label="License" value={profile.license_number || 'Not on file'} />
                  <DetailRow label="Payment" value={profile.payment_method || 'Not on file'} />
                  <DetailRow label="Insurance" value={profile.insurance_expires_on ? `Expires ${fmtDate(profile.insurance_expires_on)}` : 'Not on file'} tone={insuranceTone} />
                </div>
              )}
            </section>

            {profile && (
              <div className="fh-subdetail-editor-shell">
                <ProfileEditor profile={profile} onSaved={onSaved} />
              </div>
            )}

            <section className="fh-build-card fh-build-table">
              <header className="fh-build-card-head">
                <div className="fh-build-eyebrow">Job history - {subRows.length.toLocaleString()}</div>
                <span style={{ color: 'var(--v3-text-muted)', fontSize: 12 }}>
                  {totals.lastWorked ? `Last worked ${fmtRelativeDate(totals.lastWorked)}` : 'No work logged'}
                </span>
              </header>

              {subRows.length === 0 ? (
                <div className="fh-build-table__empty">No job history yet.</div>
              ) : (
                <>
                  <div className="fh-build-table__head is-subdetail-jobs">
                    <span>Job</span>
                    <span>Trade</span>
                    <span>Date</span>
                    <span>Billed</span>
                    <span />
                  </div>
                  {subRows.slice(0, 80).map((r) => {
                    const c = contacts[r.contact_id as string]
                    return (
                      <Link key={r.id} to={c ? `/jobs/${c.id}` : '#'} className="fh-build-table__row is-subdetail-jobs">
                        <strong className="fh-build-truncate" title={c?.name || ''}>{c?.name || 'Job not found'}</strong>
                        <span className="fh-build-rel">{r.trade || '-'}</span>
                        <span className="fh-build-rel">{r.created_at ? fmtRelativeDate(new Date(r.created_at)) : '-'}</span>
                        <span className="fh-build-num">{Number(r.rate || 0) > 0 ? `$${Number(r.rate).toLocaleString()}` : '-'}</span>
                        <ChevronRight size={13} aria-hidden="true" />
                      </Link>
                    )
                  })}
                  {subRows.length > 80 && (
                    <div className="fh-build-table__more">Showing the first 80 linked jobs.</div>
                  )}
                </>
              )}
            </section>
          </div>

          <aside className="fh-build-rail fh-build-rail--page">
            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Compliance</div>
              <strong style={{ color: insuranceTone === 'bad' ? '#ee4942' : insuranceTone === 'warn' ? '#e0a141' : undefined }}>
                {insuranceLabel}
              </strong>
              <span>
                {profile?.insurance_expires_on
                  ? `Insurance ${fmtDate(profile.insurance_expires_on)}`
                  : 'Collect COI expiry before assigning critical work.'}
              </span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Trades</div>
              <strong>{totals.trades.length || '-'}</strong>
              <span>{totals.trades.length ? totals.trades.join(', ') : 'No trade tags yet'}</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Payments</div>
              <strong>{profile?.payment_method || 'Not set'}</strong>
              <span>{profile?.payment_handle || 'Add a safe payment label only.'}</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Documents</div>
              <strong>
                {profile
                  ? [profile.w9_path, profile.coi_path, profile.license_path].filter(Boolean).length
                  : '-'} / 3
              </strong>
              <span>W-9, COI, and license tracked in the editor.</span>
            </section>
          </aside>
        </section>
      </main>
    </div>
  )
}

function DetailRow({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'bad' }) {
  return (
    <div className="fh-subdetail-profile-row">
      <span>{label}</span>
      <strong className={tone ? `is-${tone}` : undefined}>{value}</strong>
    </div>
  )
}

function SubDetailStatePage({
  title,
  message,
  loading,
  onBack,
}: {
  title: string
  message: string
  loading?: boolean
  onBack: () => void
}) {
  return (
    <div className="fh-build-page fh-subdetail-build" data-build-screen="SubDetailState">
      <header className="fh-build-topbar fh-build-topbar--no-cta">
        <button type="button" className="fh-build-secondary-btn" onClick={onBack}>
          <ChevronLeft size={15} aria-hidden="true" />
          Subs
        </button>
        <div className="fh-build-topbar__meta">
          <span>Vendor profile</span>
        </div>
      </header>
      <main className="fh-build-main">
        <section className="fh-build-card">
          {loading ? (
            <div className="fh-subdetail-loading-grid" aria-label={title}>
              <div className="v3-skeleton" />
              <div className="v3-skeleton" />
              <div className="v3-skeleton" />
            </div>
          ) : (
            <DataErrorState title={title} message={message} />
          )}
        </section>
      </main>
    </div>
  )
}

/* ============================================================
   ProfileEditor — five sections of editable vendor data.
   Local form state, single Save button, optimistic toast.
   ============================================================ */
function ProfileEditor({ profile, onSaved }: any) {
  const [form, setForm] = useState(() => ({
    name: profile.name || '',
    company: profile.company || '',
    phone: profile.phone || '',
    email: profile.email || '',
    address: profile.address || '',
    trades: (profile.trades || []).join(', '),
    ein: profile.ein || '',
    license_number: profile.license_number || '',
    insurance_carrier: profile.insurance_carrier || '',
    insurance_policy: profile.insurance_policy || '',
    insurance_expires_on: profile.insurance_expires_on || '',
    payment_method: profile.payment_method || '',
    payment_handle: profile.payment_handle || '',
    notes: profile.notes || ''
  }))
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const setField = (k: any, v: any) => {
    setForm((prev) => ({ ...prev, [k]: v }))
    setDirty(true)
  }

  const insExpiresInDays = useMemo(() => daysUntil(form.insurance_expires_on), [form.insurance_expires_on])

  async function save() {
    if (saving) return
    if (!form.name.trim()) {
      toastError('Name is required')
      return
    }
    setSaving(true)
    const trades = form.trades
      .split(',')
      .map((t: any) => t.trim())
      .filter(Boolean)
    const payload = {
      name: form.name.trim(),
      company: form.company.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      trades,
      ein: form.ein.trim() || null,
      license_number: form.license_number.trim() || null,
      insurance_carrier: form.insurance_carrier.trim() || null,
      insurance_policy: form.insurance_policy.trim() || null,
      insurance_expires_on: form.insurance_expires_on || null,
      payment_method: form.payment_method || null,
      payment_handle: form.payment_handle.trim() || null,
      notes: form.notes.trim() || null
    }
    const { data, error } = await supabase
      .from('fh_sub_profiles')
      .update(payload)
      .eq('id', profile.id)
      .select()
      .maybeSingle()
    setSaving(false)
    if (error) {
      toastError("Couldn't save", error.message)
      return
    }
    hapticSuccess()
    setDirty(false)
    onSaved?.(data)
    toastSuccess('Profile saved', data?.name || form.name)
  }

  return (
    <>
      {/* CONTACT */}
      <Section icon={<Hammer size={11} />} label="Contact">
        <Field label="Name" value={form.name} onChange={(v: any) => setField('name', v)} required />
        <Field label="Company" value={form.company} onChange={(v: any) => setField('company', v)} placeholder="Vendor company name" />
        <Row>
          <Field label="Phone" type="tel" inputMode="tel" value={form.phone} onChange={(v: any) => setField('phone', v)} placeholder="(615) 555-0100" />
          <Field label="Email" type="email" value={form.email} onChange={(v: any) => setField('email', v)} placeholder="vendor@email.com" />
        </Row>
        <Field label="Address" value={form.address} onChange={(v: any) => setField('address', v)} placeholder="Street, city, state" />
        <Field label="Trades" value={form.trades} onChange={(v: any) => setField('trades', v)} placeholder="electrical, plumbing, framing" hint="Comma-separated" />
      </Section>

      {/* INSURANCE */}
      <Section icon={<ShieldCheck size={11} />} label="Insurance">
        <Field label="Carrier" value={form.insurance_carrier} onChange={(v: any) => setField('insurance_carrier', v)} placeholder="State Farm, Liberty Mutual…" />
        <Row>
          <Field label="Policy #" value={form.insurance_policy} onChange={(v: any) => setField('insurance_policy', v)} />
          <Field label="Expires" type="date" value={form.insurance_expires_on} onChange={(v: any) => setField('insurance_expires_on', v)} />
        </Row>
        {insExpiresInDays !== null && (
          <ExpiryNote days={insExpiresInDays} />
        )}
      </Section>

      {/* BUSINESS */}
      <Section icon={<FileText size={11} />} label="Business">
        <Row>
          <Field label="EIN" value={form.ein} onChange={(v: any) => setField('ein', v)} placeholder="00-0000000" />
          <Field label="License #" value={form.license_number} onChange={(v: any) => setField('license_number', v)} />
        </Row>
      </Section>

      {/* PAYMENT */}
      <Section icon={<CreditCard size={11} />} label="Payment">
        <Row>
          <SelectField label="Method" value={form.payment_method} onChange={(v: any) => setField('payment_method', v)} options={PAYMENT_METHODS} />
          <Field
            label="Handle / Account"
            value={form.payment_handle}
            onChange={(v: any) => setField('payment_handle', v)}
            placeholder={
              form.payment_method === 'zelle' ? 'name@email.com' :
              form.payment_method === 'venmo' ? '@username' :
              form.payment_method === 'cashapp' ? '$cashtag' :
              form.payment_method === 'ach' ? 'Bank · acct …1234' :
              form.payment_method === 'check' ? 'Payee name' :
              'Identifier or label'
            }
          />
        </Row>
        <Eyebrow as="div" style={{ marginTop: 4, color: 'var(--v3-text-muted)' }}>
          Lightweight only — never store full account or routing numbers here.
        </Eyebrow>
      </Section>

      {/* DOCUMENTS */}
      <DocumentsSection profile={profile} onChanged={onSaved} />

      {/* NOTES */}
      <Section icon={<FileText size={11} />} label="Notes">
        <textarea
          value={form.notes}
          onChange={(e) => setField('notes', e.target.value)}
          placeholder="Anything to remember — scheduling quirks, crew sizes, preferred suppliers…"
          rows={4}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '12px 14px', borderRadius: 12,
            background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border-strong)',
            color: 'var(--v3-text)', fontFamily: 'var(--font-body)',
            fontSize: 13, outline: 'none', resize: 'vertical',
            lineHeight: 1.4
          }}
        />
      </Section>

      {/* STICKY SAVE */}
      <div className="fh-subdetail-savebar" style={{
        position: 'sticky',
        bottom: 80,
        margin: '0 20px',
        zIndex: 5
      }}>
        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          onClick={save}
          disabled={saving || !dirty || !form.name.trim()}
          style={{
            width: '100%',
            padding: '14px 16px', borderRadius: 14,
            border: '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)',
            background: dirty
              ? 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)'
              : 'var(--v3-surface-2)',
            color: dirty ? 'var(--v3-on-primary)' : 'var(--v3-text-muted)',
            fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
            letterSpacing: '0.06em', textTransform: 'uppercase',
            cursor: saving || !dirty ? 'default' : 'pointer',
            opacity: saving ? 0.7 : 1,
            boxShadow: dirty ? '0 0 0 2px rgba(228, 190, 111, 0.14), 0 8px 18px rgba(0, 0, 0, 0.45)' : 'none'
          }}
        >
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </motion.button>
      </div>
    </>
  )
}

/* ============================================================
   DocumentsSection — three doc slots (W-9, COI, License). Each
   slot uploads to sub-docs/<user>/<profile>/<slot>.<ext> and
   stores the path in the profile row. View opens a 60-sec
   signed URL.
   ============================================================ */
function DocumentsSection({ profile, onChanged }: any) {
  const [busySlot, setBusySlot] = useState<any>(null)
  const fileInputs = useRef({})

  async function handleUpload(slotId: any, pathField: any, file: any) {
    if (!file) return
    setBusySlot(slotId)
    try {
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
      const path = `${profile.user_id}/${profile.id}/${slotId}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('sub-docs')
        .upload(path, file, { upsert: true, contentType: file.type || undefined })
      if (upErr) throw upErr

      const { data, error } = await supabase
        .from('fh_sub_profiles')
        .update({ [pathField]: path } as any)
        .eq('id', profile.id)
        .select()
        .maybeSingle()
      if (error) throw error
      onChanged?.(data)
      toastSuccess('Uploaded', `${slotId.toUpperCase()} on file`)
      hapticSuccess()
    } catch (e: any) {
      toastError("Couldn't upload", e?.message || 'Try again')
    } finally {
      setBusySlot(null)
    }
  }

  async function handleRemove(slotId: any, pathField: any, currentPath: any) {
    if (!currentPath) return
    setBusySlot(slotId)
    try {
      // Best-effort delete; clear the DB path even if storage delete
      // fails (orphan files are tolerable, dangling DB pointers are not).
      await supabase.storage.from('sub-docs').remove([currentPath])
      const { data, error } = await supabase
        .from('fh_sub_profiles')
        .update({ [pathField]: null } as any)
        .eq('id', profile.id)
        .select()
        .maybeSingle()
      if (error) throw error
      onChanged?.(data)
      toastSuccess('Removed', `${slotId.toUpperCase()} cleared`)
    } catch (e: any) {
      toastError("Couldn't remove", e?.message || 'Try again')
    } finally {
      setBusySlot(null)
    }
  }

  async function handleView(currentPath: any) {
    if (!currentPath) return
    const { data, error } = await supabase.storage
      .from('sub-docs')
      .createSignedUrl(currentPath, 60)
    if (error || !data?.signedUrl) {
      toastError("Couldn't open file", error?.message || 'Try again')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <Section icon={<FileText size={11} />} label="Documents">
      <ul style={{
        listStyle: 'none', padding: 0, margin: 0,
        display: 'flex', flexDirection: 'column', gap: 8
      }}>
        {DOC_SLOTS.map((slot) => {
          const currentPath = profile[slot.path]
          const onFile = !!currentPath
          const busy = busySlot === slot.id
          return (
            <li key={slot.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 14px',
                borderRadius: 12,
                background: 'var(--v3-surface-2)',
                border: '1px solid var(--v3-border-strong)'
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, color: 'var(--v3-text)' }}>
                    {slot.label}
                  </span>
                  <StatusPill onFile={onFile} />
                </div>
                <div style={{ marginTop: 3, fontSize: 11, color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)' }}>
                  {slot.hint}
                </div>
              </div>

              <input
                ref={(el) => { (fileInputs.current as any)[slot.id] = el }}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.heic"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) handleUpload(slot.id, slot.path, f)
                }}
                style={{ display: 'none' }}
              />

              <div style={{ display: 'inline-flex', gap: 6, flexShrink: 0 }}>
                {onFile && (
                  <IconButton title="View" onClick={() => { hapticTap(); handleView(currentPath) }}>
                    <ExternalLink size={14} />
                  </IconButton>
                )}
                <IconButton
                  title={onFile ? 'Replace' : 'Upload'}
                  onClick={() => { hapticTap(); (fileInputs.current as any)[slot.id]?.click() }}
                  disabled={busy}
                  primary
                >
                  <Upload size={14} />
                </IconButton>
                {onFile && (
                  <IconButton
                    title="Remove"
                    danger
                    onClick={() => { hapticTap(); handleRemove(slot.id, slot.path, currentPath) }}
                    disabled={busy}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

/* ============================================================
   Tiny presentational helpers
   ============================================================ */
function BackButton({ onClick }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        alignSelf: 'flex-start',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '8px 12px 8px 8px', borderRadius: 10,
        background: 'transparent', border: '1px solid var(--v3-border)',
        color: 'var(--v3-text)', cursor: 'pointer',
        fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
        WebkitTapHighlightColor: 'transparent'
      }}
    >
      <ChevronLeft size={16} aria-hidden="true" />
      Sub Directory
    </button>
  )
}

function Section({ icon, label, children }: any) {
  void icon
  return (
    <motion.div className="v3-section fh-subdetail-section" style={{ margin: '0 20px 18px' }}>
      <SectionHeader label={label} />
      <div style={{
        marginTop: 6,
        padding: 14,
        borderRadius: 14,
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border)',
        display: 'flex', flexDirection: 'column', gap: 10
      }}>
        {children}
      </div>
    </motion.div>
  )
}

function Field({ label, value, onChange, type = 'text', inputMode, placeholder, hint, required }: any) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <Eyebrow>
        {label}{required && <span style={{ color: 'var(--v3-primary)', marginLeft: 3 }}>*</span>}
      </Eyebrow>
      <input
        type={type}
        inputMode={inputMode}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '11px 12px', borderRadius: 10,
          background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border-strong)',
          color: 'var(--v3-text)', fontFamily: 'var(--font-body)',
          fontSize: 13, outline: 'none'
        }}
      />
      {hint && (
        <span style={{ fontSize: 10, color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)' }}>
          {hint}
        </span>
      )}
    </label>
  )
}

function SelectField({ label, value, onChange, options }: any) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <Eyebrow>
        {label}
      </Eyebrow>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '11px 12px', borderRadius: 10,
          background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border-strong)',
          color: 'var(--v3-text)', fontFamily: 'var(--font-body)',
          fontSize: 13, outline: 'none', appearance: 'none'
        }}
      >
        {options.map((o: any) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}

function Row({ children }: any) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {children}
    </div>
  )
}

function ExpiryNote({ days }: any) {
  const expired = days < 0
  const soon = !expired && days <= 30
  if (!expired && !soon) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)' }}>
        <CheckCircle2 size={12} color="currentColor" />
        Renews in {days} days
      </div>
    )
  }
  return (
    <Eyebrow as="div" style={{ padding: '6px 10px', borderRadius: 8, background: expired
        ? 'color-mix(in srgb, var(--v3-danger, #c84a4a) 16%, transparent)'
        : 'var(--v3-primary-soft)', border: `1px solid ${expired
        ? 'color-mix(in srgb, var(--v3-danger, #c84a4a) 50%, transparent)'
        : 'color-mix(in srgb, var(--v3-primary) 36%, transparent)'}`, color: expired ? 'var(--v3-danger-bright, #ff8b8b)' : 'var(--v3-primary)' }}>
      <AlertTriangle size={12} />
      {expired ? `Expired ${Math.abs(days)}d ago` : `Expires in ${days}d`}
    </Eyebrow>
  )
}

function StatusPill({ onFile }: any) {
  return (
    <Eyebrow style={{ padding: '2px 7px', borderRadius: 999, background: onFile ? 'var(--v3-primary-soft)' : 'var(--v3-surface)', border: `1px solid ${onFile
        ? 'color-mix(in srgb, var(--v3-primary) 32%, transparent)'
        : 'var(--v3-border)'}`, color: onFile ? 'var(--v3-primary)' : 'var(--v3-text-muted)' }}>
      {onFile ? 'On file' : 'Missing'}
    </Eyebrow>
  )
}

function IconButton({ children, onClick, disabled, primary, danger, title }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      style={{
        width: 36, height: 36,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 10,
        border: `1px solid ${danger
          ? 'color-mix(in srgb, var(--v3-danger, #c84a4a) 40%, transparent)'
          : primary
          ? 'color-mix(in srgb, var(--v3-primary) 50%, transparent)'
          : 'var(--v3-border-strong)'}`,
        background: primary
          ? 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)'
          : danger
          ? 'transparent'
          : 'var(--v3-surface)',
        color: primary
          ? 'var(--v3-on-primary)'
          : danger
          ? 'var(--v3-danger-bright, #ff8b8b)'
          : 'var(--v3-text)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        WebkitTapHighlightColor: 'transparent'
      }}
    >
      {children}
    </button>
  )
}
