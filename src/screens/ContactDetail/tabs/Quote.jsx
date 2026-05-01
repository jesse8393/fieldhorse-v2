import { useMemo } from 'react'
import QuoteItemsSection from '../sections/QuoteItems.jsx'
import QuoteTermsSection from '../sections/QuoteTerms.jsx'

/**
 * QUOTE tab — the formal sellable scope. Lead → Quote → Approved Job
 * → Production/Expenses → Invoice. Quote is the sendable artifact;
 * once approved (Phase 4C) it becomes the locked baseline that
 * Production and Invoice surfaces inherit from.
 *
 * Phase 4A-2 / 4A-3 / 4A-4 — line-item editor (CRUD + parent
 * refresh) shipped in QuoteItemsSection.
 *
 * Phase 4B-2 — adds:
 *   • Status pill header (proposal_status + sent age + expiration).
 *   • QuoteTerms section (scope / exclusions / payment terms /
 *     expiration date) wired to the parent `patch` helper.
 *
 * Send / Preview / Download actions (4B-3, 4B-4) and the approval
 * snapshot (4C) are still ahead. This tab stays an editor surface.
 */
export default function QuoteTab({ contact, userId, fetchAll, patch }) {
  const status = useMemo(() => deriveStatus(contact), [
    contact?.proposal_status,
    contact?.quote_sent_at,
    contact?.quote_expires_at
  ])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '12px 20px 32px' }}>
      <StatusPill status={status} />

      <QuoteItemsSection
        jobId={contact?.id}
        userId={userId}
        onContactRefresh={fetchAll}
      />

      <QuoteTermsSection
        contact={contact}
        patch={patch}
      />
    </div>
  )
}

/* ============================================================
   Status derivation — pure read of contact columns. proposal_status
   default is 'draft' (migration 002); quote_sent_at and
   quote_expires_at are nullable (migration 012). Expiration
   takes precedence over status when expired so the operator
   sees the urgent state regardless of how the row was last saved.
   ============================================================ */
function deriveStatus(contact) {
  const raw = (contact?.proposal_status || 'draft').toLowerCase()
  const sentIso = contact?.quote_sent_at || null
  const expIso = contact?.quote_expires_at || null

  const now = Date.now()
  const expMs = expIso ? new Date(expIso).getTime() : null
  const isExpired = expMs != null && Number.isFinite(expMs) && expMs < now

  let label = capitalize(raw)
  let tone = 'muted'
  let sub = null

  if (raw === 'draft') { tone = 'muted' }
  else if (raw === 'sent') { tone = 'gold'; sub = relativeAgo(sentIso, 'Sent') }
  else if (raw === 'viewed') { tone = 'gold'; sub = relativeAgo(sentIso, 'Sent') }
  else if (raw === 'approved') { tone = 'good'; sub = relativeAgo(sentIso, 'Sent') }
  else if (raw === 'rejected') { tone = 'danger' }

  if (isExpired) {
    label = 'Expired'
    tone = 'danger'
    sub = expIso ? `Was due ${shortDate(expIso)}` : null
  } else if (expIso) {
    sub = sub ? `${sub} · Expires ${shortDate(expIso)}` : `Expires ${shortDate(expIso)}`
  }

  return { label, tone, sub }
}

function StatusPill({ status }) {
  const palette = (() => {
    switch (status.tone) {
      case 'gold':
        return {
          bg: 'var(--v3-primary-soft)',
          border: 'color-mix(in srgb, var(--v3-primary) 35%, transparent)',
          color: 'var(--v3-primary)'
        }
      case 'good':
        return {
          bg: 'rgba(72, 130, 95, 0.14)',
          border: 'rgba(72, 130, 95, 0.45)',
          color: 'var(--v3-good, #6FB387)'
        }
      case 'danger':
        return {
          bg: 'rgba(179, 58, 58, 0.14)',
          border: 'rgba(179, 58, 58, 0.45)',
          color: 'var(--v3-danger-bright, #D26A6A)'
        }
      default:
        return {
          bg: 'var(--v3-surface-2)',
          border: 'var(--v3-border)',
          color: 'var(--v3-text-muted)'
        }
    }
  })()

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '0 2px'
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center',
        padding: '5px 12px', borderRadius: 999,
        background: palette.bg, border: `1px solid ${palette.border}`,
        color: palette.color,
        fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
        letterSpacing: '0.12em', textTransform: 'uppercase'
      }}>
        Quote · {status.label}
      </span>
      {status.sub && (
        <span style={{
          fontFamily: 'var(--font-body)',
          fontSize: 11,
          color: 'var(--v3-text-muted)',
          letterSpacing: '0.02em'
        }}>
          {status.sub}
        </span>
      )}
    </div>
  )
}

function capitalize(s) {
  if (!s) return ''
  return s[0].toUpperCase() + s.slice(1)
}

function relativeAgo(iso, prefix) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const dayMs = 24 * 60 * 60 * 1000
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  const now = new Date()
  const yesterday = new Date(now.getTime() - dayMs)
  if (sameDay(d, now)) return `${prefix} today`
  if (sameDay(d, yesterday)) return `${prefix} yesterday`
  const days = Math.floor((now.getTime() - d.getTime()) / dayMs)
  if (days >= 1 && days < 30) return `${prefix} ${days}d ago`
  return `${prefix} ${shortDate(iso)}`
}

function shortDate(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
