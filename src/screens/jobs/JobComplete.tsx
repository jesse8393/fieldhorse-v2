import { createUuid } from '../../lib/uuid.ts'
// Mark a job complete, /jobs/:id/complete (Phase 9, Task 13, D57). It took
// the place of the closeout sheet: the warranty, the customer's approval
// and a closing note, saved as the fh_closeouts row that moves the job to
// Closed. Opened on a closed job it shows the record on file to correct,
// with the certificate to download or send, and Reopen job, which deletes
// the record and asks with a second tap.

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Field, SkeletonRows } from '../../components/fh'
import CreateShell, { Choices } from '../new/CreateShell.tsx'
import { useProfile } from '../../contexts/ProfileContext.tsx'
import { supabase, authHeaders } from '../../lib/supabase.ts'
import {
  SIGNOFF_METHODS, WARRANTY_PRESETS,
  loadCloseout, saveCloseout, clearCloseout, snapshotJobTotals, closeoutBalance
} from '../../lib/closeout.ts'
import { toastError, toastSuccess } from '../../lib/toast.ts'
import { hapticError, hapticSuccess } from '../../lib/haptics.ts'
import { todayYmd } from '../../lib/dates.ts'
import { useSecondTap } from '../../lib/secondTap.ts'
import { JobScreenFallback, money, useJobScreen } from './jobScreen.tsx'

// The pdf chunk is large and only needed for a certificate.
async function loadPdf(): Promise<any> {
  return import('../../lib/pdf.js')
}

const WARRANTIES = WARRANTY_PRESETS.map((w) => ({ value: String(w.id), label: w.label }))
const SIGNOFFS = SIGNOFF_METHODS.map((m) => ({ value: m.id, label: m.label }))

export default function JobComplete() {
  const { id } = useParams()
  const { user, data, home, goBack } = useJobScreen(id)
  if (!data.contact || data.loading) return <JobScreenFallback title="Mark complete" saveLabel="Mark complete" data={data} home={home} />
  return <CompleteForm key={data.contact.id} data={data} userId={user?.id} goBack={goBack} home={home} />
}

function CompleteForm({ data, userId, goBack, home }: { data: ReturnType<typeof useJobScreen>['data']; userId: string | undefined; goBack: () => void; home: string }) {
  // The parent renders this form only once the job is in.
  const contact = data.contact as NonNullable<typeof data.contact>
  const { profile } = useProfile()
  const [loading, setLoading] = useState(true)
  const [existing, setExisting] = useState<any>(null)
  const [totals, setTotals] = useState({ paid: 0, photoCount: 0, approvedCO: 0 })
  const [warrantyStart, setWarrantyStart] = useState(todayYmd())
  const [warrantyMonths, setWarrantyMonths] = useState('12')
  const [signoffMethod, setSignoffMethod] = useState('verbal')
  const [signoffName, setSignoffName] = useState(contact.name || '')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const reopenTap = useSecondTap()

  useEffect(() => {
    let alive = true
    setLoading(true)
    void Promise.all([
      loadCloseout({ userId, contactId: contact.id }),
      snapshotJobTotals({ userId, contactId: contact.id })
    ]).then(([row, snap]) => {
      if (!alive) return
      setExisting(row || null)
      setTotals(snap)
      if (row) {
        setWarrantyStart(row.warranty_start_date || todayYmd())
        setWarrantyMonths(String(row.warranty_months ?? 12))
        setSignoffMethod(row.signoff_method || 'verbal')
        setSignoffName(row.signoff_name || '')
        setNotes(row.notes || '')
      }
      setLoading(false)
    }).catch(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [userId, contact.id])

  const onFile = !!existing
  const contractTotal = Number(contact.amount || 0) + Number(totals.approvedCO || 0)
  const balance = closeoutBalance(contact.amount, totals.approvedCO, totals.paid)
  const title = onFile ? 'Closeout on file' : 'Mark this job complete'

  async function save() {
    if (saving || loading) return
    if (signoffMethod === 'signature_typed' && !signoffName.trim()) {
      hapticError()
      setError('A typed signature needs the customer name.')
      return
    }
    setSaving(true)
    setError(undefined)
    try {
      await saveCloseout({
        userId,
        contact,
        payload: {
          warranty_start_date: warrantyStart || null,
          warranty_months: Number(warrantyMonths) || 0,
          signoff_method: signoffMethod,
          signoff_name: signoffName,
          notes
        }
      })
      hapticSuccess()
      toastSuccess(onFile ? 'Closeout updated' : 'Job marked complete', signoffName ? `Signed off by ${signoffName.trim()}` : 'Closeout recorded')
      await data.fetchAll()
      goBack()
    } catch (e) {
      hapticError()
      const message = (e as { message?: string })?.message || 'Unknown error'
      setError(message)
      toastError("Couldn't save closeout", message)
      setSaving(false)
    }
  }

  // Reopen deletes the record and moves the job back, so it asks with a
  // second tap on the same button (D57).
  function reopen() {
    if (!onFile || saving || busy) return
    reopenTap.tap(() => {
      void (async () => {
        setBusy(true)
        try {
          await clearCloseout({ userId, contact, reopenTo: 'job' })
          hapticSuccess()
          toastSuccess('Job reopened', 'Back on the active board')
          await data.fetchAll()
          goBack()
        } catch (e) {
          hapticError()
          toastError("Couldn't reopen", (e as { message?: string })?.message || 'Unknown error')
          setBusy(false)
        }
      })()
    })
  }

  function companyPayload() {
    return {
      name: profile?.company_name || profile?.full_name || 'My Company',
      address: profile?.company_address || '',
      phone: profile?.company_phone || '',
      email: profile?.company_email || (profile as any)?.email || '',
      website: profile?.company_website || '',
      logo_url: profile?.logo_url || null,
      brand_accent_hex: profile?.brand_accent_hex || null,
      license_number: profile?.license_number || '',
      insured_text: profile?.insured_text || ''
    }
  }

  async function downloadCertificate() {
    if (!onFile || busy) return
    setBusy(true)
    try {
      const { generateCertificate, downloadPdf } = await loadPdf()
      const result = await generateCertificate({ company: companyPayload(), contact, closeout: existing })
      downloadPdf(result)
      hapticSuccess()
      toastSuccess('Certificate ready', result.filename)
    } catch (e) {
      hapticError()
      toastError("Couldn't build certificate", (e as { message?: string })?.message || 'Unknown error')
    } finally {
      setBusy(false)
    }
  }

  async function sendCertificate() {
    if (!onFile || busy || !userId) return
    const recipient = (contact.email || '').trim()
    if (!recipient) {
      hapticError()
      toastError('Add a client email first', 'Open the client to add an email, then send again.')
      return
    }
    setBusy(true)
    try {
      // The PDF is built here and saved to job-files, so the server can
      // attach it; the row on fh_job_files shows it on the Files tab.
      const { generateCertificate, downloadPdf } = await loadPdf()
      const result = await generateCertificate({ company: companyPayload(), contact, closeout: existing })
      const blob = result.doc.output('blob')
      const rowId = createUuid()
      const path = `${userId}/${contact.id}/${rowId}.pdf`
      const { error: upErr } = await supabase.storage.from('job-files').upload(path, blob, { upsert: false, contentType: 'application/pdf' })
      if (upErr) throw new Error(`Couldn't save the certificate PDF: ${upErr.message}`)
      try {
        await supabase.from('fh_job_files').insert({
          id: rowId, user_id: userId, job_id: contact.id, filename: result.filename,
          storage_path: path, mime_type: 'application/pdf', size_bytes: blob.size || 0, kind: 'file'
        })
      } catch { /* the file itself landed; the send does not need the index row */ }
      const sendRes = await fetch('/api/send-certificate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          contact_id: contact.id, sender_user_id: userId, recipient_email: recipient,
          recipient_name: contact.name || null, storage_path: path, filename: result.filename
        })
      })
      const sendBody = await sendRes.json().catch(() => ({}))
      if (sendRes.status === 503 && sendBody?.error === 'sender_not_configured') {
        toastError('Email is not set up yet', 'The PDF is saved to Files, share it yourself.')
        downloadPdf(result)
        return
      }
      if (!sendRes.ok || !sendBody?.ok) throw new Error(sendBody?.detail || sendBody?.error || 'The email did not go out.')
      hapticSuccess()
      toastSuccess(`Certificate sent to ${recipient}`, result.filename)
    } catch (e) {
      hapticError()
      toastError("Couldn't send certificate", (e as { message?: string })?.message || 'Unknown error')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <CreateShell title="Mark complete" saveLabel="Mark complete" saveDisabled backTo={home} onSave={() => {}}>
        <SkeletonRows rows={4} label="Loading the closeout" />
      </CreateShell>
    )
  }

  return (
    <CreateShell
      title={title}
      saveLabel={onFile ? 'Save closeout' : 'Mark complete'}
      saving={saving}
      error={error}
      backTo={home}
      onSave={save}
    >
      <p className="fhja-lede">
        {onFile
          ? `The record for ${contact.name || 'this job'}. Correct it here, or reopen the job to put it back on the board.`
          : `Closes ${contact.name || 'this job'} with the warranty and the customer's approval on record.`}
      </p>
      <dl className="fhja-facts">
        <div className="fhja-fact"><dt>Contract</dt><dd>{money(contractTotal)}</dd></div>
        <div className="fhja-fact"><dt>Paid</dt><dd>{money(totals.paid)}</dd></div>
        {balance > 0
          ? <div className="fhja-fact fhja-fact--owed"><dt>Balance</dt><dd>{money(balance)}</dd></div>
          : <div className="fhja-fact"><dt>Photos</dt><dd>{totals.photoCount}</dd></div>}
      </dl>
      <Choices label="Warranty" options={WARRANTIES} value={warrantyMonths} onChange={(v) => setWarrantyMonths(v || warrantyMonths)} />
      {Number(warrantyMonths) > 0 && (
        <Field label="Warranty starts" type="date" value={warrantyStart} onChange={(e) => setWarrantyStart(e.target.value)} />
      )}
      <Choices label="Customer approval" options={SIGNOFFS} value={signoffMethod} onChange={(v) => setSignoffMethod(v || signoffMethod)} />
      <Field
        label={signoffMethod === 'signature_typed' ? 'Customer name, as signed' : 'Approved by'}
        value={signoffName}
        autoComplete="off"
        placeholder={contact.name || 'Customer name'}
        error={error && signoffMethod === 'signature_typed' && !signoffName.trim() ? error : undefined}
        onChange={(e) => { setSignoffName(e.target.value); setError(undefined) }}
      />
      <Field label="Closing note" multiline rows={3} value={notes} placeholder="Punch list done, keys handed over" onChange={(e) => setNotes(e.target.value)} />
      {onFile && (
        <>
          <div className="fhja-pair">
            <Button variant="secondary" disabled={busy} onClick={() => { void downloadCertificate() }}>Download certificate</Button>
            <Button variant="secondary" disabled={busy} onClick={() => { void sendCertificate() }}>Send certificate</Button>
          </div>
          <div className="fhja-danger">
            <Button variant="destructive" block disabled={busy} onClick={reopen}>
              {reopenTap.armed ? 'Tap again to reopen' : 'Reopen job'}
            </Button>
            {reopenTap.armed && (
              <p className="fhja-danger__why">It moves back to Jobs, and its closeout record is deleted, with the sign off, warranty and closing notes.</p>
            )}
          </div>
        </>
      )}
    </CreateShell>
  )
}
