// Team — /team. Org member roster + invite management.
//
// Authenticated; visible to all org members so foremen/crew can see
// who else is on the team. Invite + revoke buttons are role-gated by
// canManageTeam (owner/admin only) — the backend re-checks the same
// gate, so hiding the UI is a courtesy, not security.

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell, ChevronRight, Copy, Plus, Search, Trash2, UserPlus, Mail, X,
} from 'lucide-react'
import { useMembership } from '../contexts/MembershipContext.tsx'
import {
  orgInviteCreate, orgInviteRevoke, orgMembersList, orgMemberRemove, orgMemberRole, orgMemberRate,
  type OrgInvitePending, type OrgMember,
} from '../lib/orgApi.ts'
import type { OrgRole } from '../lib/permissions.ts'
import { ORG_ROLES } from '../lib/permissions.ts'
import { toastSuccess, toastError } from '../lib/toast.ts'
import MiniMetric from '../components/MiniMetric.tsx'
import { useConfirm } from '../components/ConfirmSheet.tsx'
import { Eyebrow } from '../components/v3'

function fmtJoined(iso: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtExpires(iso: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const days = Math.round((t - Date.now()) / 86_400_000)
  if (days < 0) return 'expired'
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `${days}d`
}

export default function Team() {
  const navigate = useNavigate()
  const { orgName, role, loading: membershipLoading, canManageTeam, canInviteMembers } = useMembership()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [invites, setInvites] = useState<OrgInvitePending[]>([])
  const [inviteOpen, setInviteOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await orgMembersList()
      setMembers(res.members || [])
      setInvites(res.invites || [])
    } catch (e: any) {
      setError(e?.detail || e?.message || 'Could not load team.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Only call once the membership context has resolved — avoids a
    // 403 from the backend during the brief signed-in-but-no-membership
    // window.
    if (!membershipLoading) load()
  }, [membershipLoading, load])

  const activeCount = members.length
  const ownerCount = members.filter((m) => m.role === 'owner').length
  const fieldCount = members.filter((m) => m.role === 'foreman' || m.role === 'crew').length

  return (
    <div className="fh-build-page" data-build-screen="Team">
      <header className="fh-build-topbar fh-build-topbar--no-cta">
        <button
          type="button"
          className="fh-build-search"
          onClick={() => window.dispatchEvent(new CustomEvent('fh:open-palette'))}
          aria-label="Open command palette"
        >
          <Search size={14} />
          <span>Search jobs, clients, invoices, notes...</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="fh-build-topbar__meta">
          <span>{orgName || 'Your team'}</span>
          <span className="fh-build-vline" />
          <span style={{ opacity: 0.6 }}>Weather not set</span>
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
            <div className="fh-build-good">Team</div>
            <h1 className="fh-build-title">FIELD ROSTER.</h1>
          </div>

          <div className="fh-build-focus">
            <div className="fh-build-eyebrow">Your role</div>
            <p style={{ fontSize: 17, fontWeight: 700, color: 'var(--v3-text)', margin: '8px 0 4px', textTransform: 'capitalize' }}>
              {role || 'No membership'}
            </p>
            {canInviteMembers && (
              <button
                type="button"
                className="fh-build-primary-btn"
                style={{ marginTop: 10 }}
                onClick={() => setInviteOpen(true)}
              >
                <UserPlus size={13} /> Invite teammate
              </button>
            )}
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Active members" value={loading ? '—' : String(activeCount)} accent />
            <MiniMetric label="Owners + admins" value={loading ? '—' : String(ownerCount + members.filter((m) => m.role === 'admin').length)} />
            <MiniMetric label="Foremen + crew" value={loading ? '—' : String(fieldCount)} />
            <MiniMetric label="Pending invites" value={loading ? '—' : String(invites.length)} tone={!loading && invites.length > 0 ? 'warn' : undefined} />
          </div>
        </section>

        {error && (
          <div className="fh-build-banner is-warn" style={{ cursor: 'default' }}>
            <X size={14} />
            <span>{error}</span>
            <button type="button" className="fh-build-banner__cta" onClick={load} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}>Retry →</button>
          </div>
        )}

        <section className="fh-build-content-grid fh-build-content-grid--clients">
          <section className="fh-build-card fh-build-table">
            <header className="fh-build-card-head">
              <div className="fh-build-eyebrow">Active members · {members.length}</div>
            </header>

            <div className="fh-build-table__head is-team">
              <span>Name</span>
              <span>Email</span>
              <span>Role</span>
              <span>Joined</span>
              <span />
            </div>

            {loading && (
              <div className="fh-build-table__empty">Loading team…</div>
            )}
            {!loading && members.length === 0 && (
              <div className="fh-build-table__empty">No active members yet.</div>
            )}
            {!loading && members.map((m) => (
              <div key={m.id} className="fh-build-table__row is-team">
                <strong className="fh-build-truncate" title={m.name || ''}>
                  {m.name || (m.is_self ? 'You' : '—')}
                  {m.is_self && <Eyebrow tone="gold" style={{ marginLeft: 8 }}>You</Eyebrow>}
                </strong>
                <span className="fh-build-truncate fh-build-rel" title={m.email || ''}>{m.email || '—'}</span>
                <span style={{ textTransform: 'capitalize' }}><span className={`fh-build-dot is-${roleTone(m.role)}`}>{m.role}</span></span>
                <span className="fh-build-rel">{fmtJoined(m.joined_at)}</span>
                <MemberActions
                  member={m}
                  callerRole={role}
                  canManage={canManageTeam}
                  onChanged={load}
                />
              </div>
            ))}
          </section>

          <aside className="fh-build-rail fh-build-rail--page">
            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Pending invites · {invites.length}</div>
              {invites.length === 0 ? (
                <>
                  <strong>None</strong>
                  <span>No outstanding invitations</span>
                </>
              ) : (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {invites.map((inv) => (
                    <div key={inv.id} className="fh-build-invite-row">
                      <div className="fh-build-invite-row__main">
                        <span className="fh-build-invite-row__email" title={inv.email}>{inv.email}</span>
                        <span className="fh-build-invite-row__meta">
                          <span style={{ textTransform: 'capitalize' }}>{inv.role}</span>
                          {' · '}exp {fmtExpires(inv.expires_at)}
                        </span>
                      </div>
                      {canManageTeam && (
                        <button
                          type="button"
                          className="fh-build-icon-action is-danger"
                          aria-label="Revoke invite"
                          title="Revoke invite"
                          onClick={async () => {
                            try {
                              await orgInviteRevoke(inv.id)
                              toastSuccess('Invite revoked')
                              load()
                            } catch (e: any) {
                              toastError('Revoke failed', e?.message || '')
                            }
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Crew portal</div>
              <strong>Phase B</strong>
              <span>Own schedule, own time, own tasks ship in /crew next.</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Subs / vendors</div>
              <strong>Separate</strong>
              <span>One-off vendor bench lives at /subs. This page is the recurring team.</span>
              <button type="button" className="fh-build-rail-card__action" onClick={() => navigate('/subs')}>
                Open subs <ChevronRight size={13} />
              </button>
            </section>
          </aside>
        </section>
      </main>

      {inviteOpen && canInviteMembers && (
        <InviteDialog
          callerRole={role}
          onClose={() => setInviteOpen(false)}
          onSent={() => { setInviteOpen(false); load() }}
        />
      )}
    </div>
  )
}

function roleTone(role: OrgRole): 'good' | 'warn' | 'neutral' {
  if (role === 'owner' || role === 'admin') return 'good'
  if (role === 'manager' || role === 'foreman') return 'warn'
  return 'neutral'
}

const ROLE_TIER: Record<string, number> = { crew: 0, foreman: 1, manager: 2, admin: 3, owner: 4 }

/* Per-member management: change role (to a tier below yours) or remove.
   Only shown when the caller can manage the team AND outranks the member
   — mirrors the server guards in org-member-role/remove. */
function MemberActions({ member, callerRole, canManage, onChanged }: any) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [rate, setRate] = useState(member.default_hourly_rate != null ? String(member.default_hourly_rate) : '')

  async function saveRate() {
    const trimmed = rate.trim()
    const next = trimmed === '' ? null : Number(trimmed)
    // No-op if unchanged.
    const current = member.default_hourly_rate ?? null
    if ((next ?? null) === current) return
    if (next != null && (!Number.isFinite(next) || next < 0)) {
      toastError('Invalid rate', 'Enter a number ≥ 0, or clear it.')
      setRate(current != null ? String(current) : '')
      return
    }
    setBusy(true)
    try {
      await orgMemberRate(member.user_id, next)
      toastSuccess('Rate saved', `${member.name || member.email || 'Member'} · ${next != null ? '$' + next + '/hr' : 'cleared'}`)
      onChanged?.()
    } catch (e: any) {
      toastError("Couldn't save rate", e?.message || 'Try again')
      // The server rejected it (e.g. rate ≥ 10000) — snap the field back
      // to the member's real rate so the screen doesn't read as if the
      // rejected value was saved.
      setRate(current != null ? String(current) : '')
    } finally { setBusy(false) }
  }
  const callerTier = ROLE_TIER[callerRole || ''] ?? 0
  const targetTier = ROLE_TIER[member.role] ?? 0
  const manageable = canManage && !member.is_self && targetTier < callerTier
  if (!manageable) {
    return <span style={{ color: 'var(--v3-text-faint)', fontSize: 11 }}>{member.is_self ? '—' : ''}</span>
  }
  const roleOptions = ORG_ROLES.filter((r) => (ROLE_TIER[r] ?? 0) < callerTier)

  async function changeRole(next: OrgRole) {
    if (busy || next === member.role) return
    setBusy(true)
    try {
      await orgMemberRole(member.user_id, next)
      toastSuccess('Role updated', `${member.name || member.email || 'Member'} → ${next}`)
      onChanged?.()
    } catch (e: any) {
      toastError("Couldn't change role", e?.message || 'Try again')
    } finally { setBusy(false) }
  }

  async function remove() {
    if (busy) return
    if (!(await confirm({ title: `Remove ${member.name || member.email || 'this member'} from the team?`, body: 'They lose access immediately.', destructive: true, confirmLabel: 'Remove' }))) return
    setBusy(true)
    try {
      await orgMemberRemove(member.user_id)
      toastSuccess('Member removed', member.name || member.email || '')
      onChanged?.()
    } catch (e: any) {
      toastError("Couldn't remove member", e?.message || 'Try again')
    } finally { setBusy(false) }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }} title="Crew hourly rate — feeds job labor cost">
        <span style={{ color: 'var(--v3-text-muted, rgba(245,242,234,.5))', fontSize: 11 }}>$</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={rate}
          disabled={busy}
          onChange={(e) => setRate(e.target.value)}
          onBlur={saveRate}
          onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur() } }}
          placeholder="—"
          aria-label={`Hourly rate for ${member.name || member.email || 'member'}`}
          className="fh-build-select"
          style={{ width: 56, fontSize: 11, padding: '3px 6px' }}
        />
        <span style={{ color: 'var(--v3-text-muted, rgba(245,242,234,.5))', fontSize: 10 }}>/hr</span>
      </span>
      <select
        value={member.role}
        disabled={busy}
        onChange={(e) => changeRole(e.target.value as OrgRole)}
        className="fh-build-select"
        style={{ fontSize: 11, padding: '3px 6px' }}
        aria-label="Change role"
      >
        <option value={member.role} style={{ textTransform: 'capitalize' }}>{member.role}</option>
        {roleOptions.filter((r) => r !== member.role).map((r) => (
          <option key={r} value={r} style={{ textTransform: 'capitalize' }}>{r}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        aria-label="Remove member"
        title="Remove member"
        style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'rgba(232,90,87,0.8)' }}
      >
        <Trash2 size={13} />
      </button>
    </span>
  )
}

function InviteDialog({ callerRole, onClose, onSent }: { callerRole: OrgRole | null; onClose: () => void; onSent: () => void }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<OrgRole>('crew')
  // Only roles strictly below the caller's tier are invitable — mirrors
  // the server guard in org-invite-create.js so an admin can't mint an
  // owner (or another admin) from the UI.
  const callerTier = ROLE_TIER[callerRole || ''] ?? 0
  const invitableRoles = ORG_ROLES.filter((r) => (ROLE_TIER[r] ?? 0) < callerTier)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [acceptUrl, setAcceptUrl] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSending(true)
    try {
      const res = await orgInviteCreate(email.trim().toLowerCase(), role)
      setAcceptUrl(res.accept_url)
    } catch (e: any) {
      setError(e?.detail || e?.message || 'Could not create invite.')
    } finally {
      setSending(false)
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toastSuccess('Link copied')
    } catch {
      toastError('Copy failed — long-press to copy')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Invite teammate"
      style={{
        position: 'fixed', inset: 0, zIndex: 90,
        background: 'rgba(0,0,0,.55)',
        display: 'grid', placeItems: 'center',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 440,
          margin: '0 16px',
          padding: 24,
          borderRadius: 12,
          background: 'linear-gradient(180deg, rgba(19,22,27,.95), rgba(9,11,14,.98))',
          border: '1px solid var(--v3-border-mid)',
          boxShadow: '0 22px 60px rgba(0,0,0,.50)',
        }}
      >
        <div className="fh-build-eyebrow" style={{ color: 'var(--v3-primary, #c9963a)' }}>Invite teammate</div>
        <h2 style={{ margin: '6px 0 18px', fontFamily: 'var(--font-display, "Bebas Neue", Impact, sans-serif)', fontSize: 24, letterSpacing: '.005em', color: 'var(--v3-text)' }}>
          Add someone to the field.
        </h2>

        {acceptUrl ? (
          <div>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--v3-text-secondary)', lineHeight: 1.5 }}>
              Invite created. Share this link with <strong style={{ color: 'var(--v3-text)' }}>{email}</strong>:
            </p>
            <div style={{
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 6,
              background: 'rgba(0,0,0,.40)',
              border: '1px solid rgba(201,150,58,.30)',
              fontSize: 12,
              fontFamily: 'var(--font-body)',
              color: 'var(--v3-text)',
              wordBreak: 'break-all',
            }}>
              {acceptUrl}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button type="button" className="fh-build-secondary-btn" onClick={() => copy(acceptUrl)}>
                <Copy size={13} /> Copy link
              </button>
              <button type="button" className="fh-build-primary-btn" onClick={onSent} style={{ marginLeft: 'auto' }}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label style={{ display: 'block', marginBottom: 14 }}>
              <span className="fh-build-eyebrow" style={{ display: 'block', marginBottom: 6 }}>Email</span>
              <div style={{ position: 'relative' }}>
                <Mail size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--v3-text-muted)' }} />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teammate@company.com"
                  style={{
                    width: '100%',
                    padding: '10px 12px 10px 34px',
                    borderRadius: 6,
                    background: 'rgba(0,0,0,.30)',
                    border: '1px solid var(--v3-border-mid)',
                    color: 'var(--v3-text)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 14,
                  }}
                />
              </div>
            </label>

            <label style={{ display: 'block', marginBottom: 18 }}>
              <span className="fh-build-eyebrow" style={{ display: 'block', marginBottom: 6 }}>Role</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as OrgRole)}
                className="fh-build-select"
                style={{ marginTop: 0 }}
              >
                {invitableRoles.map((r) => (
                  <option key={r} value={r} style={{ textTransform: 'capitalize' }}>{r}</option>
                ))}
              </select>
            </label>

            {error && (
              <div style={{ marginBottom: 14, padding: 10, borderRadius: 6, background: 'rgba(238,73,66,.10)', border: '1px solid rgba(238,73,66,.30)', color: '#ee4942', fontSize: 12 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="fh-build-secondary-btn" onClick={onClose} disabled={sending}>
                Cancel
              </button>
              <button type="submit" className="fh-build-primary-btn" disabled={sending || !email}>
                <Plus size={13} /> {sending ? 'Creating…' : 'Create invite'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
