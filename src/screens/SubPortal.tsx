// SubPortal — /sub-portal.
//
// Landing for subcontractors / accepted partners. Phase D pass 2:
//   - Invitations list (read-only — direct fh_job_partners query)
//   - Sub profile section (read + edit via /api/sub-profile-update)
//   - Document uploads (COI / W-9 / License) via signed-upload-URL
//   - Payment history (service-role fetch via /api/sub-portal-context
//     because fh_payments RLS is org-scoped)
//
// One round trip via /api/sub-portal-context returns profiles,
// invites, jobs, and payments together. Document uploads go through
// a sign + PUT + confirm dance; profile metadata writes go through
// the update endpoint so the same insurance info propagates to every
// GC that has this sub on file.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell, MapPin, Search, ChevronRight, ShieldCheck, Briefcase,
  AlertTriangle, Mail, Edit2, Upload, Check, X, FileText,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import {
  subPortalContext, subProfileUpdate, subUploadDoc, subDocSignedUrl,
  type SubPortalContext, type DocKind, type SubProfile, type SubProfileUpdate,
} from '../lib/subApi.ts'
import { toastSuccess, toastError } from '../lib/toast.ts'
import MiniMetric from '../components/MiniMetric.tsx'
import DataErrorState from '../components/DataErrorState.tsx'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return '—' }
}

function fmtMoney(n: number | null): string {
  if (n == null) return '—'
  return `$${Math.round(Number(n)).toLocaleString()}`
}

function stageTone(stage: string | null): 'good' | 'warn' | 'bad' | 'neutral' {
  const s = String(stage || '').toLowerCase()
  if (s === 'job' || s === 'closed') return 'good'
  if (s === 'invoice' || s === 'quote' || s === 'lead') return 'warn'
  if (s === 'lost') return 'bad'
  return 'neutral'
}

function stageLabel(stage: string | null): string {
  const s = String(stage || '').toLowerCase()
  switch (s) {
    case 'lead':    return 'Lead'
    case 'quote':   return 'Quoting'
    case 'job':     return 'Active'
    case 'invoice': return 'Invoicing'
    case 'closed':  return 'Completed'
    case 'lost':    return 'Lost'
    default:        return stage || '—'
  }
}

function insuranceStatus(iso: string | null): { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } {
  if (!iso) return { label: 'Not on file', tone: 'neutral' }
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return { label: 'Unknown', tone: 'neutral' }
  const days = (t - Date.now()) / 86_400_000
  if (days < 0) return { label: 'Expired', tone: 'bad' }
  if (days < 30) return { label: 'Expires soon', tone: 'warn' }
  return { label: 'Current', tone: 'good' }
}

// Merge fields across multiple matched profiles. When a sub works
// for several GCs we surface ONE combined view of editable fields,
// preferring the most-recently-updated non-null value per field.
function mergedProfile(profiles: SubProfile[]): SubProfile | null {
  if (profiles.length === 0) return null
  // Profiles arrive sorted by updated_at desc already.
  const out: any = { ...profiles[0] }
  for (let i = 1; i < profiles.length; i++) {
    for (const k of Object.keys(profiles[i] || {})) {
      if (out[k] == null && (profiles[i] as any)[k] != null) {
        out[k] = (profiles[i] as any)[k]
      }
    }
  }
  return out as SubProfile
}

export default function SubPortal() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { loading: memLoading, orgId } = useMembership()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ctx, setCtx] = useState<SubPortalContext | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [uploading, setUploading] = useState<DocKind | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const res = await subPortalContext()
      setCtx(res)
    } catch (e: any) {
      setError(e?.detail || e?.message || 'Could not load portal data.')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { if (!memLoading) load() }, [memLoading, load])

  const profile = useMemo(() => mergedProfile(ctx?.matched_profiles || []), [ctx])
  const partners = ctx?.accepted_partners || []
  const jobs = ctx?.linked_jobs || {}
  const payments = ctx?.payments || []

  const stats = useMemo(() => {
    const active = partners.filter((p) => {
      const s = String(jobs[p.job_id]?.stage || '').toLowerCase()
      return s === 'job' || s === 'invoice'
    }).length
    const completed = partners.filter((p) => String(jobs[p.job_id]?.stage || '').toLowerCase() === 'closed').length
    const trades = Array.from(new Set(partners.map((p) => p.partner_role || '').filter(Boolean)))
    return { active, completed, total: partners.length, trades }
  }, [partners, jobs])

  // YTD paid: every payment paid in the current calendar year
  const ytdPaid = useMemo(() => {
    const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime()
    return payments.reduce((sum, p) => {
      const t = new Date(p.paid_on || p.created_at || 0).getTime()
      if (Number.isFinite(t) && t >= yearStart) return sum + Number(p.amount || 0)
      return sum
    }, 0)
  }, [payments])

  async function handleUpload(kind: DocKind, file: File | null) {
    if (!file) return
    setUploading(kind)
    try {
      await subUploadDoc(file, kind)
      toastSuccess(`${kind.toUpperCase()} uploaded`)
      await load()
    } catch (e: any) {
      toastError('Upload failed', e?.detail || e?.message || '')
    } finally {
      setUploading(null)
    }
  }

  const ins = insuranceStatus(profile?.insurance_expires_on || null)

  return (
    <div className="fh-build-page" data-build-screen="SubPortal" data-build-route="/sub-portal">
      <header className="fh-build-topbar fh-build-topbar--no-cta">
        <button
          type="button"
          className="fh-build-search"
          onClick={() => window.dispatchEvent(new CustomEvent('fh:open-palette'))}
          aria-label="Open command palette"
        >
          <Search size={14} />
          <span>Search…</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="fh-build-topbar__meta">
          <span>{user?.email || 'Sub portal'}</span>
          <span className="fh-build-vline" />
          <span style={{ opacity: 0.6 }}>Partner workspace</span>
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
            <div className="fh-build-good">Sub portal</div>
            <h1 className="fh-build-title">YOUR JOBS.</h1>
          </div>

          <div className="fh-build-focus">
            <div className="fh-build-eyebrow">Signed in as</div>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--v3-text)', margin: '8px 0 4px', wordBreak: 'break-all' }}>
              {user?.email || '—'}
            </p>
            <p>
              {orgId
                ? 'You also belong to an organization. Use the main sidebar for your owner / crew tools.'
                : 'Manage your insurance, W-9, and payments across every contractor that has you on file.'}
            </p>
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Active jobs" value={String(stats.active)} accent />
            <MiniMetric label="Completed" value={String(stats.completed)} />
            <MiniMetric label="Paid YTD" value={fmtMoney(ytdPaid)} />
            <MiniMetric
              label="Insurance"
              value={ins.label}
              tone={ins.tone === 'bad' ? 'bad' : ins.tone === 'warn' ? 'warn' : undefined}
            />
          </div>
        </section>

        {error && (
          <div className="fh-build-banner is-warn">
            <AlertTriangle size={14} />
            <span>{error}</span>
            <button type="button" className="fh-build-banner__cta" onClick={load} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}>Retry →</button>
          </div>
        )}

        {loading && (
          <div className="fh-build-table__empty">Loading your portal…</div>
        )}

        {!loading && !error && (
          <section className="fh-build-content-grid fh-build-content-grid--jobs">

            {/* MAIN — invitations + payments + profile */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>

              {/* Profile + docs */}
              <section className="fh-build-card">
                <header className="fh-build-card-head">
                  <div className="fh-build-eyebrow">
                    <ShieldCheck size={11} style={{ display: 'inline', marginRight: 6, verticalAlign: '-1px' }} />
                    Your profile
                  </div>
                  {profile && (
                    <button type="button" onClick={() => setEditOpen(true)}>
                      <Edit2 size={11} aria-hidden="true" style={{ marginRight: 4 }} />
                      Edit
                    </button>
                  )}
                </header>

                {!profile ? (
                  <div style={{ padding: '8px 22px 22px' }}>
                    <DataErrorState
                      compact
                      title="No contractor profile yet"
                      message="Once a contractor adds you to a job, your profile appears here for insurance, tax info, and payment details."
                    />
                  </div>
                ) : (
                  <div style={{ padding: '8px 22px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <ProfileRow label="Name on file" value={profile.name || '—'} muted />
                    <ProfileRow label="Company" value={profile.company || '—'} muted />
                    <ProfileRow label="Phone" value={profile.phone || '—'} />
                    <ProfileRow label="Address" value={profile.address || '—'} />
                    <ProfileRow label="EIN" value={profile.ein || '—'} />
                    <ProfileRow
                      label="Insurance carrier"
                      value={profile.insurance_carrier || 'Not provided'}
                      tone={profile.insurance_carrier ? undefined : 'warn'}
                    />
                    <ProfileRow
                      label="Insurance policy #"
                      value={profile.insurance_policy || '—'}
                    />
                    <ProfileRow
                      label="Insurance expires"
                      value={profile.insurance_expires_on ? fmtDate(profile.insurance_expires_on) : 'Not on file'}
                      tone={ins.tone === 'bad' ? 'bad' : ins.tone === 'warn' ? 'warn' : undefined}
                    />
                    <ProfileRow label="License #" value={profile.license_number || '—'} />
                    <ProfileRow label="Payment method" value={profile.payment_method || '—'} />
                    <ProfileRow label="Payment handle" value={profile.payment_handle || '—'} />

                    <div style={{ borderTop: '1px solid var(--v3-glass-tint-2)', paddingTop: 14, marginTop: 4 }}>
                      <div className="fh-build-eyebrow" style={{ marginBottom: 10 }}>Documents</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                        <DocSlot
                          kind="coi"
                          label="Certificate of insurance"
                          path={profile.coi_path}
                          uploading={uploading === 'coi'}
                          onUpload={(f) => handleUpload('coi', f)}
                        />
                        <DocSlot
                          kind="w9"
                          label="W-9 tax form"
                          path={profile.w9_path}
                          uploading={uploading === 'w9'}
                          onUpload={(f) => handleUpload('w9', f)}
                        />
                        <DocSlot
                          kind="license"
                          label="License"
                          path={profile.license_path}
                          uploading={uploading === 'license'}
                          onUpload={(f) => handleUpload('license', f)}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* Invitations */}
              <section className="fh-build-card fh-build-table">
                <header className="fh-build-card-head">
                  <div className="fh-build-eyebrow">
                    <Briefcase size={11} style={{ display: 'inline', marginRight: 6, verticalAlign: '-1px' }} />
                    Active invitations · {partners.length}
                  </div>
                </header>

                {partners.length === 0 ? (
                  <div className="fh-build-table__empty">No accepted invites yet. When a GC invites you, the link goes to <strong style={{ color: 'var(--v3-text)' }}>{user?.email || 'your email'}</strong>.</div>
                ) : (
                  <>
                    <div className="fh-build-table__head is-subportal">
                      <span>Job</span>
                      <span>Address</span>
                      <span>Role</span>
                      <span>Stage</span>
                      <span>Accepted</span>
                      <span />
                    </div>
                    {partners.map((p) => {
                      const j = jobs[p.job_id]
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className="fh-build-table__row is-subportal"
                          onClick={() => navigate(`/jobs/${p.job_id}`)}
                        >
                          <strong className="fh-build-truncate" title={j?.name || ''}>{j?.name || 'Untitled job'}</strong>
                          <span className="fh-build-truncate fh-build-rel" title={j?.address || ''}>
                            {j?.address ? <><MapPin size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: '-1px' }} />{j.address}</> : '—'}
                          </span>
                          <span className="fh-build-rel" style={{ textTransform: 'capitalize' }}>
                            {p.partner_role || 'Partner'}
                          </span>
                          <span>
                            <span className={`fh-build-dot is-${stageTone(j?.stage || null)}`}>
                              {stageLabel(j?.stage || null)}
                            </span>
                          </span>
                          <span className="fh-build-rel">{fmtDate(p.accepted_at)}</span>
                          <ChevronRight size={13} color="var(--v3-text-faint)" />
                        </button>
                      )
                    })}
                  </>
                )}
              </section>

              {/* Payments */}
              <section className="fh-build-card fh-build-table">
                <header className="fh-build-card-head">
                  <div className="fh-build-eyebrow">
                    Payments · {payments.length}
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--v3-text-muted)' }}>
                    YTD {fmtMoney(ytdPaid)}
                  </span>
                </header>
                {payments.length === 0 ? (
                  <div className="fh-build-table__empty">No payments recorded yet for the jobs you're on.</div>
                ) : (
                  <>
                    <div className="fh-build-table__head is-subportal-pay">
                      <span>Job</span>
                      <span>Date</span>
                      <span>Kind</span>
                      <span>Method</span>
                      <span>Amount</span>
                    </div>
                    {payments.slice(0, 50).map((pmt) => {
                      const j = pmt.contact_id ? jobs[pmt.contact_id] : null
                      return (
                        <div
                          key={pmt.id}
                          className="fh-build-table__row is-subportal-pay is-clickable"
                          role="button"
                          tabIndex={0}
                          onClick={() => pmt.contact_id && navigate(`/jobs/${pmt.contact_id}`)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && pmt.contact_id) navigate(`/jobs/${pmt.contact_id}`) }}
                        >
                          <strong className="fh-build-truncate">{j?.name || 'Job'}</strong>
                          <span className="fh-build-rel">{fmtDate(pmt.paid_on || pmt.created_at)}</span>
                          <span className="fh-build-rel" style={{ textTransform: 'capitalize' }}>{pmt.kind || '—'}</span>
                          <span className="fh-build-rel">{pmt.method || '—'}</span>
                          <span className="fh-build-num" style={{ color: 'var(--v3-primary, #c9963a)', fontWeight: 700 }}>
                            {fmtMoney(Number(pmt.amount))}
                          </span>
                        </div>
                      )
                    })}
                    {payments.length > 50 && (
                      <div className="fh-build-table__more">Showing the 50 most recent.</div>
                    )}
                  </>
                )}
              </section>
            </div>

            {/* RAIL — quick links + help */}
            <aside className="fh-build-rail fh-build-rail--page">
              <section className="fh-build-rail-card">
                <div className="fh-build-eyebrow">Trades on file</div>
                {stats.trades.length === 0 ? (
                  <>
                    <strong>—</strong>
                    <span>No trade tags on your accepted invites.</span>
                  </>
                ) : (
                  <ul className="fh-build-rail-list" style={{ marginTop: 10 }}>
                    {stats.trades.slice(0, 6).map((t) => (
                      <li key={t} style={{ gridTemplateColumns: '1fr' }}>
                        <span className="fh-build-rail-list__title" style={{ textTransform: 'capitalize' }}>{t}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="fh-build-rail-card">
                <div className="fh-build-eyebrow">Insurance</div>
                <strong style={{ color: ins.tone === 'bad' ? '#ee4942' : ins.tone === 'warn' ? '#e0a141' : ins.tone === 'good' ? '#73c982' : undefined }}>
                  {ins.label}
                </strong>
                <span>
                  {profile?.insurance_expires_on
                    ? `Expires ${fmtDate(profile.insurance_expires_on)}`
                    : 'Add expiry + COI to keep contractors current.'}
                </span>
                {profile && (
                  <button type="button" className="fh-build-rail-card__action" onClick={() => setEditOpen(true)}>
                    Update <ChevronRight size={13} />
                  </button>
                )}
              </section>

              <section className="fh-build-rail-card">
                <div className="fh-build-eyebrow">Need help?</div>
                <a
                  href="mailto:support@fieldhorse.com"
                  className="fh-build-rail-card__action"
                  style={{ textDecoration: 'none' }}
                >
                  <Mail size={13} aria-hidden="true" /> Contact support
                </a>
                <span style={{ display: 'block', marginTop: 6 }}>
                  For invitation issues, contact the GC who sent the invite.
                </span>
              </section>
            </aside>
          </section>
        )}
      </main>

      {editOpen && profile && (
        <EditProfileDialog
          initial={profile}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); load() }}
        />
      )}
    </div>
  )
}

function ProfileRow({ label, value, tone, muted }: { label: string; value: string; tone?: 'warn' | 'bad'; muted?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 180px) minmax(0, 1fr)', gap: 14, alignItems: 'baseline' }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'var(--v3-text-muted)' }}>
        {label}
      </span>
      <span style={{
        fontSize: 14,
        color: muted ? 'var(--v3-text-muted)' : tone === 'bad' ? '#ee4942' : tone === 'warn' ? '#e0a141' : 'var(--v3-text)',
        wordBreak: 'break-word',
      }}>
        {value}
      </span>
    </div>
  )
}

function DocSlot({ kind, label, path, uploading, onUpload }: {
  kind: DocKind
  label: string
  path: string | null
  uploading: boolean
  onUpload: (f: File | null) => void
}) {
  const ref = useRef<HTMLInputElement | null>(null)
  const [opening, setOpening] = useState(false)

  async function viewDoc() {
    if (!path) return
    setOpening(true)
    try {
      const url = await subDocSignedUrl(path, 600)
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
      else toastError("Couldn't open document")
    } finally {
      setOpening(false)
    }
  }

  return (
    <div
      style={{
        position: 'relative',
        padding: 14,
        borderRadius: 8,
        background: path
          ? 'color-mix(in srgb, var(--v3-primary, #c9963a) 8%, transparent)'
          : 'var(--v3-glass-tint)',
        border: path
          ? '1px solid color-mix(in srgb, var(--v3-primary, #c9963a) 28%, transparent)'
          : '1px solid var(--v3-border-mid)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <FileText size={14} aria-hidden="true" style={{ color: path ? 'var(--v3-primary, #c9963a)' : 'var(--v3-text-muted)' }} />
        <strong style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--v3-text)' }}>
          {label}
        </strong>
      </div>
      <div style={{ fontSize: 12, color: path ? '#73c982' : 'var(--v3-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {path ? <><Check size={12} aria-hidden="true" /> On file</> : 'Not uploaded'}
      </div>
      <input
        ref={ref}
        type="file"
        accept=".pdf,image/*"
        style={{ display: 'none' }}
        onChange={(e) => onUpload(e.target.files?.[0] || null)}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={uploading}
          className="fh-build-secondary-btn"
          style={{ flex: 1, justifyContent: 'center' }}
        >
          <Upload size={11} aria-hidden="true" style={{ marginRight: 4 }} />
          {uploading ? 'Uploading…' : path ? 'Replace' : 'Upload'}
        </button>
        {path && (
          <button
            type="button"
            onClick={viewDoc}
            disabled={opening}
            className="fh-build-secondary-btn"
          >
            {opening ? '…' : 'View'}
          </button>
        )}
      </div>
    </div>
  )
}

function EditProfileDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: SubProfile
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<SubProfileUpdate>({
    phone: initial.phone,
    address: initial.address,
    ein: initial.ein,
    insurance_carrier: initial.insurance_carrier,
    insurance_policy: initial.insurance_policy,
    insurance_expires_on: initial.insurance_expires_on,
    license_number: initial.license_number,
    payment_handle: initial.payment_handle,
    payment_method: initial.payment_method,
    notes: initial.notes,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  function set<K extends keyof SubProfileUpdate>(key: K, value: SubProfileUpdate[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await subProfileUpdate(form)
      toastSuccess('Profile updated')
      onSaved()
    } catch (e: any) {
      setError(e?.detail || e?.message || 'Update failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit sub profile"
      style={{
        position: 'fixed', inset: 0, zIndex: 90,
        background: 'rgba(0,0,0,.55)',
        display: 'grid', placeItems: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 520,
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          padding: 24,
          borderRadius: 12,
          background: 'linear-gradient(180deg, rgba(19,22,27,.95), rgba(9,11,14,.98))',
          border: '1px solid var(--v3-border-mid)',
          boxShadow: '0 22px 60px rgba(0,0,0,.50)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="fh-build-eyebrow" style={{ color: 'var(--v3-primary, #c9963a)' }}>Edit profile</div>
            <h2 style={{ margin: '6px 0 18px', fontFamily: 'var(--font-display, "Bebas Neue", Impact, sans-serif)', fontSize: 24, letterSpacing: '.005em', color: 'var(--v3-text)' }}>
              Keep your details current.
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: 'var(--v3-text-muted)', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--v3-text-muted)' }}>
          Updates apply to every contractor that has you on file. They can't change
          your name, company, or email — those stay under each GC's control.
        </p>

        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="Phone" value={form.phone ?? ''} onChange={(v) => set('phone', v)} />
          <Field label="Address" value={form.address ?? ''} onChange={(v) => set('address', v)} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="EIN" value={form.ein ?? ''} onChange={(v) => set('ein', v)} />
            <Field label="License #" value={form.license_number ?? ''} onChange={(v) => set('license_number', v)} />
          </div>

          <div style={{ borderTop: '1px solid var(--v3-border-mid)', paddingTop: 12, marginTop: 6 }}>
            <div className="fh-build-eyebrow" style={{ marginBottom: 8 }}>Insurance</div>
            <div style={{ display: 'grid', gap: 12 }}>
              <Field label="Carrier" value={form.insurance_carrier ?? ''} onChange={(v) => set('insurance_carrier', v)} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Policy #" value={form.insurance_policy ?? ''} onChange={(v) => set('insurance_policy', v)} />
                <Field label="Expires" type="date" value={form.insurance_expires_on ?? ''} onChange={(v) => set('insurance_expires_on', v || null)} />
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--v3-border-mid)', paddingTop: 12, marginTop: 6 }}>
            <div className="fh-build-eyebrow" style={{ marginBottom: 8 }}>Payments</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Method" value={form.payment_method ?? ''} onChange={(v) => set('payment_method', v)} placeholder="ACH / Check / Zelle / Venmo…" />
              <Field label="Handle / acct" value={form.payment_handle ?? ''} onChange={(v) => set('payment_handle', v)} placeholder="@you or last-4" />
            </div>
          </div>
        </div>

        {error && (
          <div style={{ marginTop: 14, padding: 10, borderRadius: 6, background: 'rgba(238,73,66,.10)', border: '1px solid rgba(238,73,66,.30)', color: '#ee4942', fontSize: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" className="fh-build-secondary-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="fh-build-primary-btn" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label, value, onChange, placeholder, type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="fh-build-eyebrow">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '10px 12px',
          borderRadius: 6,
          background: 'rgba(0,0,0,.30)',
          border: '1px solid var(--v3-border-mid)',
          color: 'var(--v3-text)',
          fontFamily: 'var(--font-body)',
          fontSize: 14,
          outline: 'none',
        }}
      />
    </label>
  )
}
