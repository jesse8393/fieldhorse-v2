// src/components/MarkCompleteSheet.jsx
//
// "Real system" for closing a job. Collects warranty start + duration,
// customer sign-off (method + typed name + date), an optional closing
// note, and locks the snapshot via lib/closeout.saveCloseout(). Mounts
// from the Overview tab when stage is job/invoice/closed.
//
// When opened on a job that's already been closed, the sheet hydrates
// from the existing fh_closeouts row so the operator can edit/correct
// the record instead of starting over.

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { Check, ShieldCheck, X, Calendar as CalendarIcon, Trash2, Download, Send } from 'lucide-react'
import { hapticTap, hapticSuccess, hapticError } from '../lib/haptics.ts'
import { toastSuccess, toastError } from '../lib/toast.ts'
import { useProfile } from '../contexts/ProfileContext.tsx'
import { supabase } from '../lib/supabase.ts'
import { useDrawerKeyboard } from '../lib/useDrawerKeyboard.ts'
import { generateCertificate, downloadPdf } from '../lib/pdf.js'
import {
  SIGNOFF_METHODS, WARRANTY_PRESETS,
  loadCloseout, saveCloseout, clearCloseout, snapshotJobTotals
} from '../lib/closeout.ts'

function moneyFmt(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  })
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

export default function MarkCompleteSheet({ open, userId, contact, onClose, onSaved }) {
  const { profile } = useProfile()
  const [warrantyStart, setWarrantyStart] = useState(todayIso())
  const [warrantyMonths, setWarrantyMonths] = useState(12)
  const [signoffMethod, setSignoffMethod] = useState('verbal')
  const [signoffName, setSignoffName] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [existing, setExisting] = useState(null)
  const [totals, setTotals] = useState({ paid: 0, photoCount: 0 })
  const { formRef, drawerStyle, formStyle } = useDrawerKeyboard(open)

  const balance = Math.max(0, Number(contact?.amount || 0) - totals.paid)
  const isReopening = !!existing

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    ;(async () => {
      const [row, snap] = await Promise.all([
        loadCloseout({ userId, contactId: contact?.id }),
        snapshotJobTotals({ userId, contactId: contact?.id })
      ])
      if (!alive) return
      setExisting(row || null)
      setTotals(snap)
      if (row) {
        setWarrantyStart(row.warranty_start_date || todayIso())
        setWarrantyMonths(row.warranty_months ?? 12)
        setSignoffMethod(row.signoff_method || 'verbal')
        setSignoffName(row.signoff_name || '')
        setNotes(row.notes || '')
      } else {
        setWarrantyStart(todayIso())
        setWarrantyMonths(12)
        setSignoffMethod('verbal')
        setSignoffName(contact?.name || '')
        setNotes('')
      }
      setLoading(false)
    })()
    return () => { alive = false }
  }, [open, userId, contact?.id, contact?.name])

  async function submit(e) {
    e?.preventDefault?.()
    if (saving) return
    if (signoffMethod === 'signature_typed' && !signoffName.trim()) {
      hapticError()
      toastError('Sign-off name required', 'Typed signature needs the customer name.')
      return
    }
    setSaving(true)
    try {
      await saveCloseout({
        userId,
        contact,
        payload: {
          warranty_start_date: warrantyStart || null,
          warranty_months: warrantyMonths,
          signoff_method: signoffMethod,
          signoff_name: signoffName,
          notes
        }
      })
      hapticSuccess()
      toastSuccess(
        isReopening ? 'Closeout updated' : 'Job marked complete',
        signoffName ? `Signed off by ${signoffName.trim()}` : 'Closeout recorded'
      )
      onSaved?.()
      onClose?.()
    } catch (err) {
      hapticError()
      toastError("Couldn't save closeout", err?.message || 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  async function reopen() {
    if (!isReopening || saving) return
    setSaving(true)
    try {
      await clearCloseout({ userId, contact, reopenTo: 'invoice' })
      hapticSuccess()
      toastSuccess('Job reopened', 'Stage moved back to Invoice')
      onSaved?.()
      onClose?.()
    } catch (err) {
      hapticError()
      toastError("Couldn't reopen", err?.message || 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  function buildCompanyPayload() {
    return {
      name: profile?.company_name || profile?.full_name || 'My Company',
      address: profile?.company_address || '',
      phone: profile?.company_phone || '',
      email: profile?.company_email || profile?.email || '',
      website: profile?.company_website || '',
      logo_url: profile?.logo_url || null,
      brand_accent_hex: profile?.brand_accent_hex || null,
      license_number: profile?.license_number || '',
      insured_text: profile?.insured_text || ''
    }
  }

  async function downloadCertificate() {
    if (!isReopening || saving) return
    setSaving(true)
    try {
      const result = await generateCertificate({ company: buildCompanyPayload(), contact, closeout: existing })
      downloadPdf(result)
      hapticSuccess()
      toastSuccess('Certificate ready', result.filename)
    } catch (err) {
      hapticError()
      toastError("Couldn't build certificate", err?.message || 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  async function sendCertificate() {
    if (!isReopening || saving) return
    const recipient = (contact?.email || '').trim()
    if (!recipient) {
      hapticError()
      toastError('Add a client email first', 'Open the client card to add an email, then resend.')
      return
    }
    setSaving(true)
    try {
      // 1. Build the PDF in-memory, then upload to job-files so the
      //    server function can pull it via service role for the Resend
      //    attachment. Mirrors the QuoteTab send-quote flow.
      const result = await generateCertificate({ company: buildCompanyPayload(), contact, closeout: existing })
      const blob = result.doc.output('blob')
      const rowId = crypto.randomUUID()
      const path = `${userId}/${contact.id}/${rowId}.pdf`
      const { error: upErr } = await supabase.storage
        .from('job-files')
        .upload(path, blob, { upsert: false, contentType: 'application/pdf' })
      if (upErr) {
        throw new Error(`Couldn't save the certificate PDF: ${upErr.message}`)
      }
      // Index it on fh_job_files so it shows up in the Files tab.
      // Soft-fail if the audit row insert errors — the file itself
      // already landed and the email send doesn't depend on it.
      try {
        await supabase.from('fh_job_files').insert({
          id: rowId,
          user_id: userId,
          job_id: contact.id,
          filename: result.filename,
          storage_path: path,
          mime_type: 'application/pdf',
          size_bytes: blob.size || 0,
          kind: 'file'
        })
      } catch (e) {
        console.warn('[mark-complete] fh_job_files insert failed', e)
      }

      // 2. Server send.
      const sendRes = await fetch('/api/send-certificate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contact.id,
          sender_user_id: userId,
          recipient_email: recipient,
          recipient_name: contact.name || null,
          storage_path: path,
          filename: result.filename
        })
      })
      const sendBody = await sendRes.json().catch(() => ({}))

      if (sendRes.status === 503 && sendBody?.error === 'sender_not_configured') {
        toastError(
          'Email sender is not configured yet',
          'The PDF is saved to Files — share it manually.'
        )
        downloadPdf(result)
        return
      }
      if (!sendRes.ok || !sendBody?.ok) {
        throw new Error(sendBody?.detail || sendBody?.error || 'Email send failed.')
      }

      hapticSuccess()
      toastSuccess(`Certificate sent to ${recipient}`, result.filename)
      onSaved?.()
    } catch (err) {
      hapticError()
      toastError("Couldn't send certificate", err?.message || 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }
  const fieldStyle = {
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
    <Drawer open={open} onOpenChange={(v) => { if (!v && !saving) onClose?.() }}>
      <DrawerContent
        className="ui:max-w-full ui:overflow-x-hidden"
        style={drawerStyle}
      >
        <DrawerHeader className="ui:text-left" style={{ maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
            <ShieldCheck size={12} />
            Complete
          </div>
          <DrawerTitle asChild>
            <h2
              className="fh-font-serif"
              style={{ margin: '6px 0 0', fontSize: 'clamp(22px, 6vw, 28px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}
            >
              {isReopening ? <>Closeout on file.</> : <>Mark this job complete.</>}
            </h2>
          </DrawerTitle>
          <DrawerDescription
            style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.45 }}
          >
            {isReopening
              ? <>Edit the closeout record for <strong style={{ color: 'var(--ink-strong)' }}>{contact?.name || 'this job'}</strong>. Reopen the job to move it back into the Invoice stage.</>
              : <>Locks the warranty start, customer sign-off, and a snapshot of dollars + photos for <strong style={{ color: 'var(--ink-strong)' }}>{contact?.name || 'this job'}</strong>. Advances the stage to Complete.</>
            }
          </DrawerDescription>
        </DrawerHeader>

        <form
          ref={formRef}
          onSubmit={submit}
          style={formStyle({ gap: 14 })}
        >
          {loading ? (
            <div style={{
              padding: 16, borderRadius: 12,
              background: 'var(--surface-2)', border: '1px solid var(--rule)',
              color: 'var(--ink-muted)', fontSize: 12, fontFamily: 'var(--font-body)',
              textAlign: 'center'
            }}>
              Loading closeout…
            </div>
          ) : (
            <>
              {/* Snapshot strip */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
                padding: '12px 14px', borderRadius: 12,
                background: 'var(--surface-2)', border: '1px solid var(--rule)'
              }}>
                <Stat label="Contract" value={moneyFmt(contact?.amount)} />
                <Stat label="Paid" value={moneyFmt(totals.paid)} tone={balance > 0 ? 'muted' : 'good'} />
                <Stat label={balance > 0 ? 'Balance' : 'Photos'} value={balance > 0 ? moneyFmt(balance) : String(totals.photoCount)} tone={balance > 0 ? 'danger' : 'muted'} />
              </div>
              {balance > 0 && (
                <div style={{
                  padding: '10px 12px', borderRadius: 10,
                  background: 'color-mix(in srgb, var(--alert-red, #b3493b) 12%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--alert-red, #b3493b) 35%, transparent)',
                  color: 'var(--ink-strong)',
                  fontFamily: 'var(--font-body)', fontSize: 12, lineHeight: 1.4
                }}>
                  Heads up — there's still {moneyFmt(balance)} unpaid. You can still close the job, but the balance carries on the client's lifetime number.
                </div>
              )}

              {/* Warranty */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={labelStyle}>Warranty</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {WARRANTY_PRESETS.map((w) => {
                    const active = warrantyMonths === w.id
                    return (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => { hapticTap(); setWarrantyMonths(w.id) }}
                        disabled={saving}
                        style={chipStyle(active, saving)}
                      >
                        {w.label}
                      </button>
                    )
                  })}
                </div>
                {warrantyMonths > 0 && (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                    <span style={labelStyle}>Warranty start</span>
                    <div style={{ position: 'relative' }}>
                      <CalendarIcon size={14} style={{
                        position: 'absolute', left: 14, top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'var(--ink-muted)', pointerEvents: 'none'
                      }} />
                      <input
                        type="date"
                        value={warrantyStart}
                        onChange={(e) => setWarrantyStart(e.target.value)}
                        disabled={saving}
                        style={{ ...fieldStyle, padding: '11px 14px 11px 38px' }}
                      />
                    </div>
                  </label>
                )}
              </div>

              {/* Sign-off method */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={labelStyle}>Customer sign-off</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {SIGNOFF_METHODS.map((m) => {
                    const active = signoffMethod === m.id
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => { hapticTap(); setSignoffMethod(m.id) }}
                        disabled={saving}
                        style={chipStyle(active, saving)}
                      >
                        {m.label}
                      </button>
                    )
                  })}
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                  <span style={labelStyle}>
                    Customer name {signoffMethod === 'signature_typed' && <span style={{ color: 'var(--field-gold-bright)' }}>*</span>}
                  </span>
                  <input
                    type="text"
                    value={signoffName}
                    onChange={(e) => setSignoffName(e.target.value)}
                    placeholder={contact?.name || 'Jane Homeowner'}
                    disabled={saving}
                    style={fieldStyle}
                  />
                </label>
              </div>

              {/* Closing notes */}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={labelStyle}>Closing notes</span>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Punch list resolved, walkthrough done, etc."
                  disabled={saving}
                  style={{ ...fieldStyle, resize: 'vertical', minHeight: 84 }}
                />
              </label>

              {/* Certificate row — only when a closeout is on file.
                  Two buttons share one row: Download keeps the file
                  local; Send dispatches the email via /api/send-certificate.
                  Sits above the Cancel / Save / Reopen action grid. */}
              {isReopening && (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 8,
                  marginTop: 4
                }}>
                  <button
                    type="button"
                    onClick={() => { hapticTap(); downloadCertificate() }}
                    disabled={saving}
                    style={certificateBtnStyle('ghost', saving)}
                  >
                    <Download size={13} />
                    Download
                  </button>
                  <button
                    type="button"
                    onClick={() => { hapticTap(); sendCertificate() }}
                    disabled={saving}
                    style={certificateBtnStyle('solid', saving)}
                  >
                    <Send size={13} />
                    Send to client
                  </button>
                </div>
              )}

              {/* Actions */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: isReopening ? 'auto 1fr 1.4fr' : '1fr 1.4fr',
                gap: 10, marginTop: 4
              }}>
                {isReopening && (
                  <button
                    type="button"
                    onClick={() => { hapticTap(); reopen() }}
                    disabled={saving}
                    aria-label="Reopen job"
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      padding: '12px 12px', borderRadius: 12,
                      background: 'rgba(192,57,43,0.10)',
                      border: '1px solid rgba(192,57,43,0.35)',
                      color: 'var(--alert-red, #b3493b)',
                      fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
                      cursor: saving ? 'wait' : 'pointer'
                    }}
                  >
                    <Trash2 size={13} />
                    Reopen
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onClose?.()}
                  disabled={saving}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    padding: '12px 14px', borderRadius: 12,
                    background: 'var(--surface-2)', border: '1px solid var(--rule)',
                    color: 'var(--ink-strong)',
                    fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
                    cursor: saving ? 'wait' : 'pointer'
                  }}
                >
                  <X size={14} />
                  Cancel
                </button>
                <motion.button
                  type="submit"
                  whileTap={{ scale: saving ? 1 : 0.98 }}
                  disabled={saving}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    padding: '12px 14px', borderRadius: 12, border: 'none',
                    background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
                    color: 'var(--onyx)',
                    fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: '0.14em',
                    cursor: saving ? 'wait' : 'pointer',
                    boxShadow: '0 6px 16px rgba(201,150,58,0.3)',
                    opacity: saving ? 0.6 : 1
                  }}
                >
                  <Check size={14} />
                  {saving ? 'SAVING…' : (isReopening ? 'SAVE CHANGES' : 'MARK COMPLETE')}
                </motion.button>
              </div>
            </>
          )}
        </form>
      </DrawerContent>
    </Drawer>
  )
}

function certificateBtnStyle(variant, busy) {
  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '11px 12px', borderRadius: 12,
    fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
    letterSpacing: '0.06em', textTransform: 'uppercase',
    cursor: busy ? 'wait' : 'pointer',
    opacity: busy ? 0.7 : 1
  }
  if (variant === 'solid') {
    return {
      ...base,
      border: 'none',
      background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
      color: 'var(--onyx)',
      boxShadow: '0 6px 16px rgba(201,150,58,0.3)'
    }
  }
  return {
    ...base,
    background: 'var(--surface-2)',
    border: '1px solid color-mix(in srgb, var(--field-gold-bright) 35%, transparent)',
    color: 'var(--field-gold-bright)'
  }
}

function chipStyle(active, disabled) {
  return {
    padding: '7px 12px',
    borderRadius: 999,
    border: active
      ? '1px solid rgba(201,150,58,0.4)'
      : '1px solid var(--rule)',
    background: active
      ? 'rgba(201,150,58,0.14)'
      : 'var(--surface-2)',
    color: active
      ? 'var(--field-gold-bright)'
      : 'var(--ink-muted)',
    fontFamily: 'var(--font-body)',
    fontSize: 12,
    fontWeight: 700,
    cursor: disabled ? 'wait' : 'pointer',
    transition: 'all 160ms ease'
  }
}

function Stat({ label, value, tone = 'default' }) {
  const color = tone === 'good'
    ? 'var(--signal-green, #4ade80)'
    : tone === 'danger'
      ? 'var(--alert-red, #b3493b)'
      : 'var(--ink-strong)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{
        fontFamily: 'var(--font-body)',
        fontSize: 9, fontWeight: 700, letterSpacing: '0.16em',
        textTransform: 'uppercase', color: 'var(--ink-muted)'
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: 'var(--font-display)',
        fontSize: 16, lineHeight: 1, color,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
      }}>
        {value}
      </span>
    </div>
  )
}
