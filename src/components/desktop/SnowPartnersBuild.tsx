import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bell,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  Clock,
  Search,
  Send,
  ShieldOff,
  Users,
} from 'lucide-react'
import MiniMetric from '../MiniMetric.tsx'
import { SkeletonList } from '../Skeleton.tsx'

type Counts = { all: number; pending: number; accepted: number; revoked: number }

type Props = {
  rows: any[]
  filtered: any[]
  loading: boolean
  filter: string
  setFilter: (filter: string) => void
  counts: Counts
  busyKey: string | null
  onResend: (partner: any, job: any) => void
  onRevoke: (partner: any) => void
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'revoked', label: 'Revoked' },
]

function relTime(input: any) {
  if (!input) return '\u2003'
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return '\u2003'
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days < 1) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function statusTone(status: string) {
  if (status === 'accepted') return 'is-good'
  if (status === 'pending') return 'is-warn'
  return 'is-neutral'
}

export default function SnowPartnersBuild({
  rows,
  filtered,
  loading,
  filter,
  setFilter,
  counts,
  busyKey,
  onResend,
  onRevoke,
}: Props) {
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return filtered
    return filtered.filter((partner) => [partner.name, partner.email, partner.role]
      .some((value) => String(value || '').toLowerCase().includes(needle)))
  }, [filtered, query])

  const summary = useMemo(() => {
    const jobs = rows.reduce((total, partner) => total + (partner.jobs?.length || 0), 0)
    const activeJobs = rows.reduce((total, partner) => total + (partner.jobs || []).filter((job: any) => job.status !== 'revoked').length, 0)
    const roles = new Map<string, number>()
    for (const partner of rows) {
      const role = partner.role || 'Unassigned'
      roles.set(role, (roles.get(role) || 0) + 1)
    }
    return { jobs, activeJobs, roles: Array.from(roles.entries()).sort((a, b) => b[1] - a[1]) }
  }, [rows])

  return (
    <div className="fh-build-page fh-partners-build" data-build-screen="SnowPartnersBuild" data-build-route="/partners">
      <header className="fh-build-topbar fh-build-topbar--no-cta">
        <div className="fh-build-search">
          <Search size={14} aria-hidden="true" />
          <input
            className="fh-build-search__input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search partners..."
            aria-label="Search partners"
          />
        </div>
        <div className="fh-build-topbar__meta">
          <span>{rows.length.toLocaleString()} {rows.length === 1 ? 'partner' : 'partners'} on file</span>
          <span className="fh-build-vline" />
          <span>{summary.activeJobs.toLocaleString()} active job {summary.activeJobs === 1 ? 'share' : 'shares'}</span>
        </div>
        <button
          className="fh-build-icon-btn"
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('fh:navigate', { detail: { to: '/activity' } }))}
          aria-label="Open activity"
          title="Activity"
        >
          <Bell size={16} />
        </button>
      </header>

      <main className="fh-build-main">
        <section className="fh-build-hero-row fh-build-hero-row--page">
          <div>
            <div className="fh-build-good">Office</div>
            <h1 className="fh-build-title">PARTNERS</h1>
          </div>

          <div className="fh-build-focus">
            <div className="fh-build-eyebrow">Access coverage</div>
            <p><strong>{counts.accepted}</strong> accepted {counts.accepted === 1 ? 'partner' : 'partners'} across <strong>{summary.activeJobs}</strong> active job {summary.activeJobs === 1 ? 'share' : 'shares'}.</p>
            <Link className="fh-build-inline-link" to="/work">Open jobs <ChevronRight size={12} /></Link>
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Total partners" value={String(counts.all)} />
            <MiniMetric label="Accepted" value={String(counts.accepted)} accent />
            <MiniMetric label="Pending invites" value={String(counts.pending)} tone={counts.pending > 0 ? 'warn' : undefined} />
            <MiniMetric label="Jobs shared" value={String(summary.jobs)} />
          </div>
        </section>

        <div className="fh-build-filterbar" aria-label="Filter partners">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`fh-build-pill${filter === item.id ? ' is-active' : ''}`}
              onClick={() => setFilter(item.id)}
              aria-pressed={filter === item.id}
            >
              {item.label}
              <span className="fh-build-pill__count">{counts[item.id as keyof Counts]}</span>
            </button>
          ))}
        </div>

        <section className="fh-build-content-grid fh-build-content-grid--partners">
          <section className="fh-build-card fh-partners-table">
            <header className="fh-build-card-head">
              <div className="fh-build-eyebrow">Partner access · {visible.length.toLocaleString()}</div>
              <span className="fh-build-rel">One row per partner</span>
            </header>

            <div className="fh-partners-table__head" aria-hidden="true">
              <span>Partner</span>
              <span>Role</span>
              <span>Shared jobs</span>
              <span>Status</span>
              <span>Last invite</span>
              <span />
            </div>

            {loading && <div className="fh-partners-table__loading"><SkeletonList rows={6} card={false} /></div>}

            {!loading && rows.length === 0 && (
              <div className="fh-partners-table__empty">
                <Users size={22} aria-hidden="true" />
                <strong>No partners yet</strong>
                <span>Open a job to invite a foreman, subcontractor, or estimator.</span>
                <Link className="fh-build-secondary-btn" to="/work">Open jobs</Link>
              </div>
            )}

            {!loading && rows.length > 0 && visible.length === 0 && (
              <div className="fh-partners-table__empty">
                <Search size={22} aria-hidden="true" />
                <strong>No matching partners</strong>
                <span>Clear the search or choose another status.</span>
              </div>
            )}

            {!loading && visible.map((partner) => (
              <PartnerRow
                key={partner.email}
                partner={partner}
                busyKey={busyKey}
                onResend={onResend}
                onRevoke={onRevoke}
              />
            ))}
          </section>

          <aside className="fh-build-rail fh-build-rail--page">
            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Accepted</div>
              <strong>{counts.accepted}</strong>
              <span>with active access</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Pending invites</div>
              <strong className={counts.pending > 0 ? 'fh-partners-build__warn' : undefined}>{counts.pending}</strong>
              <span>{counts.pending === 1 ? 'invite needs a response' : 'invites need a response'}</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Job access</div>
              <strong>{summary.activeJobs}</strong>
              <span>active {summary.activeJobs === 1 ? 'share' : 'shares'}</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Roles on file</div>
              <div className="fh-partners-role-mix">
                {summary.roles.length === 0 && <span className="fh-build-rel">No roles assigned</span>}
                {summary.roles.slice(0, 6).map(([role, count]) => (
                  <div key={role}><span>{role}</span><strong>{count}</strong></div>
                ))}
              </div>
            </section>
          </aside>
        </section>
      </main>
    </div>
  )
}

function PartnerRow({ partner, busyKey, onResend, onRevoke }: {
  partner: any
  busyKey: string | null
  onResend: (partner: any, job: any) => void
  onRevoke: (partner: any) => void
}) {
  const busy = busyKey === partner.email
  const activeJobs = (partner.jobs || []).filter((job: any) => job.status !== 'revoked')
  const initial = (partner.name || partner.email || '?').charAt(0).toUpperCase()
  return (
    <div className="fh-partners-table__row">
      <div className="fh-partners-table__identity">
        <span aria-hidden="true">{initial}</span>
        <div>
          <strong title={partner.name || partner.email}>{partner.name || partner.email}</strong>
          <small title={partner.email}>{partner.email}</small>
        </div>
      </div>

      <span className="fh-build-truncate" title={partner.role || ''}>{partner.role || '\u2003'}</span>

      <div className="fh-partners-table__jobs">
        {(partner.jobs || []).map((job: any) => {
          const key = `${partner.email}|${job.partnerId}`
          const resending = busyKey === key
          return (
            <div key={key}>
              <Link to={`/jobs/${job.id}`} title={job.name || job.jobTitle || 'Untitled job'}>
                <BriefcaseBusiness size={12} aria-hidden="true" />
                <span>{job.name || job.jobTitle || 'Untitled job'}</span>
              </Link>
              <span className={`fh-build-dot ${statusTone(job.status)}`}>{job.status}</span>
              {job.status !== 'revoked' && (
                <button
                  type="button"
                  className="fh-build-icon-action"
                  onClick={() => onResend(partner, job)}
                  disabled={busy || resending}
                  aria-label={`Resend invite for ${job.name || job.jobTitle || 'job'}`}
                  title="Resend invite"
                >
                  {resending ? <Check size={12} /> : <Send size={12} />}
                </button>
              )}
            </div>
          )
        })}
      </div>

      <span className={`fh-build-dot ${statusTone(partner.status)}`}>{partner.status}</span>

      <span className="fh-partners-table__time"><Clock size={12} aria-hidden="true" />{relTime(partner.lastInvitedAt)}</span>

      <div className="fh-partners-table__actions">
        {activeJobs.length > 0 && (
          <button
            type="button"
            className="fh-build-icon-action is-danger"
            onClick={() => onRevoke(partner)}
            disabled={busy}
            aria-label={`Revoke access for ${partner.name || partner.email}`}
            title="Revoke access"
          >
            <ShieldOff size={13} />
          </button>
        )}
      </div>
    </div>
  )
}
