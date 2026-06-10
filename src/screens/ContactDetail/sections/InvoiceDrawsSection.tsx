// src/screens/ContactDetail/sections/InvoiceDrawsSection.tsx
//
// Progress-billing surface. Lists every fh_invoices row (draw) issued
// against the contract and lets the contractor add, edit, download
// the PDF, send via Resend, mark paid, or void each one.
//
// Schema: fh_invoices (migration 021). Each row stamps:
//   Draw # · title · amount · status · issued/due dates
//
// Math conventions used here + in the per-draw PDF call:
//   contractTotal     = contact.amount + sum(approved change orders)
//   previouslyPaid    = sum(fh_payments) (current snapshot — kept
//                         simple; per-invoice payment allocation is a
//                         future enhancement)
//   thisInvoice       = the draw's amount
//   balanceRemaining  = contractTotal − previouslyPaid (as of now)
//
// Cash jobs / small projects don't need to touch this — the existing
// single-invoice flow on the Invoice sub-tab stays exactly as it was.

import { useEffect, useState } from 'react'
import { Plus, FileEdit, Send, Download, Check, X, Trash2, FileText } from 'lucide-react'
import { supabase } from '../../../lib/supabase.ts'
import { useProfile } from '../../../contexts/ProfileContext.tsx'
import { useAuth } from '../../../contexts/AuthContext.tsx'
import { generateInvoice, downloadPdf } from '../../../lib/pdf.js'
import { toastSuccess, toastError } from '../../../lib/toast.ts'
import { DEFAULT_PAYMENT_SCHEDULE } from '../../../components/documents'

function money(n: any) {
  const v = Number(n || 0)
  return v.toLocaleString(undefined, {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0
  })
}

function shortDate(iso: any) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function isoFromDateInput(s: any) {
  if (!s) return null
  return new Date(s + 'T00:00:00').toISOString()
}

function dateInputFromIso(iso: any) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

export default function InvoiceDrawsSection({ contact, payments = [], changeOrders = [], insurance = null, userId }: any) {
  const { profile } = useProfile()
  const { user } = useAuth()
  const [draws, setDraws] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<any>(null)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<any>(null)
  const isOwner = contact && contact.user_id === userId

  // Resolved contract total = contact.amount + approved change-order
  // adjustments. Mirrors the math in InvoiceTemplate so on-screen +
  // PDF balance summaries match.
  const approvedCOAdjustment = (changeOrders || [])
    .filter((co: any) => co?.status === 'approved')
    .reduce((s: any, co: any) => s + Number(co.amount || 0), 0)
  const contractTotal = Number(contact?.amount || 0) + approvedCOAdjustment
  const previouslyPaid = (payments || []).reduce((s: any, p: any) => s + Number(p.amount || 0), 0)
  const drawsIssued = draws
    .filter((d) => d.status !== 'void')
    .reduce((s, d) => s + Number(d.amount || 0), 0)
  const unbilled = Math.max(0, contractTotal - drawsIssued)

  const fetchDraws = async () => {
    if (!contact?.id) return
    setLoading(true)
    const { data } = await supabase
      .from('fh_invoices')
      .select('*')
      .eq('contact_id', contact.id)
      .order('sequence_number', { ascending: true })
    setDraws(data || [])
    setLoading(false)
  }

  useEffect(() => { fetchDraws() }, [contact?.id])

  async function handleSave(payload: any) {
    if (!contact?.id || !userId) return false
    try {
      const row = {
        contact_id: contact.id,
        user_id: userId,
        title: payload.title?.trim() || `Draw ${(draws.length || 0) + 1}`,
        amount: Number(payload.amount) || 0,
        status: payload.status || 'draft',
        issued_at: payload.issued_at || null,
        due_at: payload.due_at || null,
        notes: payload.notes?.trim() || null
      }
      let res
      if (payload.id) {
        res = await supabase
          .from('fh_invoices')
          .update(row)
          .eq('id', payload.id)
          .select('*')
          .single()
      } else {
        res = await supabase
          .from('fh_invoices')
          .insert({ ...row, sequence_number: 0 })
          .select('*')
          .single()
      }
      if (res.error) throw res.error
      toastSuccess(payload.id ? 'Draw updated' : 'Draw added', `Draw #${res.data?.sequence_number || ''}`.trim())
      await fetchDraws()
      return true
    } catch (e: any) {
      toastError("Couldn't save draw", e?.message || 'Try again.')
      return false
    }
  }

  // Auto-create draws from the proposal's payment terms. Uses the
  // ProposalTemplate default schedule (50 / 40 / 10) unless the
  // contractor has overridden it elsewhere — that override path isn't
  // wired yet, so v1 always uses the canonical default. Each draw's
  // title comes from the schedule's label; amount = pct × contractTotal
  // (which already includes approved change orders).
  //
  // Guarded against duplicate generation: only enabled when zero draws
  // exist on the contract. Re-running after deletion is fine.
  async function handleGenerateFromTerms() {
    if (!contact?.id || !userId) return
    if (draws.length > 0) {
      toastError(
        'Draws already exist',
        'Delete or void the existing draws first if you want to start over from terms.'
      )
      return
    }
    if (contractTotal <= 0) {
      toastError(
        'No contract total yet',
        'Set the contract amount (or add quote items) before generating draws.'
      )
      return
    }
    const schedule = DEFAULT_PAYMENT_SCHEDULE
    setBusyId('__generate__')
    try {
      // Build N rows + insert sequentially so the BEFORE INSERT trigger
      // assigns sequence_numbers 1, 2, 3 deterministically. Batch insert
      // would race the sequence assignment.
      let createdCount = 0
      let issuedSoFar = 0
      for (let i = 0; i < schedule.length; i++) {
        const row = schedule[i]
        const pct = Number(row.pct || 0)
        // Each draw rounds independently EXCEPT the last, which takes
        // the remainder — otherwise per-draw Math.round drifts and the
        // schedule doesn't reconcile to the contract total (e.g. $3,000
        // ÷ 3 → $1,000 + $1,000 + $999 if every draw rounds on its own).
        const amount = i === schedule.length - 1
          ? Math.round(contractTotal - issuedSoFar)
          : Math.round(contractTotal * (pct / 100))
        issuedSoFar += amount
        const { error } = await supabase.from('fh_invoices').insert({
          contact_id: contact.id,
          user_id: userId,
          sequence_number: 0, // trigger assigns next
          title: `${pct}% — ${row.label}`,
          amount,
          status: 'draft',
          notes: row.sub || null
        })
        if (error) throw error
        createdCount++
      }
      toastSuccess(
        `Generated ${createdCount} draws`,
        `Pre-filled from ${schedule.map((s) => `${s.pct}%`).join(' / ')} payment terms`
      )
      await fetchDraws()
    } catch (e: any) {
      toastError("Couldn't generate draws", e?.message || 'Try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleMarkPaid(draw: any) {
    if (!draw?.id) return
    setBusyId(draw.id)
    try {
      const { error } = await supabase
        .from('fh_invoices')
        .update({ status: 'paid' })
        .eq('id', draw.id)
      if (error) throw error
      toastSuccess('Marked paid', `Draw #${draw.sequence_number}`)
      await fetchDraws()
    } catch (e: any) {
      toastError("Couldn't update", e?.message || 'Try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleVoid(draw: any) {
    if (!window.confirm(`Void Draw #${draw.sequence_number}? It will stop counting toward the unbilled total.`)) return
    setBusyId(draw.id)
    try {
      const { error } = await supabase
        .from('fh_invoices')
        .update({ status: 'void' })
        .eq('id', draw.id)
      if (error) throw error
      toastSuccess('Draw voided', `Draw #${draw.sequence_number}`)
      await fetchDraws()
    } catch (e: any) {
      toastError("Couldn't void", e?.message || 'Try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(draw: any) {
    if (!window.confirm(`Delete Draw #${draw.sequence_number}? This cannot be undone.`)) return
    try {
      const { error } = await supabase
        .from('fh_invoices')
        .delete()
        .eq('id', draw.id)
      if (error) throw error
      toastSuccess('Draw deleted', '')
      await fetchDraws()
    } catch (e: any) {
      toastError("Couldn't delete", e?.message || 'Try again.')
    }
  }

  const company = {
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

  // Shared per-draw PDF builder. Used by both Download (local save)
  // and Send (upload to job-files + POST to /api/send-invoice). The
  // job_title slot carries "Draw N of M — {label}" so the invoice
  // letterhead title reflects which draw the customer is receiving.
  async function buildDrawPdf(draw: any) {
    const allActiveDraws = draws.filter((d) => d.status !== 'void')
    const drawCount = allActiveDraws.length
    const drawTitle = draw.title?.trim()
      || `Draw ${draw.sequence_number} of ${drawCount}`

    return generateInvoice({
      company,
      contact: {
        id: contact.id,
        name: contact.name || 'Client',
        address: contact.address,
        phone: contact.phone,
        email: contact.email,
        job_title: `${drawTitle} — ${contact.job_title || 'Construction services'}`
      },
      lineItems: [
        {
          description: drawTitle,
          qty: 1,
          rate: draw.amount,
          amount: draw.amount
        }
      ],
      notes: draw.notes || '',
      dueDate: draw.due_at ? shortDate(draw.due_at) : '',
      invoiceId: draw.id,
      payments,
      contractTotal,
      previouslyPaid,
      insurance,
      changeOrders
    } as any)
  }

  // Build a single-draw PDF — reuses generateInvoice with this draw's
  // amount routed to thisInvoice + balanceRemaining computed from the
  // current paid total. Lets each draw print its own letterhead with
  // "Draw N of M" stamped in the title.
  async function handleDownload(draw: any) {
    if (busyId) return
    setBusyId(draw.id)
    try {
      const result = await buildDrawPdf(draw)
      if (!result?.doc) throw new Error('PDF generator returned no document')
      downloadPdf(result)
      toastSuccess('Draw PDF downloaded', result.filename)
    } catch (e: any) {
      toastError("Couldn't generate PDF", e?.message || 'Try again.')
    } finally {
      setBusyId(null)
    }
  }

  // Email a single draw via the existing /api/send-invoice Netlify
  // function. Mirrors the InvoiceDetail send flow exactly: build PDF →
  // upload to job-files (server uses service-role to pull it) → POST
  // to send-invoice → flip the draw's status to 'sent' on success.
  //
  // Requires the contact to have an email on file. The recipient
  // resolution lives at this surface (uses the linked client's email
  // as fallback when the contact row's email is empty, matching the
  // pattern in Invoices.jsx).
  async function handleSend(draw: any) {
    if (busyId) return
    if (!user?.id) return
    // Use contact.email directly. The fh_clients-join fallback the
    // Invoices list does isn't available in useJobData yet, so an
    // empty contact email surfaces a friendly toast pointing the
    // operator at the right place to fill it in.
    const recipientEmail = (contact?.email || '').trim()
    if (!recipientEmail) {
      toastError(
        'Add a client email first',
        `Open ${contact?.name || 'this contact'} to add an email, then try again.`
      )
      return
    }
    setBusyId(draw.id)
    try {
      const result = await buildDrawPdf(draw)
      if (!result?.doc) throw new Error('PDF generator returned no document')

      // Upload to private job-files bucket so the server can fetch
      // with service role + attach to the Resend send.
      const blob = result.doc.output('blob')
      const rowId = crypto.randomUUID()
      const path = `${user.id}/${contact.id}/${rowId}.pdf`
      const { error: upErr } = await supabase.storage
        .from('job-files')
        .upload(path, blob, { upsert: false, contentType: 'application/pdf' })
      if (upErr) throw new Error(`Couldn't save the draw PDF: ${upErr.message}`)

      // Audit row — best-effort, never blocks the send.
      try {
        await supabase.from('fh_job_files').insert({
          id: rowId,
          user_id: user.id,
          job_id: contact.id,
          filename: result.filename,
          storage_path: path,
          mime_type: 'application/pdf',
          size_bytes: blob.size || 0,
          kind: 'file'
        })
      } catch (e: any) {
        console.warn('[draw] fh_job_files row insert failed', e)
      }

      const sendRes = await fetch('/api/send-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contact.id,
          sender_user_id: user.id,
          recipient_email: recipientEmail,
          recipient_name: contact.name || null,
          storage_path: path,
          filename: result.filename,
          amount_due: draw.amount
        })
      })
      const sendBody = await sendRes.json().catch(() => ({}))

      if (sendRes.status === 503 && sendBody?.error === 'sender_not_configured') {
        // Same fallback InvoiceDetail uses — download so the operator
        // can email manually while they set up Resend env.
        toastError(
          "Email NOT sent — sender isn't configured",
          'Downloaded the PDF so you can email it manually.'
        )
        downloadPdf(result)
        return
      }
      if (!sendRes.ok || !sendBody?.ok) {
        const detail = sendBody?.detail || sendBody?.error || 'Unknown provider error'
        const status = sendBody?.provider_status ? ` (HTTP ${sendBody.provider_status})` : ''
        throw new Error(`Resend rejected${status}: ${detail}`)
      }

      // Flip the draw to 'sent' so the row badge updates immediately.
      // Skip if the draw is already paid (don't downgrade a paid draw
      // back to sent just because the contractor re-sent the PDF).
      if (draw.status !== 'paid') {
        await supabase
          .from('fh_invoices')
          .update({ status: 'sent', issued_at: draw.issued_at || new Date().toISOString() })
          .eq('id', draw.id)
      }
      toastSuccess(`Draw sent to ${recipientEmail}`, result.filename)
      await fetchDraws()
    } catch (e: any) {
      toastError("Couldn't send draw", e?.message || 'Try again.')
    } finally {
      setBusyId(null)
    }
  }

  if (!isOwner) {
    // Partner view — read-only list (read policy permits this).
    if (draws.length === 0) return null
    return (
      <Shell>
        <Header count={draws.length} canAdd={false} />
        <Summary contractTotal={contractTotal} drawsIssued={drawsIssued} previouslyPaid={previouslyPaid} unbilled={unbilled} />
        <List draws={draws} readOnly />
      </Shell>
    )
  }

  return (
    <Shell>
      <Header
        count={draws.length}
        canAdd={!creating && editingId == null}
        onAdd={() => setCreating(true)}
        canGenerate={!loading && draws.length === 0 && contractTotal > 0 && !creating && editingId == null}
        onGenerate={handleGenerateFromTerms}
        generating={busyId === '__generate__'}
      />
      <Summary
        contractTotal={contractTotal}
        drawsIssued={drawsIssued}
        previouslyPaid={previouslyPaid}
        unbilled={unbilled}
      />
      {creating && (
        <Editor
          isNew
          unbilled={unbilled}
          initial={{
            title: `Draw ${(draws.length || 0) + 1}`,
            amount: '',
            status: 'draft',
            issued_at: null,
            due_at: null,
            notes: ''
          }}
          onSave={async (payload: any) => { const ok = await handleSave(payload); if (ok) setCreating(false) }}
          onCancel={() => setCreating(false)}
        />
      )}
      {loading ? (
        <div style={{ padding: 18, textAlign: 'center', color: 'var(--v3-text-muted)', fontSize: 12 }}>
          Loading…
        </div>
      ) : (
        <List
          draws={draws}
          editingId={editingId}
          busyId={busyId}
          onEdit={(id: any) => setEditingId(id)}
          onCancelEdit={() => setEditingId(null)}
          onSave={async (payload: any) => { const ok = await handleSave(payload); if (ok) setEditingId(null) }}
          onMarkPaid={handleMarkPaid}
          onVoid={handleVoid}
          onDelete={handleDelete}
          onDownload={handleDownload}
          onSend={handleSend}
        />
      )}
    </Shell>
  )
}

/* ─── presentational components ─── */

function Shell({ children }: any) {
  return (
    <div
      className="fh-draws"
      style={{
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border)',
        borderRadius: 14,
        overflow: 'hidden'
      }}
    >
      {children}
    </div>
  )
}

function Header({ count, canAdd, onAdd, canGenerate, onGenerate, generating }: any) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '12px 16px',
      borderBottom: '1px solid var(--v3-border)',
      background: 'var(--v3-surface-2)',
      flexWrap: 'wrap'
    }}>
      <FileText size={14} aria-hidden="true" style={{ color: 'var(--v3-primary-bright)' }} />
      <span style={{
        fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
        letterSpacing: '0.16em', color: 'var(--v3-primary-bright)',
        textTransform: 'uppercase'
      }}>
        Invoice draws
        {count > 0 && (
          <span style={{ marginLeft: 8, color: 'var(--v3-text-muted)' }}>
            · {count}
          </span>
        )}
      </span>
      <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
        {canGenerate && (
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            title="Pre-fill three draws from the proposal's 50 / 40 / 10 payment terms"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '6px 10px', borderRadius: 8,
              background: 'color-mix(in srgb, var(--v3-primary) 14%, transparent)',
              border: '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)',
              color: 'var(--v3-primary-bright)',
              fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
              letterSpacing: '0.04em',
              cursor: generating ? 'wait' : 'pointer',
              opacity: generating ? 0.7 : 1
            }}
          >
            {generating ? 'Generating…' : 'Generate from terms'}
          </button>
        )}
        {canAdd && (
          <button
            type="button"
            onClick={onAdd}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '6px 10px', borderRadius: 8,
              background: 'transparent', border: '1px solid var(--v3-border-strong)',
              color: 'var(--v3-text)',
              fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <Plus size={12} aria-hidden="true" /> Add draw
          </button>
        )}
      </div>
    </div>
  )
}

function Summary({ contractTotal, drawsIssued, previouslyPaid, unbilled }: any) {
  // Four KPIs in a row at the top of the section so the contractor
  // sees what they're working with at a glance. Numbers wrap on
  // narrow widths via responsive flex; desktop CSS forces a single
  // row + larger type via the .fh-draws-summary class.
  const cells = [
    { label: 'Contract total', value: money(contractTotal) },
    { label: 'Drawn so far',   value: money(drawsIssued) },
    { label: 'Paid to date',   value: money(previouslyPaid), color: 'var(--v3-success-bright, #4ade80)' },
    { label: 'Unbilled',       value: money(unbilled),       color: 'var(--v3-primary-bright)' }
  ]
  return (
    <div className="fh-draws-summary" style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
      gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--v3-border)',
      background: 'rgba(0, 0, 0, 0.18)'
    }}>
      {cells.map((c) => (
        <div key={c.label} className="fh-draws-summary__cell">
          <div className="fh-draws-summary__label" style={{
            fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700,
            letterSpacing: '0.14em', color: 'var(--v3-text-muted)',
            textTransform: 'uppercase'
          }}>
            {c.label}
          </div>
          <div className="fh-draws-summary__value" style={{
            marginTop: 4,
            fontFamily: 'var(--font-body)', fontSize: 16, fontWeight: 700,
            color: c.color || 'var(--v3-text)',
            fontVariantNumeric: 'tabular-nums'
          }}>
            {c.value}
          </div>
        </div>
      ))}
    </div>
  )
}

function List({ draws, editingId, busyId, readOnly, onEdit, onCancelEdit, onSave, onMarkPaid, onVoid, onDelete, onDownload, onSend }: any) {
  if (draws.length === 0) {
    return (
      <div style={{
        padding: '28px 16px', textAlign: 'center',
        color: 'var(--v3-text-muted)', fontSize: 13, fontFamily: 'var(--font-body)'
      }}>
        <FileText size={20} aria-hidden="true" style={{ opacity: 0.55, marginBottom: 6 }} />
        <div>No draws yet. Add one to start progress billing this contract.</div>
      </div>
    )
  }
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {draws.map((d: any, i: any) => (
        <li key={d.id} style={{ borderTop: i > 0 ? '1px solid var(--v3-border)' : 'none' }}>
          {editingId === d.id ? (
            <Editor initial={d} onSave={onSave} onCancel={onCancelEdit} />
          ) : (
            <Row
              draw={d}
              busy={busyId === d.id}
              readOnly={readOnly}
              onEdit={() => onEdit?.(d.id)}
              onDownload={() => onDownload?.(d)}
              onSend={() => onSend?.(d)}
              onMarkPaid={() => onMarkPaid?.(d)}
              onVoid={() => onVoid?.(d)}
              onDelete={() => onDelete?.(d)}
            />
          )}
        </li>
      ))}
    </ul>
  )
}

function Row({ draw, busy, readOnly, onEdit, onDownload, onSend, onMarkPaid, onVoid, onDelete }: any) {
  const isPaid = draw.status === 'paid'
  const isVoid = draw.status === 'void'
  const isOverdue = draw.status === 'overdue'

  return (
    <div className="fh-draws-row" style={{ display: 'grid', gridTemplateColumns: '72px 1fr auto', gap: 14, padding: '14px 16px', alignItems: 'flex-start' }}>
      <div style={{
        fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
        letterSpacing: '0.04em', color: 'var(--v3-primary-bright)',
        fontVariantNumeric: 'tabular-nums', paddingTop: 2
      }}>
        Draw #{draw.sequence_number}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600,
          color: isVoid ? 'var(--v3-text-muted)' : 'var(--v3-text)',
          textDecoration: isVoid ? 'line-through' : 'none'
        }}>
          {draw.title || `Draw ${draw.sequence_number}`}
        </div>
        <div style={{ marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: 'var(--v3-text-muted)' }}>
          {draw.issued_at && <span>Issued {shortDate(draw.issued_at)}</span>}
          {draw.due_at && <span>Due {shortDate(draw.due_at)}</span>}
          {draw.notes && <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {draw.notes}</span>}
        </div>
        <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
          {isPaid && <Tag tone="green">PAID</Tag>}
          {isVoid && <Tag tone="muted">VOID</Tag>}
          {isOverdue && <Tag tone="red">OVERDUE</Tag>}
          {!isPaid && !isVoid && !isOverdue && draw.status === 'draft' && <Tag tone="muted">DRAFT</Tag>}
          {!isPaid && !isVoid && !isOverdue && draw.status === 'sent'  && <Tag tone="gold">SENT</Tag>}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        <div style={{
          fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700,
          color: isVoid ? 'var(--v3-text-muted)' : 'var(--v3-text)',
          fontVariantNumeric: 'tabular-nums',
          textDecoration: isVoid ? 'line-through' : 'none',
          whiteSpace: 'nowrap'
        }}>
          {money(draw.amount)}
        </div>
        {!readOnly && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {!isVoid && (
              <IconBtn onClick={onSend} disabled={busy} title="Email to client" aria-label="Email draw to client">
                <Send size={12} aria-hidden="true" />
              </IconBtn>
            )}
            {!isVoid && (
              <IconBtn onClick={onDownload} disabled={busy} title="Download PDF" aria-label="Download draw PDF">
                <Download size={12} aria-hidden="true" />
              </IconBtn>
            )}
            {!isPaid && !isVoid && (
              <IconBtn onClick={onMarkPaid} disabled={busy} title="Mark paid" aria-label="Mark draw paid">
                <Check size={12} aria-hidden="true" />
              </IconBtn>
            )}
            {!isVoid && (
              <IconBtn onClick={onEdit} disabled={busy} title="Edit" aria-label="Edit draw">
                <FileEdit size={12} aria-hidden="true" />
              </IconBtn>
            )}
            {!isVoid && (
              <IconBtn onClick={onVoid} disabled={busy} title="Void" aria-label="Void draw">
                <X size={12} aria-hidden="true" />
              </IconBtn>
            )}
            <IconBtn onClick={onDelete} tone="danger" title="Delete" aria-label="Delete draw">
              <Trash2 size={12} aria-hidden="true" />
            </IconBtn>
          </div>
        )}
      </div>
    </div>
  )
}

function Editor({ initial, isNew, unbilled, onSave, onCancel }: any) {
  const [form, setForm] = useState({
    id: initial.id || null,
    title: initial.title || '',
    amount: initial.amount != null ? String(initial.amount) : '',
    status: initial.status || 'draft',
    issued_at: initial.issued_at || null,
    due_at: initial.due_at || null,
    notes: initial.notes || ''
  })
  const [saving, setSaving] = useState(false)

  function set(k: any, v: any) { setForm((prev) => ({ ...prev, [k]: v })) }

  async function submit() {
    if (Number(form.amount) <= 0) {
      toastError('Amount required', 'Enter a positive amount for this draw.')
      return
    }
    setSaving(true)
    await onSave?.(form)
    setSaving(false)
  }

  return (
    <div className="fh-draws-editor" style={{ padding: 16, background: 'var(--v3-surface-2)', borderTop: isNew ? 'none' : '1px solid var(--v3-border)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>Title</span>
          <input
            type="text"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="50% deposit"
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>Amount</span>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: 9, color: 'var(--v3-text-muted)', fontSize: 13 }}>$</span>
            <input
              type="text"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => set('amount', e.target.value)}
              placeholder={unbilled > 0 ? String(unbilled) : '0'}
              style={{ ...inputStyle, paddingLeft: 20 }}
            />
          </div>
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>Issued</span>
          <input
            type="date"
            value={dateInputFromIso(form.issued_at)}
            onChange={(e) => set('issued_at', isoFromDateInput(e.target.value))}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>Due</span>
          <input
            type="date"
            value={dateInputFromIso(form.due_at)}
            onChange={(e) => set('due_at', isoFromDateInput(e.target.value))}
            style={inputStyle}
          />
        </label>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
        <span style={labelStyle}>Notes (optional)</span>
        <textarea
          rows={2}
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Remit-to / ACH instructions"
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </label>
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        {['draft','sent','paid','overdue'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => set('status', s)}
            style={{
              ...chipStyle,
              ...(form.status === s ? chipActiveStyle : null)
            }}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" onClick={onCancel} disabled={saving} style={ghostBtnStyle}>
          Cancel
        </button>
        <button type="button" onClick={submit} disabled={saving} style={primaryBtnStyle}>
          {saving ? 'Saving…' : isNew ? 'Add draw' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}

function Tag({ tone, children }: any) {
  const palette = ({
    muted: { bg: 'rgba(255,255,255,0.04)', fg: 'var(--v3-text-muted)', br: 'rgba(255,255,255,0.10)' },
    green: { bg: 'rgba(74, 222, 128, 0.12)', fg: 'var(--v3-success-bright, #4ade80)', br: 'rgba(74, 222, 128, 0.30)' },
    gold:  { bg: 'rgba(228, 190, 111, 0.12)', fg: 'var(--v3-primary-bright)', br: 'rgba(228, 190, 111, 0.30)' },
    red:   { bg: 'rgba(232, 90, 87, 0.10)', fg: 'var(--v3-danger-bright, #f5a294)', br: 'rgba(232, 90, 87, 0.30)' }
  } as Record<string, any>)[tone] || { bg: 'rgba(255,255,255,0.04)', fg: 'var(--v3-text-muted)', br: 'rgba(255,255,255,0.10)' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 7px', borderRadius: 999,
      background: palette.bg, border: `1px solid ${palette.br}`, color: palette.fg,
      fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700,
      letterSpacing: '0.16em', textTransform: 'uppercase'
    }}>
      {children}
    </span>
  )
}

function IconBtn({ children, onClick, disabled, tone, title, ...rest }: any) {
  const danger = tone === 'danger'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      {...rest}
      style={{
        width: 26, height: 26, borderRadius: 6,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent',
        border: `1px solid ${danger ? 'rgba(232, 90, 87, 0.35)' : 'var(--v3-border-strong)'}`,
        color: danger ? 'var(--v3-danger-bright, #f5a294)' : 'var(--v3-text)',
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.6 : 1
      }}
    >
      {children}
    </button>
  )
}

const labelStyle = {
  fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700,
  letterSpacing: '0.14em', color: 'var(--v3-text-muted)', textTransform: 'uppercase'
}
const inputStyle: import('react').CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '9px 12px', borderRadius: 8,
  background: 'var(--v3-surface)', border: '1px solid var(--v3-border-strong)',
  color: 'var(--v3-text)', fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none'
}
const chipStyle = {
  padding: '6px 12px', borderRadius: 999,
  background: 'transparent', border: '1px solid var(--v3-border-strong)',
  color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600,
  cursor: 'pointer'
}
const chipActiveStyle = {
  background: 'rgba(228, 190, 111, 0.15)',
  borderColor: 'var(--v3-primary)',
  color: 'var(--v3-primary-bright)'
}
const primaryBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)',
  background: 'linear-gradient(180deg, var(--v3-primary-bright) 0%, var(--v3-primary) 100%)',
  color: '#1a1208',
  fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
  letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer'
}
const ghostBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 12px', borderRadius: 8,
  background: 'transparent', border: '1px solid var(--v3-border-strong)',
  color: 'var(--v3-text)',
  fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer'
}
