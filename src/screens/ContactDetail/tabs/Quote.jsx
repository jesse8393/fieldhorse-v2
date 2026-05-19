import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Eye, Download, Send, ShieldCheck, Lock, Trash2, Link as LinkIcon } from 'lucide-react'
import { supabase } from '../../../lib/supabase.js'
import { useProfile } from '../../../contexts/ProfileContext.jsx'
import { generateQuote, downloadPdf } from '../../../lib/pdf.js'
import { toastError, toastSuccess } from '../../../lib/toast.js'
import { hapticTap } from '../../../lib/haptics.js'
import { dateInputToTimestamp } from '../../../lib/dueDate.js'
import QuoteItemsSection from '../sections/QuoteItems.jsx'
import QuoteTermsSection from '../sections/QuoteTerms.jsx'
import ChangeOrdersSection from '../sections/ChangeOrdersSection.jsx'
import { useConfirm } from '../../../components/ConfirmSheet.jsx'
import { ProposalTemplate, mapItemsToScope } from '../../../components/documents'
import { mintPublicLink } from '../../../lib/publicLink.js'

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
export default function QuoteTab({ contact, userId, fetchAll, patch, onOpenApprove, insurance = null, changeOrders = [] }) {
  const { profile } = useProfile()

  // "Past quote" = pipeline stage already advanced beyond the quoting
  // phase. The job has been started / invoiced / closed, which means
  // the proposal was implicitly approved even if proposal_status was
  // never flipped through the Approve button (legacy / manual advance).
  const pastQuote = ['job', 'invoice', 'closed'].includes(contact?.stage)

  const status = useMemo(() => deriveStatus(contact, pastQuote), [
    contact?.proposal_status,
    contact?.quote_sent_at,
    contact?.quote_expires_at,
    pastQuote
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

  // Phase 2 — opt-in Document preview using the new ProposalTemplate.
  // 'builder' = existing CRUD editor (default, unchanged UX).
  // 'document' = full HTML preview that mirrors what the customer will
  // see. The Send / Download / Approve actions on the right rail stay
  // available in both modes so the operator can flip between editing
  // the draft and reviewing the customer-facing render without losing
  // their seat.
  const [docMode, setDocMode] = useState('builder')
  const [docItems, setDocItems] = useState([])
  const [docItemsLoading, setDocItemsLoading] = useState(false)
  useEffect(() => {
    if (docMode !== 'document' || !contact?.id || !userId) return
    let alive = true
    setDocItemsLoading(true)
    ;(async () => {
      const { data } = await supabase
        .from('fh_quote_items')
        .select('*')
        .eq('contact_id', contact.id)
        .eq('user_id', userId)
        .order('sort_order', { ascending: true })
      if (alive) {
        setDocItems(data || [])
        setDocItemsLoading(false)
      }
    })()
    return () => { alive = false }
    // contact.updated_at flips after every CRUD via the trigger from
    // 011_quote_items so the preview re-fetches without an extra sub.
  }, [docMode, contact?.id, contact?.updated_at, userId])

  const [busy, setBusy] = useState(null) // 'preview' | 'download' | 'send' | null
  const disabled = baseCount === 0 || busy !== null
  // Phase 1 send requires a recipient — the proposal email is attached to
  // the client's email address. Preview and Download don't require this.
  const hasClientEmail = Boolean((contact?.email || '').trim())
  const sendDisabled = disabled || !hasClientEmail
  const sendDisabledReason = baseCount === 0
    ? (pastQuote
        ? "This job is past the quote phase. There's nothing to send unless you rebuild the proposal."
        : 'Add at least one base line item to enable Send.')
    : !hasClientEmail
      ? "Add a client email first so we know where to send."
      : null

  // Mirror of QuoteTermsSection's local state. The terms editor pushes
  // its current values here on every change; buildPdf reads from this
  // ref so unblurred textarea content reaches the PDF — independent of
  // mobile blur-timing races (P1 fix from V3-QA-1B retest).
  const termsValuesRef = useRef({ scope: '', exclusions: '', terms: '', expires: '' })

  // Shared PDF build path. Fetches fresh items so any pending blur
  // saves on QuoteTerms or QuoteItems are reflected. Throws on zero
  // base items so the catch in each handler can surface a friendly
  // toast — defensive even though the disabled state prevents this.
  async function buildPdf() {
    if (!contact?.id || !userId) throw new Error('Contact not loaded')

    // Pull latest local state from QuoteTermsSection — published into
    // termsValuesRef on every change (V3-QA-1B fix). Falls back to the
    // contact row's persisted values when no edits are pending.
    const local = termsValuesRef.current || {}
    const pendingScope = local.scope ?? (contact.scope_text || '')
    const pendingExclusions = local.exclusions ?? (contact.exclusions_text || '')
    const pendingTerms = local.terms ?? (contact.terms_text || '')
    const pendingExpiresIso = local.expires
      ? dateInputToTimestamp(local.expires)
      : (contact.quote_expires_at || null)

    // Persist any unblurred edits before rendering, so the approval
    // snapshot also reflects them. Diff vs persisted values; null
    // out blanks. patch is optimistic — local state matches contact
    // immediately; the awaited server-write also queues.
    const norm = (s) => {
      const t = String(s || '').trim()
      return t.length === 0 ? null : t
    }
    const updates = {}
    const persistedScope = contact.scope_text || ''
    const persistedExclusions = contact.exclusions_text || ''
    const persistedTerms = contact.terms_text || ''
    if (norm(pendingScope) !== norm(persistedScope)) {
      updates.scope_text = norm(pendingScope)
    }
    if (norm(pendingExclusions) !== norm(persistedExclusions)) {
      updates.exclusions_text = norm(pendingExclusions)
    }
    if (norm(pendingTerms) !== norm(persistedTerms)) {
      updates.terms_text = norm(pendingTerms)
    }
    if (pendingExpiresIso !== (contact.quote_expires_at || null)) {
      updates.quote_expires_at = pendingExpiresIso
    }
    if (Object.keys(updates).length > 0 && patch) {
      try { await patch(updates) } catch (e) { console.warn('[buildPdf] terms patch failed:', e) }
    }

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

    // Pull project photos for this job (best effort) so the magazine
    // proposal can use a hero image + per-scope photos. Quietly tolerates
    // failure: the renderer falls back to graceful placeholders when no
    // photos are loaded.
    const photos = await loadProjectPhotosForPdf(contact.id, userId).catch(() => [])

    // generateQuote() became async in 4D-2C — it pre-fetches the
    // contractor's logo + project photos before rendering the cover.
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
      scope: pendingScope || '',
      terms: pendingTerms || '',
      exclusions: pendingExclusions || '',
      expiresAt: pendingExpiresIso,
      status: contact.proposal_status || 'draft',
      quoteId: contact.id,
      photos,
      insurance,
      changeOrders
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

  // Clear-draft action — wipes all fh_quote_items + scope/exclusions/
  // terms/expiration/sent timestamp + resets proposal_status to 'draft'.
  // Safety: BLOCKED when proposal_status='approved' because approval
  // history (fh_quote_versions) is the immutable record of what the
  // customer agreed to; we don't want a "clear draft" gesture to
  // appear to wipe an approved quote.
  const [clearing, setClearing] = useState(false)
  const confirm = useConfirm()
  async function handleClearDraft() {
    if (!contact?.id || !userId) return
    if ((contact?.proposal_status || 'draft').toLowerCase() === 'approved') return
    const ok = await confirm({
      title: 'Delete this draft quote?',
      body: 'This removes the quote line items and draft terms. This cannot be undone.',
      confirmLabel: 'Delete draft',
      destructive: true
    })
    if (!ok) return
    hapticTap()
    setClearing(true)
    try {
      // Delete all line items for this contact (RLS scoped). The recalc
      // trigger from migration 011 fires per-row delete, so totals on
      // fh_contacts are recomputed automatically.
      const { error: delErr } = await supabase
        .from('fh_quote_items')
        .delete()
        .eq('contact_id', contact.id)
        .eq('user_id', userId)
      if (delErr) throw delErr

      // Reset draft fields on the contact. Keep stage + name + client
      // intact — only clear the quote-specific fields. Status reverts
      // to 'draft' if it was 'sent'/'viewed'/'rejected'/'expired'.
      if (patch) {
        await patch({
          scope_text: null,
          exclusions_text: null,
          terms_text: null,
          quote_sent_at: null,
          quote_expires_at: null,
          proposal_status: 'draft'
        })
      }
      if (fetchAll) await fetchAll()
      toastSuccess('Draft quote cleared', 'Line items and draft terms removed.')
    } catch (e) {
      toastError("Couldn't clear draft", e?.message || 'Try again in a moment.')
    } finally {
      setClearing(false)
    }
  }

  // Mint a public share link for this proposal + copy to clipboard.
  // Mirrors the InvoiceDetail share flow. The customer opens /p/{token}
  // → ProposalTemplate renders with the contractor's branding, no auth.
  async function handleShare() {
    if (!contact?.id || !userId) return
    hapticTap()
    setBusy('share')
    try {
      const link = await mintPublicLink({
        contactId: contact.id,
        userId,
        kind: 'proposal'
      })
      try {
        await navigator.clipboard.writeText(link.url)
        toastSuccess('Share link copied', 'Send via text, email, however you like.')
      } catch {
        toastSuccess('Share link ready', link.url)
      }
    } catch (e) {
      toastError("Couldn't mint share link", e?.message || 'Try again.')
    } finally {
      setBusy(null)
    }
  }

  async function handleSend() {
    if (disabled) return
    // Phase 1 send-by-email — require a client email. The Send button is
    // already disabled in this state, so this is a belt-and-suspenders
    // guard for the desktop WorkspaceHead path which doesn't see the
    // hasClientEmail wrapper.
    if (!hasClientEmail) {
      toastError('Add a client email first', 'Open the client card to add an email, then send.')
      return
    }
    hapticTap()
    setBusy('send')
    try {
      const result = await buildPdf()

      // 1. Save to job-files first so the server can pull the PDF by
      // path with service-role privileges. Upload failure aborts the
      // send — without the PDF on storage the email can't carry it.
      const blob = result.doc.output('blob')
      const rowId = crypto.randomUUID()
      const path = `${userId}/${contact.id}/${rowId}.pdf`
      const { error: upErr } = await supabase.storage
        .from('job-files')
        .upload(path, blob, { upsert: false, contentType: 'application/pdf' })
      if (upErr) {
        throw new Error(`Couldn't save the proposal PDF: ${upErr.message}`)
      }
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
      if (insErr) {
        // Soft-fail — the file is in storage even if the audit row missed.
        console.warn('[quote] fh_job_files row insert failed', insErr)
      }

      // 2. Ask the server to send. The server downloads the PDF using
      // the service role, attaches it to a Resend send, and on success
      // flips proposal_status='sent' + quote_sent_at + logs activity.
      // Status is NOT optimistically updated client-side — we want the
      // pill to stay 'draft' until the email actually went out.
      const sendRes = await fetch('/api/send-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contact.id,
          sender_user_id: userId,
          recipient_email: contact.email,
          recipient_name: contact.name || null,
          storage_path: path,
          filename: result.filename
        })
      })
      const sendBody = await sendRes.json().catch(() => ({}))

      if (sendRes.status === 503 && sendBody?.error === 'sender_not_configured') {
        toastError(
          'Email sender is not configured yet',
          "The PDF is saved to Files. Ask whoever set up the deploy to add the Resend keys."
        )
        // Still offer the local download so the operator can email manually.
        downloadPdf(result)
        return
      }
      if (!sendRes.ok || !sendBody?.ok) {
        throw new Error(sendBody?.detail || sendBody?.error || 'Email send failed.')
      }

      // 3. Server already updated quote_sent_at + proposal_status. Pull
      // the fresh contact so the status pill reflects 'sent' immediately.
      if (fetchAll) await fetchAll()

      toastSuccess(
        `Proposal sent to ${contact.email}`,
        result.filename
      )
    } catch (e) {
      toastError("Couldn't send proposal", e?.message || 'Try again')
    } finally {
      setBusy(null)
    }
  }

  return (
    /* Phase 4 — Estimate workspace.
       Mobile (<900px): stacks vertically as before. Each section
       carries its existing padding/margin so the mobile layout is
       byte-for-byte identical to pre-Phase-4.
       Desktop (>=900px): the .fh-quote-workspace CSS in global.css
       reflows the workspace into two panes — left = items + terms
       (the builder), right = context + actions + approve (the
       sticky decision rail). The data + handlers below are
       unchanged. */
    <div className="fh-quote-workspace">
      {/* Desktop-only header strip: eyebrow ID + serif headline + the
          two key actions on the far right. CSS hides the strip below
          900px because the StatusPill + ActionBar already serve this
          job in the mobile flow. */}
      <WorkspaceHead
        contact={contact}
        status={status}
        baseCount={baseCount}
        busy={busy}
        disabled={disabled}
        sendDisabled={sendDisabled}
        sendDisabledReason={sendDisabledReason}
        onPreview={handlePreview}
        onSend={handleSend}
      />

      <div className="fh-quote-workspace__main">
        {/* StatusPill is mobile-primary identity; on desktop it's
            duplicated by the WorkspaceHead eyebrow. CSS hides this
            instance on desktop so the head reads as the single
            identity moment. */}
        <div className="fh-quote-workspace__status-mobile" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <StatusPill status={status} />
          <QuoteViewToggle value={docMode} onChange={setDocMode} />
        </div>

        {docMode === 'document' ? (
          <DocumentPreviewPane
            company={company}
            contact={contact}
            items={docItems}
            loading={docItemsLoading}
            insurance={insurance}
            changeOrders={changeOrders}
          />
        ) : (
          <>
            <QuoteItemsSection
              jobId={contact?.id}
              userId={userId}
              onContactRefresh={fetchAll}
            />

            <QuoteTermsSection
              contact={contact}
              patch={patch}
              valuesRef={termsValuesRef}
            />

            <ChangeOrdersSection
              contact={contact}
              userId={userId}
              changeOrders={changeOrders}
              onChange={() => fetchAll?.()}
            />
          </>
        )}
      </div>

      <aside className="fh-quote-workspace__side">
        {/* Job + client context — name, address, stage, total, status.
            Renders only on desktop (CSS-hidden on mobile because the
            global ContactDetail Header already shows this above
            the tabs). */}
        <ContextCard contact={contact} status={status} />

        <ActionBar
          baseCount={baseCount}
          busy={busy}
          disabled={disabled}
          sendDisabled={sendDisabled}
          sendDisabledReason={sendDisabledReason}
          onPreview={handlePreview}
          onDownload={handleDownload}
          onSend={handleSend}
          onShare={handleShare}
        />

        <ApproveBand
          contact={contact}
          baseCount={baseCount}
          busy={busy}
          pastQuote={pastQuote}
          onOpenApprove={onOpenApprove}
        />

        <ClearDraftBand
          contact={contact}
          baseCount={baseCount}
          clearing={clearing}
          onClearDraft={handleClearDraft}
        />
      </aside>
    </div>
  )
}

/* ============================================================
   Phase 2/3 — Quote view toggle + ProposalTemplate preview pane.
   Builder mode = existing CRUD editor (untouched). Document mode
   replaces the builder pane with the customer-facing render so the
   contractor can see exactly what's about to ship.
   ============================================================ */
function QuoteViewToggle({ value, onChange }) {
  const opts = [
    { v: 'builder',  label: 'Builder' },
    { v: 'document', label: 'Document' }
  ]
  return (
    <div
      role="tablist"
      aria-label="Quote view"
      style={{
        display: 'inline-flex',
        padding: 2,
        borderRadius: 999,
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border)',
        flexShrink: 0
      }}
    >
      {opts.map((o) => {
        const on = value === o.v
        return (
          <button
            key={o.v}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => { if (!on) { hapticTap(); onChange(o.v) } }}
            style={{
              padding: '6px 12px',
              minHeight: 32,
              borderRadius: 999,
              border: 0,
              background: on ? 'var(--v3-primary-soft)' : 'transparent',
              color: on ? 'var(--v3-primary)' : 'var(--v3-text-muted)',
              fontFamily: 'var(--font-body)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: on ? 'default' : 'pointer',
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function DocumentPreviewPane({ company, contact, items, loading, insurance = null, changeOrders = [] }) {
  // Group line items by their `section` field so each trade renders
  // as its own ScopeSectionCard. Order is preserved (groupByOrdered).
  // Optional items (is_optional=true) split into the upgrades array;
  // excluded items become a bullet list under "Exclusions".
  const { scopeSections, upgrades, exclusions, baseTotal, upgradeTotal } = mapItemsToScope(items)
  const status = (contact?.proposal_status || 'draft').toLowerCase()
  const docStatus = status === 'approved' ? 'approved'
    : status === 'sent' ? 'sent'
    : status === 'expired' ? 'expired'
    : 'draft'

  // When the quote is approved, pull the most recent approval snapshot
  // so the preview can stamp the captured signature + date onto the
  // ApprovalBlock. Stays null for draft / sent / expired quotes — the
  // block then renders blank signature lines.
  const [approval, setApproval] = useState(null)
  useEffect(() => {
    let cancelled = false
    if (status !== 'approved' || !contact?.id) {
      setApproval(null)
      return
    }
    ;(async () => {
      const { data } = await supabase
        .from('fh_quote_versions')
        .select('approved_by_name, approved_at, signature_kind, signature_data, approval_method')
        .eq('contact_id', contact.id)
        .eq('status', 'approved')
        .order('approved_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (cancelled || !data) return
      const isDrawn = data.signature_kind === 'drawn'
      setApproval({
        mode: 'approved',
        clientName: data.approved_by_name,
        clientSignatureDataUrl: isDrawn ? data.signature_data : null,
        clientApprovedAt: data.approved_at,
        contractorSignatureDataUrl: null,
        contractorApprovedAt: null
      })
    })()
    return () => { cancelled = true }
  }, [status, contact?.id])

  return (
    <div
      style={{
        padding: '8px 0 24px',
        // Cream backdrop so the white letter-paper sits visibly on
        // the dark workspace surface without floating.
        background: '#2a2520',
        margin: '0 -16px',
        paddingLeft: 12,
        paddingRight: 12,
        borderRadius: 8
      }}
    >
      {loading && (
        <div style={{
          padding: '24px',
          textAlign: 'center',
          color: 'var(--v3-text-muted)',
          fontFamily: 'var(--font-body)',
          fontSize: 13
        }}>
          Loading preview…
        </div>
      )}
      {!loading && (
        <ProposalTemplate
          company={company}
          contact={contact}
          project={{
            title: contact?.job_title || contact?.name || 'Construction services',
            address: contact?.address || ''
          }}
          scopeSections={scopeSections}
          upgrades={upgrades}
          pricing={{
            baseTotal,
            upgradeTotal,
            discount: 0,
            taxRate: 0
          }}
          warrantyText={contact?.terms_text || company?.warranty_default || ''}
          exclusions={exclusions}
          insurance={insurance}
          changeOrders={changeOrders}
          approval={approval}
          meta={{
            issuedAt: contact?.quote_sent_at || contact?.created_at,
            expiresAt: contact?.quote_expires_at || null
          }}
          status={docStatus}
        />
      )}
    </div>
  )
}

/**
 * Translate flat fh_quote_items rows into the ProposalTemplate's
 * scope-section shape. Sections are derived from the free-text
 * `section` column (preserved order — first-seen wins). Items with
 * is_optional=true split out to `upgrades`; is_excluded=true items
 * become bullet strings under `exclusions`.
 */
/* ============================================================
   ClearDraftBand — destructive action to wipe the working draft
   (line items + scope/terms/exclusions/expiration + reset status).
   Safety: BLOCKED when the quote is approved — approval history in
   fh_quote_versions is the immutable record and shouldn't appear
   to be wiped by a "clear draft" gesture. Renders nothing when
   the line-item count is 0 AND status is draft (nothing to clear).
   ============================================================ */
function ClearDraftBand({ contact, baseCount, clearing, onClearDraft }) {
  const status = (contact?.proposal_status || 'draft').toLowerCase()
  const isApproved = status === 'approved'
  const isEmptyDraft = status === 'draft' && baseCount === 0

  // Hide entirely when there's nothing to clear (clean slate). Render
  // the safe-wording variant when approved.
  if (isEmptyDraft) return null

  if (isApproved) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 6,
        padding: '12px 14px',
        borderRadius: 12,
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border)'
      }}>
        <span className="v3-eyebrow" style={{ color: 'var(--v3-text-muted)' }}>
          Approved quote
        </span>
        <p style={{
          margin: 0,
          fontFamily: 'var(--font-body)',
          fontSize: 11, lineHeight: 1.5,
          color: 'var(--v3-text-muted)'
        }}>
          Approved quotes cannot be deleted. Create a revision instead.
        </p>
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      padding: '12px 14px',
      borderRadius: 12,
      background: 'var(--v3-surface)',
      border: '1px solid var(--v3-border)'
    }}>
      <span className="v3-eyebrow" style={{ color: 'var(--v3-text-muted)' }}>
        Reset draft
      </span>
      <p style={{
        margin: 0,
        fontFamily: 'var(--font-body)',
        fontSize: 11, lineHeight: 1.5,
        color: 'var(--v3-text-muted)'
      }}>
        Removes all line items and draft scope, exclusions, terms, and expiration. The job, client, files, and any payments are unaffected.
      </p>
      <motion.button
        type="button"
        whileTap={{ scale: clearing ? 1 : 0.98 }}
        onClick={onClearDraft}
        disabled={clearing}
        aria-disabled={clearing}
        style={{
          alignSelf: 'flex-start',
          minHeight: 36,
          padding: '8px 14px',
          borderRadius: 10,
          background: 'transparent',
          border: '1px solid color-mix(in srgb, var(--v3-danger-bright) 35%, transparent)',
          color: 'var(--v3-danger-bright)',
          fontFamily: 'var(--font-body)',
          fontSize: 12, fontWeight: 700, letterSpacing: '0.04em',
          cursor: clearing ? 'not-allowed' : 'pointer',
          opacity: clearing ? 0.55 : 1,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          WebkitTapHighlightColor: 'transparent',
          touchAction: 'manipulation'
        }}
      >
        <Trash2 size={13} aria-hidden="true" />
        {clearing ? 'Clearing…' : 'Delete draft quote'}
      </motion.button>
    </div>
  )
}

/* ============================================================
   WorkspaceHead — desktop-only header strip.

   Reference: desktop-flows-2.jsx DesktopEstimate header row —
   eyebrow ("EST-... · DRAFT v3 · saved 6 min ago"), serif H1 with
   gold-italic accent on the second word, subtitle (client + address +
   target start), Preview + Send buttons on the right.

   We don't have a discrete "EST-" identifier — the contact id +
   proposal_status is the closest equivalent. saved-ago hint omitted
   (we'd need to track a separate dirty timestamp).
   ============================================================ */
function WorkspaceHead({ contact, status, baseCount, busy, disabled, sendDisabled, sendDisabledReason, onPreview, onSend }) {
  const idShort = contact?.id ? `EST · ${String(contact.id).slice(0, 8).toUpperCase()}` : 'ESTIMATE'
  const statusLabel = (status?.label || 'Draft').toUpperCase()
  const titleText = contact?.job_title || contact?.name || 'Estimate'
  const subBits = [
    contact?.name && contact.job_title ? contact.name : null,
    contact?.address || null
  ].filter(Boolean)

  return (
    <header className="fh-quote-workspace__head" aria-hidden={false}>
      <div className="fh-quote-workspace__head-text">
        <span className="fh-quote-workspace__head-eyebrow">
          {idShort} · {statusLabel}
        </span>
        <h1 className="fh-quote-workspace__head-title">
          {titleText}
        </h1>
        {subBits.length > 0 && (
          <p className="fh-quote-workspace__head-sub">
            {subBits.join(' · ')}
          </p>
        )}
      </div>
      <div className="fh-quote-workspace__head-actions">
        <button
          type="button"
          className="fh-quote-workspace__head-btn"
          onClick={() => { if (!disabled) onPreview?.() }}
          disabled={disabled}
        >
          <Eye size={14} aria-hidden="true" />
          {busy === 'preview' ? 'Opening…' : 'Preview'}
        </button>
        <button
          type="button"
          className="fh-quote-workspace__head-btn fh-quote-workspace__head-btn--primary"
          onClick={() => { if (!sendDisabled) onSend?.() }}
          disabled={sendDisabled}
          title={sendDisabledReason || undefined}
        >
          <Send size={14} aria-hidden="true" />
          {busy === 'send' ? 'Sending…' : 'Send to client'}
        </button>
      </div>
    </header>
  )
}

/* ============================================================
   ContextCard — desktop-only client + job context card on the
   workspace side rail. Reads contact + derived status only —
   no fetches, no writes. CSS-hidden on mobile because
   ContactDetail Header already surfaces this info above the tabs.
   ============================================================ */
function ContextCard({ contact, status }) {
  const total = Number(contact?.amount || 0)
  const moneyFmt = (n) => Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  })

  return (
    <section className="fh-quote-workspace__context" aria-label="Client context">
      <div className="fh-quote-workspace__context-row">
        <span className="fh-quote-workspace__context-key">Client</span>
        <span className="fh-quote-workspace__context-val">{contact?.name || '—'}</span>
      </div>
      {contact?.address && (
        <div className="fh-quote-workspace__context-row">
          <span className="fh-quote-workspace__context-key">Address</span>
          <span className="fh-quote-workspace__context-val">{contact.address}</span>
        </div>
      )}
      {contact?.stage && (
        <div className="fh-quote-workspace__context-row">
          <span className="fh-quote-workspace__context-key">Stage</span>
          <span className="fh-quote-workspace__context-val">
            {String(contact.stage).charAt(0).toUpperCase() + String(contact.stage).slice(1)}
          </span>
        </div>
      )}
      <div className="fh-quote-workspace__context-row fh-quote-workspace__context-row--total">
        <span className="fh-quote-workspace__context-key">Quote total</span>
        <span className="fh-quote-workspace__context-val fh-quote-workspace__context-total">
          {moneyFmt(total)}
        </span>
      </div>
      <div className="fh-quote-workspace__context-row">
        <span className="fh-quote-workspace__context-key">Status</span>
        <span
          className="fh-quote-workspace__context-val"
          style={{ color: status?.tone === 'gold' ? 'var(--v3-primary)'
            : status?.tone === 'good' ? 'var(--v3-good, #6FB387)'
            : status?.tone === 'danger' ? 'var(--v3-danger-bright)'
            : 'var(--v3-text-muted)' }}
        >
          {status?.label || 'Draft'}
          {status?.sub && <span style={{ display: 'block', fontSize: 10, color: 'var(--v3-text-muted)', marginTop: 2 }}>{status.sub}</span>}
        </span>
      </div>
    </section>
  )
}

/* ============================================================
   Approve band — primary "Approve Quote" CTA when status allows.
   When status='approved', shows a muted approved badge plus a
   small "Approve a new version" link so re-approval requires an
   intentional tap (no accidental double-approval). Phase 4C-2.
   ============================================================ */
function ApproveBand({ contact, baseCount, busy, pastQuote = false, onOpenApprove }) {
  const status = (contact?.proposal_status || 'draft').toLowerCase()
  const explicitlyApproved = status === 'approved'
  // Either the operator pressed Approve, or the pipeline has already
  // advanced past quote — in both cases the proposal is effectively
  // locked from the customer's POV.
  const isApproved = explicitlyApproved || (pastQuote && status !== 'rejected')
  const canApprove = !isApproved && baseCount > 0 && !busy
  const approvedAt = contact?.updated_at && explicitlyApproved ? contact.updated_at : null

  if (isApproved) {
    const implicit = !explicitlyApproved && pastQuote
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
            {implicit ? 'Approved · job stage' : 'Quote approved'}
          </span>
        </div>
        <p style={{
          margin: 0,
          fontFamily: 'var(--font-body)',
          fontSize: 11, lineHeight: 1.5,
          color: 'var(--v3-text-muted)'
        }}>
          {implicit
            ? 'This job has already moved past the quote phase, so the proposal is treated as approved. Lock the snapshot below if you want to freeze the current line items, scope, and terms as the official approved version.'
            : `Approval saved${approvedAt ? ` · ${shortDate(approvedAt)}` : ''}. Future edits to items, scope, terms, or exclusions don't change what the customer agreed to.`}
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
          {implicit ? 'Lock the snapshot' : 'Approve a new version'}
        </button>
      </div>
    )
  }

  const helper = baseCount === 0
    ? 'Add at least one base line item to enable approval.'
    : 'Saves a permanent record of the customer-approved quote. Different from sending the PDF — use this when the customer says yes.'

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
function ActionBar({ baseCount, busy, disabled, sendDisabled, sendDisabledReason, onPreview, onDownload, onSend, onShare }) {
  const helperLine = sendDisabledReason
    ? sendDisabledReason
    : 'Generates the proposal PDF and emails it directly to the client. Marks the quote as sent on success. This is not the same as Approve — use Approve when the customer says yes.'

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
        <SecondaryButton
          icon={<LinkIcon size={14} aria-hidden="true" />}
          label={busy === 'share' ? 'Minting…' : 'Share link'}
          onClick={onShare}
          disabled={disabled}
        />
        <PrimaryButton
          icon={<Send size={14} aria-hidden="true" />}
          label={busy === 'send' ? 'Sending…' : 'Send Proposal'}
          onClick={onSend}
          disabled={sendDisabled}
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
function deriveStatus(contact, pastQuote = false) {
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

  // Job has advanced past the quote phase but the explicit Approve
  // button was never tapped (manual stage advance, legacy data, etc).
  // Treat as approved so the pill / banner / approve band don't keep
  // claiming "Draft" on a job that's already invoicing or closed.
  // Rejected stays rejected — that's a terminal "lost" state.
  if (pastQuote && raw !== 'approved' && raw !== 'rejected') {
    label = 'Approved'
    tone = 'good'
    sub = 'Implied by job stage'
    return { label, tone, sub }
  }

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

/**
 * Pull project photos for this job and resolve each storage_path to a
 * signed URL the PDF generator can fetch. Best-effort:
 *   - skips photos with no storage_path
 *   - tolerates per-photo signed-URL failures (filtered out)
 *   - returns [] when the table query fails so the renderer falls
 *     through to its placeholder zones cleanly
 *
 * Each entry returns { url, section_tag, caption } so the renderer can
 * route a tagged photo to its matching scope block. section_tag is
 * sourced from the photo's caption when present (e.g., a caption of
 * "Roofing" tags the photo for the Roofing scope) — a lightweight
 * convention that doesn't require a schema change.
 */
async function loadProjectPhotosForPdf(jobId, userId) {
  if (!jobId || !userId) return []
  const { data, error } = await supabase
    .from('fh_job_files')
    .select('id, storage_path, caption, section_tag, kind, uploaded_at')
    .eq('job_id', jobId)
    .eq('user_id', userId)
    .eq('kind', 'photo')
    .order('uploaded_at', { ascending: true })
    .limit(8)
  if (error || !Array.isArray(data) || data.length === 0) return []

  // Sign each path. Failures filter out — the renderer handles missing
  // photos via placeholders without throwing.
  const signed = await Promise.all(
    data.map(async (row) => {
      try {
        const { data: signedRes, error: signErr } = await supabase.storage
          .from('job-photos')
          .createSignedUrl(row.storage_path, 60 * 60)
        if (signErr || !signedRes?.signedUrl) return null
        // section_tag (migration 020) is the source of truth; legacy
        // photos that used the caption-as-tag convention before the
        // column existed fall back so they still distribute correctly.
        const tag = (row.section_tag || '').trim()
          || (row.caption || '').trim()
          || null
        return {
          url: signedRes.signedUrl,
          section_tag: tag,
          caption: row.caption || null
        }
      } catch {
        return null
      }
    })
  )
  return signed.filter(Boolean)
}
