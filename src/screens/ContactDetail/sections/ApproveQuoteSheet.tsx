import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Lock, AlertTriangle, ShieldCheck, X, Check } from 'lucide-react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { supabase } from '../../../lib/supabase.ts'
import { useProfile } from '../../../contexts/ProfileContext.tsx'
import { toastError, toastSuccess } from '../../../lib/toast.ts'
import { hapticStageChange, hapticTap } from '../../../lib/haptics.ts'
import { approveQuote as pipelineApproveQuote } from '../../../lib/pipeline.ts'
import { generateQuote } from '../../../lib/pdf.js'
import SignaturePad from '../../../components/SignaturePad.tsx'
import { useDrawerKeyboard } from '../../../lib/useDrawerKeyboard.ts'

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
  { value: 'verbal',           label: 'Verbal' },
  { value: 'text',             label: 'Text' },
  { value: 'email',            label: 'Email' },
  { value: 'in_person',        label: 'In person' },
  { value: 'signature_drawn',  label: 'Signature (drawn)' },
  { value: 'signature_typed',  label: 'Signature (typed)' },
  // Customer e-sign writes its own approval through /api/public-link-approve
  // when the customer hits the share link, so this chip is reserved as a
  // hint pointing operators at that flow instead of being a recordable
  // method here. Disabled with explanatory hint.
  { value: 'esign_link',       label: 'Customer link', disabled: true, hint: 'Customers can sign themselves via Quote → Share link. Those approvals are recorded automatically.' }
]

function money(n: any) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  })
}

// Compute a deterministic-ish quote number for the snapshot.
// Mirrors the helper in pdf.js so the approval record carries the
// same identifier the PDF will stamp later in 4C-3.
function makeQuoteNumber(contactId: any) {
  const d = new Date()
  const y = d.getFullYear().toString().slice(-2)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const tail = contactId
    ? String(contactId).replace(/-/g, '').slice(-4).toUpperCase()
    : Math.random().toString(36).slice(2, 6).toUpperCase()
  return `FH-Q-${y}${m}-${tail}`
}

export default function ApproveQuoteSheet({ open, contact, userId, onClose, onApproved }: any) {
  const { profile } = useProfile()

  const [method, setMethod] = useState('verbal')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [moveToJob, setMoveToJob] = useState(true)
  // Signature state (4C-4b). signatureKind mirrors the schema enum
  // ('drawn' | 'typed' | null). signatureData is either a PNG data URL
  // (drawn) or plain text (typed). Both null when method is non-signature.
  const [signatureKind, setSignatureKind] = useState<any>(null)
  const [signatureData, setSignatureData] = useState<any>(null)

  const [items, setItems] = useState<any[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')
  const { formRef, drawerStyle, formStyle } = useDrawerKeyboard(open)

  // Reset every time the sheet opens, then fetch fresh items so the
  // snapshot reflects truth-of-the-moment (not a stale cache from the
  // last open).
  useEffect(() => {
    if (!open) return
    setMethod('verbal')
    // Pre-fill approved-by with the contact's name so the commit
    // button is enabled out of the gate; operator can edit before
    // submit. Avoids the "placeholder looks filled but submit is
    // disabled" trap from the prior empty-string default.
    setName(contact?.name || '')
    setEmail(contact?.email || '')
    setNote('')
    setMoveToJob(true)
    setSignatureKind(null)
    setSignatureData(null)
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

  // Method change controller — clean transition between modes so stale
  // signature data never leaks across kinds. Typed mode seeds signatureData
  // with the current name field ONCE on transition (per spec); subsequent
  // edits in either field don't override each other.
  function handleMethodChange(next: any) {
    if (next === method) return
    hapticTap()
    setMethod(next)
    if (next === 'signature_drawn') {
      setSignatureKind('drawn')
      setSignatureData(null) // canvas starts blank
    } else if (next === 'signature_typed') {
      setSignatureKind('typed')
      setSignatureData(name.trim() || '')
    } else {
      setSignatureKind(null)
      setSignatureData(null)
    }
  }

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
      // Full branding shape — matches what generateQuote() (4D-2C) reads.
      // The snapshot stores only the 4 customer-visible fields below; the
      // wider object is also passed to generateQuote at certificate time
      // so the approved PDF carries the contractor's logo/accent/trust.
      const company = {
        name: profile?.company_name || profile?.full_name || 'My Company',
        address: profile?.company_address || '',
        phone: profile?.company_phone || '',
        email: profile?.company_email || (profile as any)?.email || '',
        website: profile?.company_website || '',
        logo_url: profile?.logo_url || null,
        brand_accent_hex: profile?.brand_accent_hex || null,
        license_number: profile?.license_number || '',
        insured_text: profile?.insured_text || '',
        warranty_default: profile?.warranty_default || ''
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

      // Normalize signature payload — non-signature methods send null
      // for both fields regardless of any stale local state. Empty
      // typed strings collapse to null so SQL `is null` checks work.
      const isSigMethod = method === 'signature_drawn' || method === 'signature_typed'
      const sigKindOut = isSigMethod ? signatureKind : null
      const sigDataOut = isSigMethod && signatureData && String(signatureData).trim().length > 0
        ? signatureData
        : null

      const { data: rpcData, error: rpcErr } = await supabase.rpc('fn_approve_quote_version', {
        p_user_id: userId,
        p_contact_id: contact.id,
        p_snapshot: snapshot,
        p_base_total: totals.base,
        p_optional_total: totals.optional,
        p_excluded_count: totals.excludedCount,
        p_approval_method: method,
        p_approved_by_name: name.trim(),
        p_approved_by_email: (email.trim() || null) as any,
        p_approval_note: (note.trim() || null) as any,
        p_signature_kind: sigKindOut,
        p_signature_data: sigDataOut
      })
      if (rpcErr) {
        console.error('[approve-quote] RPC error:', { rpc: rpcErr })
        throw new Error('Approval could not be saved. Please try again.')
      }

      // Require a row with an id. supabase-js may return the composite
      // result either as a single object or wrapped in a one-element
      // array depending on PostgREST representation; tolerate both.
      const versionRow = Array.isArray(rpcData) ? rpcData[0] : rpcData
      if (!versionRow || !versionRow.id) {
        console.error('[approve-quote] RPC returned no row:', { rpc: rpcData })
        throw new Error('Approval could not be saved. Please try again.')
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
        .select(
          'id, contact_id, version_number, status, approved_by_name, ' +
          'approved_by_email, approval_method, approval_note, ' +
          'base_total, approved_at, snapshot, ' +
          'signature_kind, signature_data'
        )
        .eq('id', versionRow.id)
        .eq('user_id', userId)
        .maybeSingle()

      if (verifyErr) {
        console.error('[approve-quote] readback error:', { rpc: rpcData, verify: verifyErr })
        throw new Error('Approval could not be saved. Please try again.')
      }
      if (!confirmed) {
        console.error('[approve-quote] readback returned no row:', { rpc: rpcData, confirmed })
        throw new Error('The approval was sent, but we couldn\'t confirm it saved. Please try again.')
      }

      // Approval-stamped PDF archive (Phase 4C-3) — generate the
      // approved variant, upload to job-files, insert fh_job_files row,
      // and update fh_quote_versions.pdf_file_id. Wrapped: any failure
      // becomes a toast suffix but does NOT roll back the approval. The
      // snapshot row is the legal record; the PDF is an artifact.
      //
      // Three-state result distinguishes archive-OK from link-OK so the
      // toast reflects truth: 'Saved to Files' is never claimed without
      // a real fh_job_files row, and 'linked' is never claimed without
      // a verified pdf_file_id readback.
      let archiveNote = ''
      try {
        const archiveResult = await archiveApprovedPdf({
          confirmed, snapshot, company, contact, userId
        })
        if (!archiveResult.ok) {
          archiveNote = ' · PDF save failed'
          console.warn('[approve-quote] archive failed:', archiveResult.error)
        } else if (!archiveResult.linked) {
          // File row exists in Files tab — operator-visible success.
          // Internal version-link gap is a developer concern; suppress
          // from user-facing toast per copy spec.
          archiveNote = ' · Saved to Files'
          console.warn('[approve-quote] file archived but version link verify failed')
        } else {
          archiveNote = ' · Saved to Files'
        }
      } catch (archiveErr) {
        console.warn('[approve-quote] archive threw:', archiveErr)
        archiveNote = ' · PDF save failed'
      }

      // Stage advance only runs after the approval record is persisted
      // by a real SELECT. Failure here logs but does not unwind the
      // approval — proposal_status is already 'approved' on the server.
      // Stage advance proceeds independently of PDF archive outcome.
      let stageNote = ''
      if (moveToJob) {
        try {
          hapticStageChange()
          const res = await pipelineApproveQuote(contact)
          if (res?.error) throw res.error
          stageNote = ' · Moved to Job'
        } catch (stageErr) {
          console.warn('[approve-quote] stage advance failed:', stageErr)
          stageNote = ' · Job stage update failed'
        }
      }

      toastSuccess(
        `Quote approved${archiveNote}${stageNote}`,
        `Approved version ${(confirmed as any).version_number} · ${money(totals.base)}`
      )

      // Write a contractor inbox notification (migration 008). Tap-
      // through lands on the job. Best-effort — never breaks the
      // approval flow on RLS / missing-table.
      try {
        await supabase.from('fh_notifications').insert({
          user_id: userId,
          kind: 'quote_approved',
          title: `Quote approved · ${money(totals.base)}`,
          body: `${contact?.name || 'Client'} signed off via ${method}`,
          link: `/jobs/${contact.id}`
        })
      } catch {}

      onApproved?.()
      onClose?.()
    } catch (e: any) {
      console.error('[approve-quote] failed:', e)
      // Use the message we threw when it's one of ours; otherwise
      // fall back to a generic human message. Technical/Postgres
      // strings stay in the console for diagnostics, never surfaced.
      const ours = e?.message && /^(Approval|The approval|Add at least)/.test(e.message)
      setErr(ours ? e.message : 'Approval could not be saved. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }
  const fieldStyle: import('react').CSSProperties = {
    padding: '11px 14px',
    borderRadius: 12,
    background: 'var(--surface-2)',
    border: '1px solid var(--rule)',
    color: 'var(--ink-strong)',
    fontFamily: 'var(--font-body)',
    fontSize: 14,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    scrollMarginTop: 96,
    scrollMarginBottom: 120
  }

  return (
    <Drawer open={open} onOpenChange={(v: any) => { if (!v && !submitting) onClose?.() }}>
      <DrawerContent
        className="ui:max-w-full ui:overflow-x-hidden"
        style={drawerStyle}
      >
        <DrawerHeader className="ui:text-left" style={{ maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
            <ShieldCheck size={12} />
            Approve
          </div>
          <DrawerTitle asChild>
            <h2
              className="fh-font-serif"
              style={{ margin: '6px 0 0', fontSize: 'clamp(22px, 6vw, 28px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}
            >
              Lock the approved quote.
            </h2>
          </DrawerTitle>
          <DrawerDescription
            style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.45 }}
          >
            Creates a permanent record of what <strong style={{ color: 'var(--ink-strong)' }}>{contact?.name || 'this customer'}</strong> agreed to. Future edits to items or terms won't change this snapshot.
          </DrawerDescription>
        </DrawerHeader>

        <form
          ref={formRef}
          onSubmit={(e) => { e.preventDefault(); handleCommit() }}
          style={formStyle({ gap: 14 })}
        >
          {err && (
            <div role="alert" style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '10px 12px', borderRadius: 10,
              background: 'rgba(179, 58, 58, 0.10)',
              border: '1px solid rgba(179, 58, 58, 0.40)',
              color: 'var(--ink-strong)',
              fontFamily: 'var(--font-body)', fontSize: 12, lineHeight: 1.45
            }}>
              <AlertTriangle size={14} aria-hidden="true" style={{ color: 'var(--alert-red, #b3493b)', marginTop: 2, flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{err}</span>
              <button
                type="button"
                aria-label="Dismiss error"
                onClick={() => setErr('')}
                style={{
                  background: 'transparent', border: 'none', padding: 0,
                  color: 'var(--ink-muted)', cursor: 'pointer',
                  fontSize: 16, lineHeight: 1
                }}
              >
                ×
              </button>
            </div>
          )}

          {/* SUMMARY card */}
          <div style={{
            padding: '12px 14px', borderRadius: 12,
            background: 'var(--surface-2)', border: '1px solid var(--rule)',
            display: 'flex', flexDirection: 'column', gap: 6
          }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              gap: 10, flexWrap: 'wrap'
            }}>
              <span style={{
                fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
                color: 'var(--ink-strong)'
              }}>
                {contact?.name || 'Job'}
                {contact?.job_title ? ` · ${contact.job_title}` : ''}
              </span>
              <span style={{
                fontFamily: 'var(--font-display)', fontSize: 18, lineHeight: 1,
                color: 'var(--field-gold-bright)', fontVariantNumeric: 'tabular-nums'
              }}>
                {money(totals.base)}
              </span>
            </div>
            <div style={{
              fontFamily: 'var(--font-body)', fontSize: 11,
              color: 'var(--ink-muted)'
            }}>
              {loadingItems
                ? 'Loading items…'
                : `${totals.baseCount} base · ${totals.optionalCount} optional${totals.optional > 0 ? ` (${money(totals.optional)})` : ''} · ${totals.excludedCount} excluded`}
            </div>
            {contact?.proposal_status === 'sent' && contact?.quote_sent_at && (
              <div style={{
                fontFamily: 'var(--font-body)', fontSize: 11,
                color: 'var(--ink-muted)'
              }}>
                Sent {relativeAgo(contact.quote_sent_at)}
              </div>
            )}
          </div>

          {/* Lock notice */}
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            padding: '10px 12px', borderRadius: 10,
            background: 'rgba(201,150,58,0.10)',
            border: '1px solid rgba(201,150,58,0.30)'
          }}>
            <Lock size={14} aria-hidden="true" style={{ color: 'var(--field-gold-bright)', marginTop: 2, flexShrink: 0 }} />
            <span style={{
              fontFamily: 'var(--font-body)', fontSize: 11.5, lineHeight: 1.45,
              color: 'var(--ink-strong)'
            }}>
              Different from sending the PDF. Use this when the customer says yes — line items, scope, and terms freeze at this moment.
            </span>
          </div>

          {expiresExpired && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '10px 12px', borderRadius: 10,
              background: 'rgba(179, 58, 58, 0.10)',
              border: '1px solid rgba(179, 58, 58, 0.40)'
            }}>
              <AlertTriangle size={14} aria-hidden="true" style={{ color: 'var(--alert-red, #b3493b)', marginTop: 2, flexShrink: 0 }} />
              <span style={{
                fontFamily: 'var(--font-body)', fontSize: 11.5, lineHeight: 1.45,
                color: 'var(--ink-strong)'
              }}>
                This quote expired on {shortDate(contact?.quote_expires_at)}. You can still approve — just confirm the customer is OK with the original price.
              </span>
            </div>
          )}

          {/* METHOD chips */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={labelStyle}>How was it approved?</span>
            <div role="radiogroup" aria-label="How was it approved?" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {METHODS.map((opt) => {
                const on = method === opt.value
                const dis = !!opt.disabled
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-disabled={dis}
                    disabled={dis || submitting}
                    title={opt.hint || undefined}
                    onClick={() => { if (!dis) handleMethodChange(opt.value) }}
                    style={{
                      padding: '7px 12px',
                      borderRadius: 999,
                      border: on
                        ? '1px solid rgba(201,150,58,0.4)'
                        : '1px solid var(--rule)',
                      background: on
                        ? 'rgba(201,150,58,0.14)'
                        : 'var(--surface-2)',
                      color: dis
                        ? 'var(--ink-faint, var(--ink-muted))'
                        : on
                          ? 'var(--field-gold-bright)'
                          : 'var(--ink-muted)',
                      fontFamily: 'var(--font-body)',
                      fontSize: 12, fontWeight: 700,
                      cursor: dis ? 'not-allowed' : (submitting ? 'wait' : 'pointer'),
                      opacity: dis ? 0.5 : 1,
                      transition: 'all 160ms ease'
                    }}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
            {METHODS.find((m) => m.value === 'esign_link')?.hint && (
              <span style={{
                fontFamily: 'var(--font-body)', fontSize: 11,
                color: 'var(--ink-faint, var(--ink-muted))', lineHeight: 1.45
              }}>
                {METHODS.find((m: any) => m.value === 'esign_link')?.hint}
              </span>
            )}
          </div>

          {/* SIGNATURE */}
          {method === 'signature_drawn' && (
            <SignaturePad
              value={signatureData}
              onChange={setSignatureData}
              label="Customer signature"
              hint="Optional — use this when the customer signs in person."
              height={150}
            />
          )}
          {method === 'signature_typed' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labelStyle}>Customer signature</span>
              <input
                type="text"
                value={signatureData || ''}
                onChange={(e) => setSignatureData(e.target.value)}
                placeholder={name || 'Customer types their name'}
                disabled={submitting}
                style={fieldStyle}
              />
              <span style={{
                fontSize: 11, lineHeight: 1.45,
                color: 'var(--ink-faint, var(--ink-muted))',
                fontFamily: 'var(--font-body)'
              }}>
                Optional — use this when the customer signs in person.
              </span>
            </label>
          )}

          {/* NAME */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>Approved by *</span>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={contact?.name || 'Customer name'}
              disabled={submitting}
              required
              style={fieldStyle}
            />
          </label>

          {/* EMAIL (optional) */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>Email (optional)</span>
            <input
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@domain.com"
              disabled={submitting}
              style={fieldStyle}
            />
          </label>

          {/* NOTE */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>Note (optional)</span>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Confirmed by phone Friday morning, deposit on Monday."
              disabled={submitting}
              style={{ ...fieldStyle, resize: 'vertical', minHeight: 64 }}
            />
          </label>

          {/* MOVE TO JOB */}
          <label style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '10px 12px', borderRadius: 10,
            background: 'var(--surface-2)', border: '1px solid var(--rule)',
            cursor: submitting ? 'wait' : 'pointer'
          }}>
            <input
              type="checkbox"
              checked={moveToJob}
              disabled={submitting}
              onChange={(e) => setMoveToJob(e.target.checked)}
              style={{ marginTop: 3, width: 16, height: 16, accentColor: 'var(--field-gold-bright)' }}
            />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{
                fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
                color: 'var(--ink-strong)'
              }}>
                Move to Job and schedule kickoff
              </span>
              <span style={{
                fontFamily: 'var(--font-body)', fontSize: 11, lineHeight: 1.45,
                color: 'var(--ink-muted)'
              }}>
                Advances stage to Job and adds a kickoff to your calendar tomorrow 9–5. Uncheck if you're approving paperwork before the start date is set.
              </span>
            </span>
          </label>

          {totals.baseCount === 0 && !loadingItems && (
            <div style={{
              padding: '10px 12px', borderRadius: 10,
              background: 'var(--surface-2)', border: '1px dashed var(--rule)',
              fontFamily: 'var(--font-body)', fontSize: 11.5, lineHeight: 1.45,
              color: 'var(--ink-muted)'
            }}>
              Add at least one base line item on the Quote tab before approving.
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={() => onClose?.()}
              disabled={submitting}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '12px 14px', borderRadius: 12,
                background: 'var(--surface-2)', border: '1px solid var(--rule)',
                color: 'var(--ink-strong)',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
                cursor: submitting ? 'wait' : 'pointer'
              }}
            >
              <X size={14} />
              Cancel
            </button>
            <motion.button
              type="submit"
              whileTap={{ scale: commitDisabled ? 1 : 0.98 }}
              disabled={commitDisabled}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '12px 14px', borderRadius: 12, border: 'none',
                background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
                color: 'var(--onyx)',
                fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: '0.14em',
                cursor: commitDisabled ? 'not-allowed' : 'pointer',
                boxShadow: '0 6px 16px rgba(201,150,58,0.3)',
                opacity: commitDisabled ? 0.55 : 1
              }}
            >
              <Check size={14} />
              {submitting ? 'APPROVING…' : 'APPROVE QUOTE'}
            </motion.button>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  )
}

/**
 * Archive the approval-stamped proposal PDF (Phase 4C-3).
 *
 * Source of truth split:
 *   - PDF body content (items, scope, terms, exclusions, expires_at,
 *     quote_number) reads from the persisted `snapshot` JSONB. This is
 *     the legal record of what was approved.
 *   - Visual chrome (logo, brand accent, website, license, insured,
 *     warranty) reads from current `company` profile because branding
 *     is the contractor's identity, not a per-quote agreement.
 *   - Approval metadata (version_number, approved_at, etc.) reads from
 *     the `confirmed` row, never optimistic local state.
 *
 * Returns { ok: true, fileId } on full success, { ok: false, error }
 * on any failure. Caller treats failure as a non-blocking warning;
 * the snapshot stays approved either way.
 */
async function archiveApprovedPdf({ confirmed, snapshot, company, contact, userId }: any) {
  try {
    // Approval shape — keys match what the v3 ApprovalBlock /
    // drawApprovalSection consume (Phase 4b). The new draw helper
    // gates on approval.mode === 'approved' to decide whether to
    // stamp the signature image / name + date over the blank lines;
    // drawn signatures land via clientSignatureDataUrl, typed via
    // clientName italic rendering when no dataUrl is present.
    //
    // Legacy camelCase keys (versionNumber, signatureKind, etc.) are
    // retained on the same object for the older certificate-page
    // metadata renderer that's been replaced — keeping them costs
    // nothing and survives any consumer that still reads them.
    const isDrawn = confirmed.signature_kind === 'drawn'
    const isTyped = confirmed.signature_kind === 'typed'
    const approval = {
      // v3 ApprovalBlock shape
      mode: 'approved',
      clientName: confirmed.approved_by_name,
      clientSignatureDataUrl: isDrawn ? confirmed.signature_data : null,
      // Typed signatures stamp as italic name + date — pass the typed
      // text through clientName when it differs from the printed name.
      // (drawApprovalSection renders italic name only when dataUrl is
      // null, so this is safe for both branches.)
      clientApprovedAt: confirmed.approved_at,
      // Contractor side stays blank — the contractor's countersign
      // happens out-of-band today; the field remains an empty line on
      // the cert for them to physically sign when handing over.
      contractorSignatureDataUrl: null,
      contractorApprovedAt: null,
      // Legacy fields — preserved for any reader still on the old shape.
      versionNumber: confirmed.version_number,
      quoteNumber: snapshot?.quote_number || null,
      method: confirmed.approval_method,
      approvedByName: confirmed.approved_by_name,
      approvedByEmail: confirmed.approved_by_email || '',
      approvalNote: confirmed.approval_note || '',
      baseTotal: Number(confirmed.base_total || 0),
      approvedAt: confirmed.approved_at,
      signatureKind: confirmed.signature_kind || null,
      signatureData: confirmed.signature_data || null,
      isTyped
    }

    // Use snapshot for content; fall back to fresh inputs if any field
    // is unexpectedly missing from the JSONB.
    const result = await generateQuote({
      company,
      contact: snapshot?.contact || {
        id: contact.id,
        name: contact.name,
        address: contact.address,
        phone: contact.phone,
        email: contact.email,
        job_title: contact.job_title
      },
      items: Array.isArray(snapshot?.items) ? snapshot.items : [],
      scope: snapshot?.scope_text || '',
      terms: snapshot?.terms_text || '',
      exclusions: snapshot?.exclusions_text || '',
      expiresAt: snapshot?.quote_expires_at || null,
      status: 'approved',
      quoteId: contact.id,
      approval
    } as any)
    if (!result?.doc) return { ok: false, error: new Error('Generator returned no doc') }

    const blob = result.doc.output('blob')
    const rowId = crypto.randomUUID()
    const safeName = (contact.name || 'client').replace(/\s+/g, '_')
    const filename = `Approved_Quote_${approval.quoteNumber || result.number}_${safeName}_v${approval.versionNumber}.pdf`
    const path = `${userId}/${contact.id}/${rowId}.pdf`

    const { error: upErr } = await supabase.storage
      .from('job-files')
      .upload(path, blob, { upsert: false, contentType: 'application/pdf' })
    if (upErr) return { ok: false, error: upErr }

    const { data: insertedFile, error: insErr } = await supabase
      .from('fh_job_files')
      .insert({
        id: rowId,
        user_id: userId,
        job_id: contact.id,
        filename,
        storage_path: path,
        mime_type: 'application/pdf',
        size_bytes: blob.size || 0,
        kind: 'file'
      })
      .select('id')
      .single()
    if (insErr || !insertedFile?.id) {
      return { ok: false, error: insErr || new Error('fh_job_files insert returned no row') }
    }

    // Link the file to the version row, then VERIFY the link landed.
    // Bare .update() returns no error for 0-row matches (PostgREST 204
    // No Content), so we re-select the row and compare pdf_file_id
    // against the file id. This catches any case where the UPDATE
    // silently no-ops without raising — RLS edge cases, stale auth
    // state, filter mismatches.
    const { error: linkErr } = await supabase
      .from('fh_quote_versions')
      .update({ pdf_file_id: rowId })
      .eq('id', confirmed.id)
      .eq('user_id', userId)
    if (linkErr) {
      console.warn('[approve-quote] pdf_file_id link errored:', linkErr)
      // File archived OK, link errored — still return ok+!linked.
      return { ok: true, linked: false, fileId: rowId, linkError: linkErr }
    }

    const { data: linkCheck, error: checkErr } = await supabase
      .from('fh_quote_versions')
      .select('pdf_file_id')
      .eq('id', confirmed.id)
      .maybeSingle()
    if (checkErr) {
      console.warn('[approve-quote] pdf_file_id verify errored:', checkErr)
      return { ok: true, linked: false, fileId: rowId, linkError: checkErr }
    }
    const linked = linkCheck?.pdf_file_id === rowId
    if (!linked) {
      console.warn('[approve-quote] pdf_file_id verify mismatch:', {
        expected: rowId,
        actual: linkCheck?.pdf_file_id ?? null
      })
    }
    return { ok: true, linked, fileId: rowId }
  } catch (e: any) {
    return { ok: false, error: e }
  }
}

function shortDate(iso: any) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function relativeAgo(iso: any) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const dayMs = 86400000
  const sameDay = (a: any, b: any) =>
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
