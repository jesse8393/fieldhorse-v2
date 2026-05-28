// SubPortal — /sub-portal.
//
// Landing for subcontractors / accepted partners. Lists every job
// the caller has been invited to (status='accepted' on
// fh_job_partners) with the job's basic info. Read-only first pass —
// document upload + payment-status come in pass 2.
//
// RLS gives subs the read paths they need directly:
//   - fh_job_partners: caller can read rows where partner_user_id =
//     auth.uid() (policy fh_job_partners_own).
//   - fh_contacts:     caller can read jobs they're an accepted
//     partner on (policy fh_contacts_partner_read).
//   - fh_sub_profiles: NOT readable from the sub side yet (owner
//     writes only). Profile management is a Phase D pass 2 edge-
//     function story.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell, MapPin, Search, Sun, ChevronRight, ShieldCheck, Briefcase, AlertTriangle, Mail,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { supabase } from '../lib/supabase.ts'

type PartnerRow = {
  id: string
  job_id: string
  partner_role: string | null
  partner_email: string
  accepted_at: string | null
  invited_by_user_id: string
  status: string
  invited_at: string | null
}

type JobRow = {
  id: string
  name: string | null
  address: string | null
  job_title: string | null
  job_type: string | null
  stage: string | null
  amount: number | null
  updated_at: string | null
}

type Row = {
  partner: PartnerRow
  job: JobRow | null
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return '—' }
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

export default function SubPortal() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { loading: memLoading, orgId } = useMembership()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[]>([])

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    const partnerRes = await supabase
      .from('fh_job_partners')
      .select('id, job_id, partner_role, partner_email, accepted_at, invited_by_user_id, status, invited_at')
      .eq('partner_user_id', user.id)
      .eq('status', 'accepted')
      .order('accepted_at', { ascending: false })

    if (partnerRes.error) {
      setError(partnerRes.error.message)
      setLoading(false)
      return
    }

    const partnerRows = (partnerRes.data || []) as PartnerRow[]
    if (partnerRows.length === 0) {
      setRows([])
      setLoading(false)
      return
    }

    // Batch-hydrate the linked jobs.
    const jobIds = Array.from(new Set(partnerRows.map((p) => p.job_id)))
    const jobsRes = await supabase
      .from('fh_contacts')
      .select('id, name, address, job_title, job_type, stage, amount, updated_at')
      .in('id', jobIds)

    const jobById: Record<string, JobRow> = {}
    for (const j of (jobsRes.data || [])) jobById[j.id] = j as JobRow

    setRows(partnerRows.map((p) => ({ partner: p, job: jobById[p.job_id] || null })))
    setLoading(false)
  }, [user])

  useEffect(() => { if (!memLoading) load() }, [memLoading, load])

  const stats = useMemo(() => {
    const active = rows.filter((r) => {
      const s = String(r.job?.stage || '').toLowerCase()
      return s === 'job' || s === 'invoice'
    }).length
    const completed = rows.filter((r) => String(r.job?.stage || '').toLowerCase() === 'closed').length
    const trades = Array.from(new Set(rows.map((r) => r.partner.partner_role || '').filter(Boolean)))
    return { active, completed, total: rows.length, trades }
  }, [rows])

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
          <span>72° · Clear</span>
          <Sun size={16} className="fh-build-sun" />
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
            <p style={{ fontSize: 15, fontWeight: 700, color: '#f4f1ea', margin: '8px 0 4px', wordBreak: 'break-all' }}>
              {user?.email || '—'}
            </p>
            <p>
              {orgId
                ? 'You also belong to an organization. Use the main sidebar for your owner / crew tools.'
                : 'This portal shows every job a general contractor has invited you to.'}
            </p>
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Active jobs" value={String(stats.active)} accent />
            <MiniMetric label="Completed" value={String(stats.completed)} />
            <MiniMetric label="Total invites" value={String(stats.total)} />
            <MiniMetric label="Trades" value={String(stats.trades.length || '—')} />
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
          <div className="fh-build-table__empty">Loading your invitations…</div>
        )}

        {!loading && rows.length === 0 && (
          <div className="fh-build-card" style={{ padding: 36, textAlign: 'center' }}>
            <Briefcase size={28} aria-hidden="true" style={{ color: 'var(--v3-primary, #c9963a)', marginBottom: 12 }} />
            <h2 style={{ fontFamily: 'var(--font-display, "Bebas Neue", Impact, sans-serif)', fontSize: 22, letterSpacing: '.005em', color: '#f4f1ea', margin: '0 0 8px' }}>
              No invitations yet
            </h2>
            <p style={{ color: 'rgba(245,242,234,.62)', fontSize: 13, margin: 0, lineHeight: 1.5 }}>
              When a contractor invites you to a job, it'll show up here.
              They'll send a link to <strong style={{ color: '#f4f1ea' }}>{user?.email || 'your email'}</strong>.
            </p>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <section className="fh-build-content-grid fh-build-content-grid--jobs">
            <section className="fh-build-card fh-build-table">
              <header className="fh-build-card-head">
                <div className="fh-build-eyebrow">Active invitations · {rows.length}</div>
              </header>

              <div className="fh-build-table__head is-subportal">
                <span>Job</span>
                <span>Address</span>
                <span>Role</span>
                <span>Stage</span>
                <span>Accepted</span>
                <span />
              </div>

              {rows.map((r) => (
                <button
                  key={r.partner.id}
                  type="button"
                  className="fh-build-table__row is-subportal"
                  onClick={() => navigate(`/jobs/${r.partner.job_id}`)}
                >
                  <strong className="fh-build-truncate" title={r.job?.name || ''}>
                    {r.job?.name || 'Untitled job'}
                  </strong>
                  <span className="fh-build-truncate fh-build-rel" title={r.job?.address || ''}>
                    {r.job?.address ? (
                      <><MapPin size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: '-1px' }} />{r.job.address}</>
                    ) : '—'}
                  </span>
                  <span className="fh-build-rel" style={{ textTransform: 'capitalize' }}>
                    {r.partner.partner_role || 'Partner'}
                  </span>
                  <span>
                    <span className={`fh-build-dot is-${stageTone(r.job?.stage || null)}`}>
                      {stageLabel(r.job?.stage || null)}
                    </span>
                  </span>
                  <span className="fh-build-rel">{fmtDate(r.partner.accepted_at)}</span>
                  <ChevronRight size={13} color="rgba(245,242,234,.30)" />
                </button>
              ))}
            </section>

            <aside className="fh-build-rail fh-build-rail--page">
              <section className="fh-build-rail-card">
                <div className="fh-build-eyebrow">Your profile</div>
                <strong>Not tracked yet</strong>
                <span>
                  Insurance / W-9 / license self-upload from the sub side
                  is a Phase D pass-2 feature. For now your contractor
                  manages your sub profile on their end.
                </span>
              </section>

              <section className="fh-build-rail-card">
                <div className="fh-build-eyebrow">Payments</div>
                <strong>Not connected</strong>
                <span>
                  Sub-facing payment status is part of pass 2. Ask the
                  contractor for an update until then.
                </span>
              </section>

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
                        <span className="fh-build-rail-list__title" style={{ textTransform: 'capitalize' }}>
                          {t}
                        </span>
                      </li>
                    ))}
                  </ul>
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
                  For invitation issues, reach out to the contractor who sent it.
                </span>
              </section>
            </aside>
          </section>
        )}
      </main>
    </div>
  )
}

function MiniMetric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="fh-build-mini">
      <strong style={{ color: accent ? 'var(--v3-primary, #c9963a)' : undefined }}>
        {value}
      </strong>
      <span>{label}</span>
    </div>
  )
}

// Silence the import — used in a copy block above.
void ShieldCheck
