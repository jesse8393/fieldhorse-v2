import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Eye, Download, Send, ShieldCheck, Lock } from 'lucide-react'
import { supabase } from '../../../lib/supabase.js'
import { useProfile } from '../../../contexts/ProfileContext.jsx'
import { generateQuote, downloadPdf } from '../../../lib/pdf.js'
import { toastError, toastSuccess } from '../../../lib/toast.js'
import { hapticTap } from '../../../lib/haptics.js'
import QuoteItemsSection from '../sections/QuoteItems.jsx'
import QuoteTermsSection from '../sections/QuoteTerms.jsx'

/**
 * QUOTE tab — the formal sellable scope. Lead → Quote → Approved Job
 * → Production/Expenses → Invoice. Quote is the sendable artifact;
 * once approved (Phase 4C) it becomes the locked baseline that
 * Production and Invoice surfaces inherit from.
 *
 * Phase 4A — line-item editor (CRUD + parent refresh).
 * Phase 4B-2 — status pill + scope/terms/exclusions editor.
 * Phase 4B-4 — Preview / Download / Send Quote action bar.
 *   • Preview opens a blob URL of the generated PDF; no status change.
 *   • Download saves the PDF locally; no status change.
 *   • Send saves the PDF locally, uploads it to the job-files bucket
 *     (visible in the Files tab), and flips proposal_status='sent' +
 *     quote_sent_at=now() through the parent patch helper.
 *
 * Customer portal / e-sign / email send live in later phases.
 */
export default function QuoteTab({ contact, userId, fetchAll, patch, onOpenApprove }) {
  const { profile } = useProfile()

  const status = useMemo(() => deriveStatus(contact), [
    contact?.proposal_status,
    contact?.quote_sent_at,
    contact?.quote_expires_at
  ])

  const company = useMemo(() => ({
    name: profile?.company_name || profile?.full_name || 'My Company',
    address: profile?.company_address || '',
    phone: profile?.company_phone || '',
    // Prefer the customer-facing company_email (migration 015) over the
    // operator's auth email so proposals show the public address.
    email: profile?.company_email || profile?.email || '',
    website: profile?.company_website || '',
    logo_url: profile?.logo_url || null,
    brand_accent_hex: profile?.brand_accent_hex || null,
    license_number: profile?.license_number || '',
    insured_text: profile?.insured_text || '',
    warranty_default: profile?.warranty_default || ''
  }), [profile])

  // Base-item count drives the disabled state on the action bar. Keyed
  // on contact.updated_at — the recalc trigger from migration 011 bumps
  // updated_at on every fh_quote_items write, so this auto-refreshes
  // after add / edit / delete / Send without an extra subscription.
  const [baseCount, setBaseCount] = useState(0)
  useEffect(() => {
    let alive = true
    if (!contact?.id || !userId) { setBaseCount(0); return }
    ;(async () => {
      const { count } = await supabase
        .from('fh_quote_items')
        .select('id', { count: 'exact', head: true })
        .eq('contact_id', contact.id)
        .eq('user_id', userId)
        .eq('is_optional', false)
        .eq('is_excluded', false)
      if (alive) setBaseCount(count || 0)
    })()
    return () => { alive = false }
  }, [contact?.id, contact?.updated_at, userId])

  const [busy, setBusy] = useState(null) // 'preview' | 'download' | 'send' | null
  const disabled = baseCount === 0 || busy !== null

  // Shared PDF build path. Fetches fresh items so any pending blur
  // saves on QuoteTerms or QuoteItems are reflected. Throws on zero
  // base items so the catch in each handler can surface a friendly
  // toast — defensive even though the disabled state prevents this.
  async function buildPdf() {
    if (!contact?.id || !userId) throw new Error('Contact not loaded')
    const { data, error } = await supabase
      .from('fh_quote_items')
      .select('*')
      .eq('contact_id', contact.id)
      .eq('user_id', userId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)
    const items = data || []
    const base = items.filter((i) => !i.is_optional && !i.is_excluded)
    if (base.length === 0) {
      throw new Error('Add at least one base line item before generating a quote')
    }
    // generateQuote() became async in 4D-2C — it pre-fetches the
    // contractor's logo via loadLogoForPdf before rendering the cover.
    const result = await generateQuote({
      company,
      contact: {
        id: contact.id,
        name: contact.name,
        address: contact.address,
        phone: contact.phone,
        email: contact.email,
        job_title: contact.job_title
      },
      items,
      scope: contact.scope_text || '',
      terms: contact.terms_text || '',
      exclusions: contact.exclusions_text || '',
      expiresAt: contact.quote_expires_at || null,
      status: contact.proposal_status || 'draft',
      quoteId: contact.id
    })
    if (!result?.doc) throw new Error('PDF generator returned no document')
    return result
  }

  async function handlePreview() {
    if (disabled) return
    hapticTap()
    setBusy('preview')
    try {
      const result = await buildPdf()
      const url = result.doc.output('bloburl')
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      toastError("Couldn't preview", e?.message || 'Try again')
    } finally {
      setBusy(null)
    }
  }

  async function handleDownload() {
    if (disabled) return
    hapticTap()
    setBusy('download')
    try {
      const result = await buildPdf()
      downloadPdf(result)
      toastSuccess('Quote downloaded', result.filename)
    } catch (e) {
      toastError("Couldn't download", e?.message || 'Try again')
    } finally {
      setBusy(null)
    }
  }

  async function handleSend() {
    if (disabled) return
    hapticTap()
    setBusy('send')
    try {
      const result = await buildPdf()

      // Save to job-files storage first so the row exists for audit
      // even if the operator dismisses the download. Wrapped: storage
      // failure logs + becomes a toast suffix but does not block the
      // status flip — the operator already holds the PDF locally.
      let storageNote = ''
      try {
        const blob = result.doc.output('blob')
        const rowId = crypto.randomUUID()
        const path = `${userId}/${contact.id}/${rowId}.pdf`
        const { error: upErr } = await supabase.storage
          .from('job-files')
          .upload(path, blob, { upsert: false, contentType: 'application/pdf' })
        if (upErr) throw upErr
        const { error: insErr } = await supabase.from('fh_job_files').insert({
          id: rowId,
          user_id: userId,
          job_id: contact.id,
          filename: result.filename,
          storage_path: path,
          mime_type: 'application/pdf',
          size_bytes: blob.size || 0,
          kind: 'file'
        })
        if (insErr) throw insErr
        storageNote = ' · Saved to Files'
      } catch (storageErr) {
        console.warn('[quote] storage save failed:', storageErr)
        storageNote = ' · Storage save failed'
      }

      downloadPdf(result)

      const sentIso = new Date().toISOString()
      if (patch) {
        await patch({ proposal_status: 'sent', quote_sent_at: sentIso })
      }
      // patch() optimistically updates the parent contact, which feeds
      // the status pill and the baseCount effect. fetchAll is the
      // belt to patch's suspenders — kept defensive in case patch is
      // ever swapped for a non-optimistic helper.
      if (fetchAll) await fetchAll()

      toastSuccess(`Quote sent${storageNote}`, result.filename)
    } catch (e) {
      toastError("Couldn't send quote", e?.message || 'Try again')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '12px 20px 120px' }}>
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

      <ActionBar
        baseCount={baseCount}
        busy={busy}
        disabled={disabled}
        onPreview={handlePreview}
        onDownload={handleDownload}
        onSend={handleSend}
      />

      <ApproveBand
        contact={contact}
        baseCount={baseCount}
        busy={busy}
        onOpenApprove={onOpenApprove}
      />
    </div>
  )
}

/* ============================================================
   Approve band — primary "Approve Quote" CTA when status allows.
   When status='approved', shows a muted approved badge plus a
   small "Approve a new version" link so re-approval requires an
   intentional tap (no accidental double-approval). Phase 4C-2.
   ============================================================ */
function ApproveBand({ contact, baseCount, busy, onOpenApprove }) {
  const status = (contact?.proposal_status || 'draft').toLowerCase()
  const isApproved = status === 'approved'
  const canApprove = !isApproved && baseCount > 0 && !busy
  const approvedAt = contact?.updated_at && isApproved ? contact.updated_at : null

  if (isApproved) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 10,
        padding: '14px 16px',
        borderRadius: 14,
        background: 'rgba(72, 130, 95, 0.10)',
        border: '1px solid rgba(72, 130, 95, 0.40)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ShieldCheck size={16} aria-hidden="true" style={{ color: 'var(--v3-good, #6FB387)' }} />
          <span style={{
            fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
            letterSpacing: '0.10em', textTransform: 'uppercase',
            color: 'var(--v3-good, #6FB387)'
          }}>
            Quote approved
          </span>
        </div>
        <p style={{
          margin: 0,
          fontFamily: 'var(--font-body)',
          fontSize: 11, lineHeight: 1.5,
          color: 'var(--v3-text-muted)'
        }}>
          Snapshot is locked{approvedAt ? ` · ${shortDate(approvedAt)}` : ''}. Future edits to items, scope, terms, or exclusions don't change what the customer agreed to.
        </p>
        <button
          type="button"
          onClick={onOpenApprove}
          style={{
            alignSelf: 'flex-start',
            background: 'transparent', border: 'none',
            padding: '4px 0',
            color: 'var(--v3-text-muted)',
            fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600,
            textDecoration: 'underline', textUnderlineOffset: 3,
            cursor: 'pointer'
          }}
        >
          Approve a new version
        </button>
      </div>
    )
  }

  const helper = baseCount === 0
    ? 'Add at least one base line item to enable approval.'
    : 'Locks the customer-approved quote as a permanent snapshot. Different from sending the PDF — use this when the customer says yes.'

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      padding: '14px 16px',
      borderRadius: 14,
      background: 'var(--v3-surface)',
      border: '1px solid var(--v3-border)'
    }}>
      <span className="v3-eyebrow" style={{ color: 'var(--v3-primary)' }}>
        <Lock size={11} aria-hidden="true" style={{ marginRight: 4, verticalAlign: 'middle' }} />
        Approval
      </span>

      <p style={{
        margin: 0,
        fontFamily: 'var(--font-body)',
        fontSize: 11, lineHeight: 1.5,
        color: 'var(--v3-text-muted)'
      }}>
        {helper}
      </p>

      <motion.button
        type="button"
        whileTap={{ scale: canApprove ? 0.98 : 1 }}
        onClick={() => { if (canApprove) { hapticTap(); onOpenApprove?.() } }}
        disabled={!canApprove}
        aria-disabled={!canApprove}
        style={{
          minHeight: 44,
          padding: '12px 14px',
          borderRadius: 12,
          border: 'none',
          background: canApprove
            ? 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)'
            : 'var(--v3-surface-2)',
          color: canApprove ? 'var(--v3-on-primary)' : 'var(--v3-text-muted)',
          fontFamily: 'var(--font-body)',
          fontSize: 13, fontWeight: 700, letterSpacing: '0.04em',
          cursor: canApprove ? 'pointer' : 'not-allowed',
          opacity: canApprove ? 1 : 0.55,
          boxShadow: canApprove ? '0 0 0 2px rgba(228, 190, 111, 0.10), 0 4px 12px rgba(229, 193, 88, 0.18)' : 'none',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          WebkitTapHighlightColor: 'transparent'
        }}
      >
        <ShieldCheck size={14} aria-hidden="true" />
        Approve Quote
      </motion.button>
    </div>
  )
}

/* ============================================================
   Action bar — Preview / Download / Send Quote
   ============================================================ */
function ActionBar({ baseCount, busy, disabled, onPreview, onDownload, onSend }) {
  const helperLine = baseCount === 0
    ? 'Add at least one base line item to enable Send Quote.'
    : 'Generates the proposal PDF and marks the quote as sent. This does not approve the job — use Approve Quote when the customer says yes.'

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      padding: '14px 16px',
      borderRadius: 14,
      background: 'var(--v3-surface)',
      border: '1px solid var(--v3-border)'
    }}>
      <span className="v3-eyebrow" style={{ color: 'var(--v3-text-muted)' }}>
        Quote actions
      </span>

      <p style={{
        margin: 0,
        fontFamily: 'var(--font-body)',
        fontSize: 11, lineHeight: 1.5,
        color: 'var(--v3-text-muted)'
      }}>
        {helperLine}
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <SecondaryButton
          icon={<Eye size={14} aria-hidden="true" />}
          label={busy === 'preview' ? 'Opening…' : 'Preview'}
          onClick={onPreview}
          disabled={disabled}
        />
        <SecondaryButton
          icon={<Download size={14} aria-hidden="true" />}
          label={busy === 'download' ? 'Building…' : 'Download'}
          onClick={onDownload}
          disabled={disabled}
        />
        <PrimaryButton
          icon={<Send size={14} aria-hidden="true" />}
          label={busy === 'send' ? 'Sending…' : 'Send Quote'}
          onClick={onSend}
          disabled={disabled}
        />
      </div>
    </div>
  )
}

function SecondaryButton({ icon, label, onClick, disabled }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      style={{
        flex: '1 1 110px',
        minHeight: 44,
        padding: '11px 14px',
        borderRadius: 12,
        background: 'var(--v3-surface-2)',
        border: '1px solid var(--v3-border)',
        color: disabled ? 'var(--v3-text-muted)' : 'var(--v3-text)',
        fontFamily: 'var(--font-body)',
        fontSize: 13, fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        WebkitTapHighlightColor: 'transparent'
      }}
    >
      {icon}
      {label}
    </motion.button>
  )
}

function PrimaryButton({ icon, label, onClick, disabled }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      style={{
        flex: '2 1 180px',
        minHeight: 44,
        padding: '11px 14px',
        borderRadius: 12,
        border: 'none',
        background: disabled
          ? 'var(--v3-surface-2)'
          : 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
        color: disabled ? 'var(--v3-text-muted)' : 'var(--v3-on-primary)',
        fontFamily: 'var(--font-body)',
        fontSize: 13, fontWeight: 700, letterSpacing: '0.04em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        boxShadow: disabled ? 'none' : '0 0 0 2px rgba(228, 190, 111, 0.10), 0 4px 12px rgba(229, 193, 88, 0.18)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        WebkitTapHighlightColor: 'transparent'
      }}
    >
      {icon}
      {label}
    </motion.button>
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
