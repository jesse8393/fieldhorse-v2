import { formatFollowUpDate } from '../../../lib/quoteFollowUp.ts'

// The quote's status as the Quote tab shows it: a label, a tone and a
// short line ("Sent yesterday, follow up Oct 12"). Moved out of
// tabs/Quote.tsx unchanged so the desktop pill and the phone chip read
// one derivation.

/* ============================================================
   Status derivation, pure read of contact columns. proposal_status
   default is 'draft' (migration 002); quote_sent_at and
   quote_expires_at are nullable (migration 012). Expiration
   takes precedence over status when expired so the operator
   sees the urgent state regardless of how the row was last saved.
   ============================================================ */
export function deriveStatus(contact: any, pastQuote = false) {
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
  else if (raw === 'changes_requested') {
    label = 'Changes requested'
    tone = 'danger'
    sub = relativeAgo(contact?.quote_change_requested_at, 'Requested')
  }
  else if (raw === 'approved') { tone = 'good'; sub = relativeAgo(sentIso, 'Sent') }
  else if (raw === 'rejected') { tone = 'danger' }

  if (['sent', 'viewed'].includes(raw) && contact?.follow_up_on) {
    const followUpLabel = formatFollowUpDate(contact.follow_up_on)
    if (followUpLabel) sub = sub ? `${sub}, follow up ${followUpLabel}` : `Follow up ${followUpLabel}`
  }

  // Job has advanced past the quote phase but the explicit Approve
  // button was never tapped (manual stage advance, legacy data, etc).
  // Treat as approved so the pill / banner / approve band don't keep
  // claiming "Draft" on a job that's already invoicing or closed.
  // Rejected stays rejected, that's a terminal "lost" state.
  if (pastQuote && raw !== 'approved' && raw !== 'rejected') {
    label = 'Approved'
    tone = 'good'
    sub = 'Implied by job stage'
    return { label, tone, sub }
  }

  // Expiry only applies to quotes still awaiting a decision. Approved
  // and rejected are terminal, an approved quote whose expiry date
  // passes is still approved (the customer already committed); flipping
  // it to "Expired · danger" made closed-won jobs look like they fell
  // through (audit FH-QA-009).
  if (isExpired && raw !== 'approved' && raw !== 'rejected' && raw !== 'changes_requested') {
    label = 'Expired'
    tone = 'danger'
    sub = expIso ? `Was due ${shortDate(expIso)}` : null
  } else if (expIso && raw !== 'approved' && raw !== 'rejected' && raw !== 'changes_requested') {
    sub = sub ? `${sub} · Expires ${shortDate(expIso)}` : `Expires ${shortDate(expIso)}`
  }

  return { label, tone, sub }
}

function capitalize(s: any) {
  if (!s) return ''
  return s[0].toUpperCase() + s.slice(1)
}

export function relativeAgo(iso: any, prefix: any) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const dayMs = 24 * 60 * 60 * 1000
  const sameDay = (a: any, b: any) =>
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

export function shortDate(iso: any) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export type QuoteChip = { label: string; tone: 'success' | 'info' | 'danger' | 'neutral' }

/**
 * The phone's status chip (spec 5.4): the derived label with a jewel tone.
 * Approved is green, a customer's reply (viewed, changes requested) is
 * blue, and everything else is neutral. Red stays for late money.
 */
export function statusChip(status: { label: string }): QuoteChip {
  if (status.label === 'Approved') return { label: status.label, tone: 'success' }
  if (status.label === 'Viewed' || status.label === 'Changes requested') return { label: status.label, tone: 'info' }
  return { label: status.label, tone: 'neutral' }
}
