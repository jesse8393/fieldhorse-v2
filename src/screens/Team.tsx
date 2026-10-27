// Team, /team. Org member roster + invite management.
//
// Authenticated; visible to all org members so foremen/crew can see
// who else is on the team. Invite + revoke buttons are role-gated by
// canManageTeam (owner/admin only), the backend re-checks the same
// gate, so hiding the UI is a courtesy, not security.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell, ChevronRight, Search, Trash2, UserPlus, X,
} from 'lucide-react'
import { useMembership } from '../contexts/MembershipContext.tsx'
import {
  orgInviteRevoke, orgMembersList, orgMemberRemove, orgMemberRole, orgMemberRate,
  type OrgInvitePending, type OrgMember,
} from '../lib/orgApi.ts'
import type { OrgRole } from '../lib/permissions.ts'
import { ORG_ROLES } from '../lib/permissions.ts'
import { toastSuccess, toastError } from '../lib/toast.ts'
import MiniMetric from '../components/MiniMetric.tsx'
import { useSecondTap } from '../lib/secondTap.ts'
import { Eyebrow } from '../components/v3'
import PaletteKeyCap, { paletteShortcut } from '../components/desktop/PaletteKeyCap.tsx'
import { teamLoadError } from '../lib/serviceErrors.ts'

function fmtJoined(iso: string | null): string {
  if (!iso) return '\u2003'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '\u2003'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtExpires(iso: string | null): string {
  if (!iso) return '\u2003'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '\u2003'
  const days = Math.round((t - Date.now()) / 86_400_000)
  if (days < 0) return 'expired'
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `${days}d`
}

export default function Team() {
  const navigate = useNavigate()
  const { orgId, orgName, role, loading: membershipLoading, canManageTeam, canInviteMembers } = useMembership()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [invites, setInvites] = useState<OrgInvitePending[]>([])
  const [readOnly, setReadOnly] = useState(false)
  const [invitesAvailable, setInvitesAvailable] = useState(true)

  // A workspace switch must start a fresh request. Ignore late answers from
  // the previous workspace and clear its rows before rendering the next one.
  const requestId = useRef(0)
  const load = useCallback(async () => {
    const request = ++requestId.current
    setLoading(true)
    setError(null)
    setMembers([])
    setInvites([])
    setReadOnly(false)
    setInvitesAvailable(false)
    try {
      const res = await orgMembersList(orgId)
      if (request !== requestId.current) return
      if (orgId && res.org_id !== orgId) throw new Error('workspace_mismatch')
      setMembers(res.members || [])
      setInvites(res.invites || [])
      setReadOnly(Boolean(res.read_only))
      setInvitesAvailable(res.invites_available !== false)
    } catch (e: any) {
      if (request !== requestId.current) return
      console.error('[team] roster load failed', e)
      setError(teamLoadError(e))
    } finally {
      if (request === requestId.current) setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    if (!membershipLoading) void load()
    return () => { requestId.current += 1 }
  }, [membershipLoading, load])

  const activeCount = members.length
  const ownerCount = members.filter((m) => m.role === 'owner').length
  const fieldCount = members.filter((m) => m.role === 'foreman' || m.role === 'crew').length
  const count = (value: number) => loading
    ? <span style={{ fontSize: 16 }}>Loading</span>
    : error
      ? <span style={{ fontSize: 16 }}>Unavailable</span>
      : String(value)

  return (
    <div className="fh-build-page" data-build-screen="Team">
      <header className="fh-build-topbar fh-build-topbar--no-cta">
        <button
          type="button"
          className="fh-build-search"
          onClick={() => window.dispatchEvent(new CustomEvent('fh:open-palette'))}
          aria-label="Open command palette"
          aria-keyshortcuts={paletteShortcut().combo}
        >
          <Search size={14} />
          <span>Search jobs, clients, invoices, notes...</span>
          <PaletteKeyCap />
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

      <div className="fh-build-main">
        <section className="fh-build-hero-row fh-build-hero-row--page">
          <div>
            <div className="fh-build-good">Office</div>
            <h1 className="fh-build-title">Team</h1>
          </div>

          <div className="fh-build-focus">
            <div className="fh-build-eyebrow">Your role</div>
            <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--v3-text)', margin: '8px 0 4px', textTransform: 'capitalize' }}>
              {role || 'No membership'}
            </p>
            {canInviteMembers && !readOnly && !error && !loading && (
              <button
                type="button"
                className="fh-build-primary-btn"
                style={{ marginTop: 10 }}
                onClick={() => navigate('/team/invite')}
              >
                <UserPlus size={13} /> Invite teammate
              </button>
            )}
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Active members" value={count(activeCount)} accent />
            <MiniMetric label="Owners + admins" value={count(ownerCount + members.filter((m) => m.role === 'admin').length)} />
            <MiniMetric label="Foremen + crew" value={count(fieldCount)} />
            <MiniMetric label="Pending invites" value={invitesAvailable ? count(invites.length) : <span style={{ fontSize: 16 }}>Unavailable</span>} tone={!loading && !error && invites.length > 0 ? 'warn' : undefined} />
          </div>
        </section>

        {error && (
          <div role="alert" className="fh-build-banner is-warn" style={{ cursor: 'default' }}>
            <X size={14} />
            <span>{error}</span>
            <button type="button" className="fh-build-banner__cta" onClick={load} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}>Retry →</button>
          </div>
        )}

        {readOnly && (
          <div role="status" className="fh-build-banner is-warn">
            <span>Limited roster. Membership is verified, but names, email and management actions need workspace setup.</span>
            <button type="button" className="fh-build-banner__cta" onClick={() => { void load() }}>Retry full roster</button>
          </div>
        )}

        <section className="fh-build-content-grid fh-build-content-grid--clients">
          <section className="fh-build-card fh-build-table">
            <header className="fh-build-card-head">
              <div className="fh-build-eyebrow">Active members{!loading && !error ? ` · ${members.length}` : ''}</div>
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
            {!loading && error && (
              <div className="fh-build-table__empty">Roster unavailable. Team membership could not be checked.</div>
            )}
            {!loading && !error && members.length === 0 && (
              <div className="fh-build-table__empty">No active members yet.</div>
            )}
            {!loading && !error && members.map((m) => (
              <div key={m.id} className="fh-build-table__row is-team">
                <strong className="fh-build-truncate" title={m.name || ''}>
                  {m.name || (m.is_self ? 'You' : '\u2003')}
                  {m.is_self && <Eyebrow tone="gold" style={{ marginLeft: 8 }}>You</Eyebrow>}
                </strong>
                <span className="fh-build-truncate fh-build-rel" title={m.email || ''}>{m.email || '\u2003'}</span>
                <span style={{ textTransform: 'capitalize' }}><span className={`fh-build-dot is-${roleTone(m.role)}`}>{m.role}</span></span>
                <span className="fh-build-rel">{fmtJoined(m.joined_at)}</span>
                <MemberActions
                  member={m}
                  callerRole={role}
                  canManage={canManageTeam && !readOnly}
                  onChanged={load}
                />
              </div>
            ))}
          </section>

          <aside className="fh-build-rail fh-build-rail--page">
            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Pending invites{!loading && !error && invitesAvailable ? ` · ${invites.length}` : ''}</div>
              {loading || error || !invitesAvailable ? (
                <>
                  <strong>{loading ? 'Loading' : 'Unavailable'}</strong>
                  <span>{loading ? 'Checking invitations' : 'Invitation status could not be checked'}</span>
                </>
              ) : invites.length === 0 ? (
                <>
                  <strong>None</strong>
                  <span>No outstanding invitations</span>
                </>
              ) : (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {invites.map((inv) => (
                    <div key={inv.id} className="fh-build-invite-row">
                      <div className="fh-build-invite-row__main">
                        <span className="fh-build-invite-row__email" title={inv.email}>{inv.email}</span>
                        <span className="fh-build-invite-row__meta">
                          <span style={{ textTransform: 'capitalize' }}>{inv.role}</span>
                          {' · '}exp {fmtExpires(inv.expires_at)}
                        </span>
                      </div>
                      {canManageTeam && !readOnly && (
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

            {/* Customer facing copy only, this rail used to show the
                internal sprint plan ("Phase B", "ship in /crew next")
                and raw route paths (UI audit #19). */}
            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Crew portal</div>
              <strong data-empty>For your crew</strong>
              <span>Crew members sign in to see their own schedule, clock in and out, and check tasks.</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Subs / vendors</div>
              <strong data-empty>Tracked separately</strong>
              <span>Occasional vendors and subcontractors have their own page. This page is your recurring team.</span>
              <button type="button" className="fh-build-rail-card__action" onClick={() => navigate('/subs')}>
                Open subs <ChevronRight size={13} />
              </button>
            </section>
          </aside>
        </section>
      </div>

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
  , mirrors the server guards in org-member-role/remove. */
function MemberActions({ member, callerRole, canManage, onChanged }: any) {
  // Removing a member takes a second tap on the same button (D57).
  const removeTap = useSecondTap()
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
      // The server rejected it (e.g. rate ≥ 10000), snap the field back
      // to the member's real rate so the screen doesn't read as if the
      // rejected value was saved.
      setRate(current != null ? String(current) : '')
    } finally { setBusy(false) }
  }
  const callerTier = ROLE_TIER[callerRole || ''] ?? 0
  const targetTier = ROLE_TIER[member.role] ?? 0
  const manageable = canManage && !member.is_self && targetTier < callerTier
  if (!manageable) {
    return <span style={{ color: 'var(--v3-text-faint)', fontSize: 12 }}>{member.is_self ? '\u2003' : ''}</span>
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
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', gridColumn: '1 / -1', justifyContent: 'flex-end' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title="Crew hourly rate, feeds job labor cost">
        <span style={{ color: 'var(--v3-text-muted, rgba(242, 237, 228,.5))', fontSize: 14 }}>$</span>
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
          placeholder="\u2003"
          aria-label={`Hourly rate for ${member.name || member.email || 'member'}`}
          className="fh-build-select"
          style={{ width: 88, minHeight: 44, fontSize: 16, padding: '8px' }}
        />
        <span style={{ color: 'var(--v3-text-muted, rgba(242, 237, 228,.5))', fontSize: 14 }}>/hr</span>
      </span>
      <select
        value={member.role}
        disabled={busy}
        onChange={(e) => changeRole(e.target.value as OrgRole)}
        className="fh-build-select"
        style={{ minHeight: 44, fontSize: 16, padding: '8px' }}
        aria-label="Change role"
      >
        <option value={member.role} style={{ textTransform: 'capitalize' }}>{member.role}</option>
        {roleOptions.filter((r) => r !== member.role).map((r) => (
          <option key={r} value={r} style={{ textTransform: 'capitalize' }}>{r}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => { if (!busy) removeTap.tap(() => { void remove() }) }}
        disabled={busy}
        aria-label={removeTap.armed ? 'Tap again to remove' : 'Remove member'}
        title={removeTap.armed ? `Tap again to remove ${member.name || member.email || 'this member'}. They lose access immediately.` : 'Remove member'}
        style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'rgba(192, 57, 43,0.8)', display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 44, minWidth: 44, fontSize: 14, fontFamily: 'var(--font-body)' }}
      >
        <Trash2 size={13} />
        {removeTap.armed && <span>Tap again to remove</span>}
      </button>
    </span>
  )
}
