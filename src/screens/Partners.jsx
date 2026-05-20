// src/screens/Partners.jsx
//
// Partner roster across every job. Each card represents one partner
// (deduped by normalized email) and lists every job they're on with a
// per-job status pill. Filter chips at the top scope to Pending /
// Accepted / Revoked. Per-card actions: Resend invite, Revoke
// everywhere.
//
// Resend reuses /api/partner-invite — the unique (job_id,
// partner_email) constraint trips and the function falls into its
// resend branch, returning the same token. Revoke flips status to
// 'revoked' on every fh_job_partners row for the partner; we use the
// client-side update because RLS already scopes by inviter.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Users, Send, ShieldOff, Briefcase, Check, ChevronRight, Clock
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useConfirm } from '../components/ConfirmSheet.jsx'
import { hapticTap, hapticSuccess, hapticError } from '../lib/haptics.js'
import { toastSuccess, toastError, toastInfo } from '../lib/toast.js'
import { SkeletonList } from '../components/Skeleton.jsx'
import { FilterPill, Eyebrow, StampNumber } from '../components/v3'
import { usePartnerDirectory, useInvalidatePartners } from '../lib/queries.ts'
import { revokePartnerRow } from '../lib/partners.js'
import { stageColor } from '../lib/stages.ts'

const STATUS_FILTERS = [
  { id: 'all',      label: 'All',      match: () => true },
  { id: 'pending',  label: 'Pending',  match: (p) => p.status === 'pending' },
  { id: 'accepted', label: 'Accepted', match: (p) => p.status === 'accepted' },
  { id: 'revoked',  label: 'Revoked',  match: (p) => p.status === 'revoked' }
]

function relTime(input) {
  if (!input) return ''
  const d = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(d.getTime())) return ''
  const diffDay = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (diffDay < 1) return 'today'
  if (diffDay === 1) return 'yesterday'
  if (diffDay < 7) return `${diffDay}d ago`
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function Partners() {
  const { user } = useAuth()
  const confirm = useConfirm()
  const { data: rows = [], isLoading: loading } = usePartnerDirectory(user?.id)
  const load = useInvalidatePartners()
  const [filter, setFilter] = useState('all')
  const [busyKey, setBusyKey] = useState(null)

  const counts = useMemo(() => ({
    all: rows.length,
    pending: rows.filter((p) => p.status === 'pending').length,
    accepted: rows.filter((p) => p.status === 'accepted').length,
    revoked: rows.filter((p) => p.status === 'revoked').length
  }), [rows])

  const filtered = useMemo(() => {
    const cfg = STATUS_FILTERS.find((f) => f.id === filter)
    return cfg ? rows.filter(cfg.match) : rows
  }, [rows, filter])

  async function resend(partner, job) {
    if (!user?.id || !job?.id) return
    const key = `${partner.email}|${job.partnerId}`
    setBusyKey(key)
    try {
      const res = await fetch('/api/partner-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: job.id,
          invited_by_user_id: user.id,
          partner_email: partner.email,
          partner_name: partner.name || null,
          partner_role: partner.role || null,
          send_email: true
        })
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body?.ok) {
        throw new Error(body?.detail || body?.error || 'Resend failed')
      }
      hapticSuccess()
      if (body.sent) {
        toastSuccess('Invite re-sent', `${partner.email} got a fresh link.`)
      } else {
        toastInfo('Link refreshed', 'Email sender skipped — share manually from the job sheet.')
      }
    } catch (err) {
      hapticError()
      toastError("Couldn't resend", err?.message || 'Unknown error')
    } finally {
      setBusyKey(null)
    }
  }

  async function revoke(partner) {
    const active = partner.jobs.filter((j) => j.status !== 'revoked')
    if (active.length === 0) return
    const ok = await confirm({
      title: `Revoke ${partner.name || partner.email}?`,
      body: `Cuts their access to ${active.length} ${active.length === 1 ? 'job' : 'jobs'}. They can't re-accept old invites after this — you'll need to send a fresh one.`,
      destructive: true,
      confirmLabel: 'Revoke everywhere'
    })
    if (!ok) return
    setBusyKey(partner.email)
    try {
      for (const j of active) {
        await revokePartnerRow(j.partnerId)
      }
      hapticSuccess()
      toastSuccess('Access revoked', `${partner.email} removed from ${active.length} ${active.length === 1 ? 'job' : 'jobs'}.`)
      await load()
    } catch (err) {
      hapticError()
      toastError("Couldn't revoke", err?.message || 'Unknown error')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <motion.div
      className="v3-screen"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
      style={{ paddingBottom: 120, background: 'var(--v3-bg)' }}
    >
      {/* COCKPIT */}
      <div style={{ padding: '8px 20px 12px' }}>
        <div style={{
          padding: '14px 16px',
          borderRadius: 16,
          background: 'var(--v3-surface)',
          border: '1px solid var(--v3-border)',
          boxShadow: '0 1px 0 rgba(255, 240, 210, 0.04) inset, 0 8px 22px rgba(0, 0, 0, 0.40)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <Eyebrow tone="gold">Partners</Eyebrow>
            <span style={{
              fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)'
            }}>
              {counts.all} total
            </span>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 10,
            alignItems: 'end'
          }}>
            <Metric label="Accepted" tone="good">{counts.accepted}</Metric>
            <Metric label="Pending"  tone="gold">{counts.pending}</Metric>
            <Metric label="Revoked"  tone="muted">{counts.revoked}</Metric>
          </div>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ padding: '0 20px 12px' }}>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
          {STATUS_FILTERS.map((f) => (
            <FilterPill
              key={f.id}
              size="sm"
              active={filter === f.id}
              count={counts[f.id]}
              onClick={() => { hapticTap(); setFilter(f.id) }}
            >
              {f.label}
            </FilterPill>
          ))}
        </div>
      </div>

      {/* List */}
      <div style={{ padding: '0 20px 32px' }}>
        {loading && <SkeletonList rows={4} card={false} />}
        {!loading && rows.length === 0 && (
          <div style={{
            padding: '32px 24px', borderRadius: 16,
            background: 'var(--v3-surface)',
            border: '1px dashed var(--v3-border-strong)',
            textAlign: 'center', color: 'var(--v3-text-muted)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10
          }}>
            <Users size={20} aria-hidden="true" style={{ color: 'var(--v3-primary)' }} />
            <div style={{
              fontFamily: 'var(--font-body)', fontSize: 14,
              fontWeight: 700, color: 'var(--v3-text)'
            }}>
              No partners yet
            </div>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, maxWidth: 320 }}>
              Use the Invite partner button on any job to bring a foreman, sub, or estimator into a single project.
            </p>
          </div>
        )}
        {!loading && rows.length > 0 && filtered.length === 0 && (
          <div className="v3-empty">No partners in this filter.</div>
        )}
        {!loading && filtered.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map((p) => (
              <PartnerCard
                key={p.email}
                partner={p}
                onResend={resend}
                onRevoke={revoke}
                busy={busyKey === p.email}
                resendingKey={busyKey?.startsWith(`${p.email}|`) ? busyKey : null}
              />
            ))}
          </ul>
        )}
      </div>
    </motion.div>
  )
}

function Metric({ label, tone = 'default', children }) {
  const color = tone === 'good' ? 'var(--v3-good, #6FB387)'
    : tone === 'gold' ? 'var(--v3-primary-bright)'
    : 'var(--v3-text)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <Eyebrow tone={tone === 'gold' ? 'gold' : 'default'}>{label}</Eyebrow>
      <StampNumber size="lg" tone={tone === 'gold' ? 'gold' : tone === 'good' ? 'good' : 'default'} style={{ color }}>
        {children}
      </StampNumber>
    </div>
  )
}

function PartnerCard({ partner, onResend, onRevoke, busy, resendingKey }) {
  const initial = (partner.name || partner.email).charAt(0).toUpperCase()
  return (
    <li>
      <section style={{
        borderRadius: 16,
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border-strong)',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 2px 8px rgba(0, 0, 0, 0.22)',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <header style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px',
          borderBottom: '1px solid var(--v3-border)'
        }}>
          <span aria-hidden="true" style={{
            flexShrink: 0,
            width: 44, height: 44, borderRadius: 12,
            background: 'var(--v3-primary-soft)',
            border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
            color: 'var(--v3-primary)',
            display: 'grid', placeItems: 'center',
            fontFamily: 'var(--font-display)', fontSize: 18,
            letterSpacing: '0.04em'
          }}>
            {initial}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700,
              color: 'var(--v3-text)', lineHeight: 1.2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            }}>
              {partner.name || partner.email}
            </div>
            <div style={{
              marginTop: 3,
              display: 'flex', alignItems: 'center', gap: 8,
              fontFamily: 'var(--font-body)', fontSize: 11,
              color: 'var(--v3-text-muted)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {partner.email}
              </span>
              {partner.role && (
                <>
                  <span style={dotStyle} aria-hidden="true" />
                  <span style={{
                    fontWeight: 700, color: 'var(--v3-primary-bright)',
                    letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 10
                  }}>
                    {partner.role}
                  </span>
                </>
              )}
            </div>
          </div>
          <StatusBadge status={partner.status} />
        </header>

        {/* Jobs list */}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {partner.jobs.map((j) => {
            const k = `${partner.email}|${j.partnerId}`
            const isResending = resendingKey === k
            return (
              <li key={k} style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto',
                gap: 10,
                alignItems: 'center',
                padding: '11px 16px',
                borderTop: '1px solid var(--v3-border)'
              }}>
                <Link
                  to={`/jobs/${j.id}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    minWidth: 0, color: 'inherit', textDecoration: 'none',
                    WebkitTapHighlightColor: 'transparent'
                  }}
                >
                  <span aria-hidden="true" style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: stageColor(j.stage),
                    boxShadow: `0 0 10px ${stageColor(j.stage)}66`,
                    flexShrink: 0
                  }} />
                  <span style={{
                    fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
                    color: 'var(--v3-text)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                  }}>
                    {j.name || j.jobTitle || 'Untitled job'}
                  </span>
                </Link>
                <span style={{
                  fontFamily: 'var(--font-body)', fontSize: 9,
                  fontWeight: 700, letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: j.status === 'accepted' ? 'var(--v3-good, #6FB387)'
                    : j.status === 'revoked' ? 'var(--v3-text-muted)'
                    : 'var(--v3-primary-bright)'
                }}>
                  {j.status}
                </span>
                {j.status !== 'revoked' && (
                  <button
                    type="button"
                    onClick={() => { hapticTap(); onResend(partner, j) }}
                    disabled={busy || isResending}
                    aria-label="Resend invite"
                    style={iconBtnStyle(isResending)}
                  >
                    {isResending ? <Check size={13} /> : <Send size={13} />}
                  </button>
                )}
              </li>
            )
          })}
        </ul>

        {/* Footer */}
        <footer style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, padding: '10px 14px',
          borderTop: '1px solid var(--v3-border)',
          background: 'var(--v3-surface-2)'
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 600,
            color: 'var(--v3-text-muted)',
            letterSpacing: '0.04em'
          }}>
            <Clock size={11} aria-hidden="true" />
            Last invited {relTime(partner.lastInvitedAt) || '—'}
          </span>
          {partner.jobs.some((j) => j.status !== 'revoked') && (
            <button
              type="button"
              onClick={() => onRevoke(partner)}
              disabled={busy}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 11px', borderRadius: 999,
                background: 'rgba(192,57,43,0.10)',
                border: '1px solid rgba(192,57,43,0.35)',
                color: 'var(--v3-danger-bright, #f5a294)',
                fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
                letterSpacing: '0.04em',
                cursor: busy ? 'wait' : 'pointer',
                opacity: busy ? 0.6 : 1
              }}
            >
              <ShieldOff size={11} aria-hidden="true" />
              Revoke
            </button>
          )}
        </footer>
      </section>
    </li>
  )
}

function StatusBadge({ status }) {
  const palette = status === 'accepted'
    ? { bg: 'rgba(72, 130, 95, 0.14)', border: 'rgba(72, 130, 95, 0.45)', color: 'var(--v3-good, #6FB387)' }
    : status === 'revoked'
      ? { bg: 'rgba(255,255,255,0.04)', border: 'var(--v3-border-strong)', color: 'var(--v3-text-muted)' }
      : { bg: 'var(--v3-primary-soft)', border: 'color-mix(in srgb, var(--v3-primary) 35%, transparent)', color: 'var(--v3-primary-bright)' }
  return (
    <span style={{
      flexShrink: 0,
      padding: '3px 9px', borderRadius: 999,
      background: palette.bg,
      border: `1px solid ${palette.border}`,
      color: palette.color,
      fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.14em', textTransform: 'uppercase'
    }}>
      {status}
    </span>
  )
}

function iconBtnStyle(busy) {
  return {
    width: 32, height: 32, borderRadius: 10,
    background: 'var(--v3-surface-2)',
    border: '1px solid var(--v3-border-strong)',
    color: busy ? 'var(--v3-good, #6FB387)' : 'var(--v3-text)',
    display: 'grid', placeItems: 'center',
    cursor: busy ? 'wait' : 'pointer',
    WebkitTapHighlightColor: 'transparent'
  }
}

const dotStyle = {
  display: 'inline-block', width: 3, height: 3, borderRadius: '50%',
  background: 'var(--v3-text-muted)', flexShrink: 0
}
