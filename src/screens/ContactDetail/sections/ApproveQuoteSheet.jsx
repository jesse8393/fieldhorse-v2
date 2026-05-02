import { useEffect, useMemo, useState } from 'react'
import { Lock, AlertTriangle } from 'lucide-react'
import ActionSheet, { SheetField, SheetChipRow } from '../../../components/ActionSheet.jsx'
import { supabase } from '../../../lib/supabase.js'
import { useProfile } from '../../../contexts/ProfileContext.jsx'
import { toastError, toastSuccess } from '../../../lib/toast.js'
import { hapticStageChange } from '../../../lib/haptics.js'
import { approveQuote as pipelineApproveQuote } from '../../../lib/pipeline.js'

/**
 * Approve Quote sheet — Phase 4C-2.
 *
 * Operator-side approval flow. Builds an immutable snapshot from the
 * current contact + fh_quote_items + scope/terms/exclusions and calls
 * fn_approve_quote_version (013) which:
 *   - assigns the next version_number
 *   - inserts the snapshot row with status='approved'
 *   - supersedes any prior approved versions for this contact
 *   - flips fh_contacts.proposal_status to 'approved'
 *   - sets fh_contacts.approved_quote_version_id pointer
 *
 * If the operator leaves "Move to Job and schedule kickoff" checked
 * (default), the existing approveQuote() pipeline helper fires AFTER
 * the RPC succeeds: stage='quote' → 'job', kickoff schedule entry
 * tomorrow 9–5. Snapshot lock is the source of truth; stage advance
 * is a follow-on pipeline action so a network blip on the second
 * call doesn't unlock the snapshot.
 *
 * Signature capture (4C-4) and approval-stamped PDF (4C-3) come
 * later; the sheet writes signature_kind=null / signature_data=null
 * for now and the function accepts those defaults.
 */

const METHODS = [
  { value: 'verbal',    label: 'Verbal' },
  { value: 'text',      label: 'Text' },
  { value: 'email',     label: 'Email' },
  { value: 'in_person', label: 'In person' }
]

function money(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  })
}

// Compute a deterministic-ish quote number for the snapshot.
// Mirrors the helper in pdf.js so the approval record carries the
// same identifier the PDF will stamp later in 4C-3.
function makeQuoteNumber(contactId) {
  const d = new Date()
  const y = d.getFullYear().toString().slice(-2)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const tail = contactId
    ? String(contactId).replace(/-/g, '').slice(-4).toUpperCase()
    : Math.random().toString(36).slice(2, 6).toUpperCase()
  return `FH-Q-${y}${m}-${tail}`
}

export default function ApproveQuoteSheet({ open, contact, userId, onClose, onApproved }) {
  const { profile } = useProfile()

  const [method, setMethod] = useState('verbal')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [moveToJob, setMoveToJob] = useState(true)

  const [items, setItems] = useState([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  // Reset every time the sheet opens, then fetch fresh items so the
  // snapshot reflects truth-of-the-moment (not a stale cache from the
  // last open).
  useEffect(() => {
    if (!open) return
    setMethod('verbal')
    setName('')
    setEmail(contact?.email || '')
    setNote('')
    setMoveToJob(true)
    setErr('')
    setSubmitting(false)
    if (!contact?.id || !userId) { setItems([]); return }
    let alive = true
    setLoadingItems(true)
    ;(async () => {
      const { data, error } = await supabase
        .from('fh_quote_items')
        .select('*')
        .eq('contact_id', contact.id)
        .eq('user_id', userId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
      if (!alive) return
      if (error) {
        setErr(error.message)
        setItems([])
      } else {
        setItems(data || [])
      }
      setLoadingItems(false)
    })()
    return () => { alive = false }
  }, [open, contact?.id, contact?.updated_at, userId])

  const totals = useMemo(() => {
    let base = 0, optional = 0, excludedCount = 0, baseCount = 0, optionalCount = 0
    for (const i of items) {
      const amt = Number(i.amount || 0)
      if (i.is_excluded) excludedCount += 1
      else if (i.is_optional) { optional += amt; optionalCount += 1 }
      else { base += amt; baseCount += 1 }
    }
    return { base, optional, baseCount, optionalCount, excludedCount }
  }, [items])

  const expiresExpired = useMemo(() => {
    if (!contact?.quote_expires_at) return false
    const t = new Date(contact.quote_expires_at).getTime()
    return Number.isFinite(t) && t < Date.now()
  }, [contact?.quote_expires_at])

  const baseDisabled = totals.baseCount === 0 || loadingItems
  const formInvalid = !name.trim() || !method
  const commitDisabled = baseDisabled || formInvalid || submitting

  async function handleCommit() {
    if (commitDisabled) return
    setErr('')

    if (totals.baseCount === 0) {
      setErr('Add at least one base line item before approving.')
      return
    }
    if (!name.trim()) {
      setErr('Approved by name is required.')
      return
    }

    setSubmitting(true)
    try {
      const company = {
        name: profile?.company_name || profile?.full_name || 'My Company',
        address: profile?.company_address || '',
        phone: profile?.company_phone || '',
        email: profile?.email || ''
      }

      const snapshot = {
        quote_number: makeQuoteNumber(contact.id),
        snapshot_taken_at: new Date().toISOString(),
        company,
        contact: {
          id: contact.id,
          name: contact.name || null,
          address: contact.address || null,
          phone: contact.phone || null,
          email: contact.email || null,
          job_title: contact.job_title || null
        },
        scope_text: contact.scope_text || null,
        terms_text: contact.terms_text || null,
        exclusions_text: contact.exclusions_text || null,
        quote_expires_at: contact.quote_expires_at || null,
        items: items.map((i) => ({
          section: i.section || null,
          description: i.description,
          qty: Number(i.qty || 0),
          unit: i.unit || null,
          rate: Number(i.rate || 0),
          amount: Number(i.amount || 0),
          notes: i.notes || null,
          is_optional: !!i.is_optional,
          is_excluded: !!i.is_excluded,
          sort_order: Number(i.sort_order || 0)
        })),
        totals: {
          base: totals.base,
          optional: totals.optional,
          excluded_count: totals.excludedCount
        }
      }

      const { data: rpcData, error: rpcErr } = await supabase.rpc('fn_approve_quote_version', {
        p_user_id: userId,
        p_contact_id: contact.id,
        p_snapshot: snapshot,
        p_base_total: totals.base,
        p_optional_total: totals.optional,
        p_excluded_count: totals.excludedCount,
        p_approval_method: method,
        p_approved_by_name: name.trim(),
        p_approved_by_email: email.trim() || null,
        p_approval_note: note.trim() || null,
        p_signature_kind: null,
        p_signature_data: null
      })
      if (rpcErr) {
        console.error('[approve-quote] RPC error:', { rpc: rpcErr })
        throw rpcErr
      }

      // Require a row with an id. supabase-js may return the composite
      // result either as a single object or wrapped in a one-element
      // array depending on PostgREST representation; tolerate both.
      const versionRow = Array.isArray(rpcData) ? rpcData[0] : rpcData
      if (!versionRow || !versionRow.id) {
        console.error('[approve-quote] RPC returned no row:', { rpc: rpcData })
        throw new Error('Approval did not save. Your snapshot was not created — check your connection and try again.')
      }

      // Hard readback guard — the RPC's "success" claim is not enough.
      // A second authenticated SELECT must find the row in
      // fh_quote_versions filtered by id + user_id. This catches any
      // case where supabase-js / PostgREST returned a phantom row that
      // didn't actually persist (schema cache stub, transaction roll
      // back, mismatched project, etc.). Until this read returns the
      // row, we refuse to advance stage or show success.
      const { data: confirmed, error: verifyErr } = await supabase
        .from('fh_quote_versions')
        .select('id, contact_id, version_number, status, approved_by_name, base_total, approved_at')
        .eq('id', versionRow.id)
        .eq('user_id', userId)
        .maybeSingle()

      if (verifyErr) {
        console.error('[approve-quote] readback error:', { rpc: rpcData, verify: verifyErr })
        throw verifyErr
      }
      if (!confirmed) {
        console.error('[approve-quote] readback returned no row:', { rpc: rpcData, confirmed })
        throw new Error('Approval did not verify. Snapshot row was not found after save.')
      }

      // Stage advance only runs after the snapshot is confirmed persisted
      // by a real SELECT. Failure here logs but does not unlock the
      // snapshot — proposal_status is already 'approved' on the server.
      let stageNote = ''
      if (moveToJob) {
        try {
          hapticStageChange()
          const res = await pipelineApproveQuote(contact)
          if (res?.error) throw res.error
          stageNote = ' · Moved to Job'
        } catch (stageErr) {
          console.warn('[approve-quote] stage advance failed:', stageErr)
          stageNote = ' · Stage advance failed — set Job manually'
        }
      }

      toastSuccess(`Quote approved${stageNote}`, `Locked snapshot v${confirmed.version_number} · ${money(totals.base)}`)
      onApproved?.()
      onClose?.()
    } catch (e) {
      console.error('[approve-quote] failed:', e)
      setErr(e?.message || 'Approval failed. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ActionSheet
      open={open}
      title={'Approve quote.'}
      accentWord="Approve"
      sectionLabel="Approve"
      stepCount={2}
      currentStep={submitting ? 2 : 1}
      commitLabel={submitting ? 'Approving…' : 'Approve quote'}
      commitBusy={submitting}
      commitDisabled={commitDisabled}
      onClose={onClose}
      onCommit={handleCommit}
    >
      {err && (
        <div className="fh-sheet-error" role="alert">
          <span className="fh-sheet-error__dot" aria-hidden="true" />
          <span className="fh-sheet-error__text">{err}</span>
          <button
            type="button"
            className="fh-sheet-error__dismiss"
            aria-label="Dismiss error"
            onClick={() => setErr('')}
          >
            ×
          </button>
        </div>
      )}

      {/* SUMMARY */}
      <div style={{
        padding: '12px 14px', borderRadius: 12,
        background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border)',
        display: 'flex', flexDirection: 'column', gap: 6
      }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          gap: 10, flexWrap: 'wrap'
        }}>
          <span style={{
            fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
            color: 'var(--v3-text)'
          }}>
            {contact?.name || 'Job'}
            {contact?.job_title ? ` · ${contact.job_title}` : ''}
          </span>
          <span style={{
            fontFamily: 'var(--font-display)', fontSize: 18, lineHeight: 1,
            color: 'var(--v3-primary)', fontVariantNumeric: 'tabular-nums'
          }}>
            {money(totals.base)}
          </span>
        </div>
        <div style={{
          fontFamily: 'var(--font-body)', fontSize: 11,
          color: 'var(--v3-text-muted)'
        }}>
          {loadingItems
            ? 'Loading items…'
            : `${totals.baseCount} base · ${totals.optionalCount} optional${totals.optional > 0 ? ` (${money(totals.optional)})` : ''} · ${totals.excludedCount} excluded`}
        </div>
        {contact?.proposal_status === 'sent' && contact?.quote_sent_at && (
          <div style={{
            fontFamily: 'var(--font-body)', fontSize: 11,
            color: 'var(--v3-text-muted)'
          }}>
            Sent {relativeAgo(contact.quote_sent_at)}
          </div>
        )}
      </div>

      {/* Lock notice */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        padding: '10px 12px', borderRadius: 10,
        background: 'var(--v3-primary-soft)',
        border: '1px solid color-mix(in srgb, var(--v3-primary) 32%, transparent)'
      }}>
        <Lock size={14} aria-hidden="true" style={{ color: 'var(--v3-primary)', marginTop: 2, flexShrink: 0 }} />
        <span style={{
          fontFamily: 'var(--font-body)', fontSize: 11.5, lineHeight: 1.45,
          color: 'var(--v3-text)'
        }}>
          This creates the approved quote snapshot — a permanent record of what the customer agreed to. Different from sending the PDF (Send Quote). Edits made later won't change what was approved.
        </span>
      </div>

      {expiresExpired && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          padding: '10px 12px', borderRadius: 10,
          background: 'rgba(179, 58, 58, 0.10)',
          border: '1px solid rgba(179, 58, 58, 0.40)'
        }}>
          <AlertTriangle size={14} aria-hidden="true" style={{ color: 'var(--v3-danger-bright, #D26A6A)', marginTop: 2, flexShrink: 0 }} />
          <span style={{
            fontFamily: 'var(--font-body)', fontSize: 11.5, lineHeight: 1.45,
            color: 'var(--v3-text)'
          }}>
            This quote expired on {shortDate(contact?.quote_expires_at)}. You can still approve it — confirm the customer is OK with the original price.
          </span>
        </div>
      )}

      {/* METHOD */}
      <SheetChipRow
        label="How was it approved?"
        value={method}
        options={METHODS}
        onChange={setMethod}
      />

      {/* NAME */}
      <SheetField label="Approved by">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={contact?.name || 'Customer name'}
        />
      </SheetField>

      {/* EMAIL (optional) */}
      <SheetField label="Email (optional)">
        <input
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@domain.com"
        />
      </SheetField>

      {/* NOTE */}
      <SheetField label="Note (optional)">
        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Confirmed by phone Friday morning, deposit on Monday."
        />
      </SheetField>

      {/* MOVE TO JOB */}
      <label style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '10px 12px', borderRadius: 10,
        background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border)',
        cursor: 'pointer'
      }}>
        <input
          type="checkbox"
          checked={moveToJob}
          onChange={(e) => setMoveToJob(e.target.checked)}
          style={{ marginTop: 2, accentColor: 'var(--v3-primary)' }}
        />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{
            fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
            color: 'var(--v3-text)'
          }}>
            Move to Job and schedule kickoff
          </span>
          <span style={{
            fontFamily: 'var(--font-body)', fontSize: 11, lineHeight: 1.45,
            color: 'var(--v3-text-muted)'
          }}>
            Advances stage to Job and adds a kickoff to your calendar tomorrow 9–5. Uncheck if you're approving paperwork before the start date is set.
          </span>
        </span>
      </label>

      {totals.baseCount === 0 && !loadingItems && (
        <div style={{
          padding: '10px 12px', borderRadius: 10,
          background: 'var(--v3-surface-2)', border: '1px dashed var(--v3-border-strong)',
          fontFamily: 'var(--font-body)', fontSize: 11.5, lineHeight: 1.45,
          color: 'var(--v3-text-muted)'
        }}>
          Add at least one base line item on the Quote tab before approving.
        </div>
      )}
    </ActionSheet>
  )
}

function shortDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function relativeAgo(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const dayMs = 86400000
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  const now = new Date()
  const yesterday = new Date(now.getTime() - dayMs)
  if (sameDay(d, now)) return 'today'
  if (sameDay(d, yesterday)) return 'yesterday'
  const days = Math.floor((now.getTime() - d.getTime()) / dayMs)
  if (days >= 1 && days < 30) return `${days}d ago`
  return shortDate(iso)
}
