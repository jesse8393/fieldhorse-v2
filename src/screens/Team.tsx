// Team — /team. Org member roster + invite management.
//
// Authenticated; visible to all org members so foremen/crew can see
// who else is on the team. Invite + revoke buttons are role-gated by
// canManageTeam (owner/admin only) — the backend re-checks the same
// gate, so hiding the UI is a courtesy, not security.

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell, ChevronRight, Copy, Plus, Search, Trash2, UserCheck, UserPlus, Mail, X,
} from 'lucide-react'
import { useMembership } from '../contexts/MembershipContext.tsx'
import {
  orgInviteCreate, orgInviteRevoke, orgMembersList,
  type OrgInvitePending, type OrgMember,
} from '../lib/orgApi.ts'
import type { OrgRole } from '../lib/permissions.ts'
import { ORG_ROLES } from '../lib/permissions.ts'
import { toastSuccess, toastError } from '../lib/toast.ts'
import MiniMetric from '../components/MiniMetric.tsx'

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
            <p style={{ fontSize: 17, fontWeight: 700, color: '#f4f1ea', margin: '8px 0 4px', textTransform: 'capitalize' }}>
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
                  {m.is_self && <span style={{ color: 'var(--v3-primary, #c9963a)', marginLeft: 8, fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>You</span>}
                </strong>
                <span className="fh-build-truncate fh-build-rel" title={m.email || ''}>{m.email || '—'}</span>
                <span style={{ textTransform: 'capitalize' }}><span className={`fh-build-dot is-${roleTone(m.role)}`}>{m.role}</span></span>
                <span className="fh-build-rel">{fmtJoined(m.joined_at)}</span>
                <UserCheck size={13} color="rgba(245,242,234,.30)" />
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

function InviteDialog({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<OrgRole>('crew')
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
          border: '1px solid rgba(255,255,255,.10)',
          boxShadow: '0 22px 60px rgba(0,0,0,.50)',
        }}
      >
        <div className="fh-build-eyebrow" style={{ color: 'var(--v3-primary, #c9963a)' }}>Invite teammate</div>
        <h2 style={{ margin: '6px 0 18px', fontFamily: 'var(--font-display, "Bebas Neue", Impact, sans-serif)', fontSize: 24, letterSpacing: '.005em', color: '#f4f1ea' }}>
          Add someone to the field.
        </h2>

        {acceptUrl ? (
          <div>
            <p style={{ margin: 0, fontSize: 14, color: 'rgba(245,242,234,.78)', lineHeight: 1.5 }}>
              Invite created. Share this link with <strong style={{ color: '#f4f1ea' }}>{email}</strong>:
            </p>
            <div style={{
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 6,
              background: 'rgba(0,0,0,.40)',
              border: '1px solid rgba(201,150,58,.30)',
              fontSize: 12,
              fontFamily: 'var(--font-body)',
              color: '#f4f1ea',
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
                <Mail size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'rgba(245,242,234,.45)' }} />
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
                    border: '1px solid rgba(255,255,255,.10)',
                    color: '#f4f1ea',
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
                {ORG_ROLES.map((r) => (
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
