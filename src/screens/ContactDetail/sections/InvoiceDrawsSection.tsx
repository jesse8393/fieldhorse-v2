import { createUuid } from '../../../lib/uuid.ts'
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
//   previouslyPaid    = sum(fh_payments) (current snapshot, kept
//                         simple; per-invoice payment allocation is a
//                         future enhancement)
//   thisInvoice       = the draw's amount
//   balanceRemaining  = contractTotal − previouslyPaid (as of now)
//
// Cash jobs / small projects don't need to touch this, the existing
// single-invoice flow on the Invoice sub-tab stays exactly as it was.

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, FileEdit, Send, Download, Check, X, Trash2, FileText } from 'lucide-react'
import { supabase, authHeaders } from '../../../lib/supabase.ts'
import { parseDateOnly, toYmd } from '../../../lib/dates.ts'
import { useDocumentProfile } from '../../../lib/companyBranding.ts'
import { useAuth } from '../../../contexts/AuthContext.tsx'
// Loaded on the first PDF action, never with the screen: jsPDF stays out
// of the service worker precache and of the Financials tab's own chunk.
const loadPdf = () => import('../../../lib/pdf.js')
import { toastSuccess, toastError } from '../../../lib/toast.ts'
// Cents aware: whole amounts print as "$1,250", amounts with cents keep
// them, so a generated $1,249.75 draw never reads "$1,250".
import { money } from '../../../components/documents/format.ts'
import { useArmedId } from '../../../lib/secondTap.ts'
import { Eyebrow } from '../../../components/v3'
import { countNoun } from '../../../lib/format.ts'
import { fetchInvoiceReviewContext } from '../../../lib/invoiceReviewContext.ts'
import { reviewInvoice } from '../../../lib/invoiceReview.js'
import { billTo, fetchInvoicesForContact, invoiceAmountDue, invoiceDescription, retryOnce } from '../../../lib/invoices.ts'
import { invoicesPaidInFull } from '../../../lib/invoiceSettlement.ts'
import { drawsFromTerms } from '../../../lib/paymentSchedule.ts'
import { quoteMoney } from '../../../lib/quoteMoney.ts'
import { toCents } from '../../../lib/cents.ts'
import { useMembership } from '../../../contexts/MembershipContext.tsx'
import { canEditJobMoney } from '../lib/jobAccess.ts'
import { useMediaQuery } from '../../../lib/useMediaQuery.ts'
import { moneyInput } from '../../new/CreateShell.tsx'


function shortDate(iso: any) {
  const d = parseDateOnly(iso)
  if (!d) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Store the due date at LOCAL end-of-day so an invoice only reads
// "past due" AFTER the due date has fully passed, not for the entire
// due day (which a midnight timestamp compared with `< now` would do).
function isoFromDateInput(s: any) {
  if (!s) return null
  const parts = String(s).split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null
  const [y, m, d] = parts
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString()
}

// Read the stored timestamp back as a LOCAL calendar date for the
// <input type="date">, using UTC (toISOString) shifts the day in
// UTC+ timezones and walks the due date back on every re-edit.
function dateInputFromIso(iso: any) {
  return toYmd(iso)
}

export default function InvoiceDrawsSection({ contact, payments = [], changeOrders = [], insurance = null, userId }: any) {
  // Void and Delete take a second tap on the same draw's button (D57).
  const armedTap = useArmedId()
  const navigate = useNavigate()
  // The job's own company, whoever builds its draws (DATA-06).
  const documentProfile = useDocumentProfile(contact?.org_id)
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [draws, setDraws] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  // A failed read shows an empty list, which must not offer "Generate
  // from terms" on a job that may already have draws.
  const [loadFailed, setLoadFailed] = useState(false)
  const [editingId, setEditingId] = useState<any>(null)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<any>(null)
  // The draw a payment is being recorded against, and what is still owed
  // on it, while the payment sheet is open.
  // Any owner, admin or manager of the job's company may edit, not only
  // the teammate who created the job (see lib/jobAccess.ts).
  const { orgId: viewerOrgId, canCreateFinancialDocs } = useMembership()
  const isOwner = !!contact && canEditJobMoney({
    contactUserId: contact.user_id,
    contactOrgId: contact.org_id,
    userId,
    orgId: viewerOrgId,
    canCreateFinancialDocs,
  })

  // Resolved contract total = contact.amount + approved change order
  // adjustments. Mirrors the math in InvoiceTemplate so on-screen +
  // PDF balance summaries match.
  const approvedCOAdjustment = (changeOrders || [])
    .filter((co: any) => co?.status === 'approved')
    .reduce((s: any, co: any) => s + Number(co.amount || 0), 0)
  const contractTotal = Number(contact?.amount || 0) + approvedCOAdjustment
  const previouslyPaid = (payments || []).reduce((s: any, p: any) => s + Number(p.amount || 0), 0)
  const liveDraws = draws.filter((d) => d.status !== 'void')
  const drawsIssued = liveDraws.reduce((s, d) => s + Number(d.amount || 0), 0)
  const unbilled = Math.max(0, contractTotal - drawsIssued)

  const contactId = contact?.id
  const fetchDraws = useCallback(async () => {
    if (!contactId) return
    setLoading(true)
    const { data, error } = await fetchInvoicesForContact(contactId)
    if (error) toastError("Couldn't load draws", error.message)
    setDraws(data || [])
    setLoadFailed(!!error)
    setLoading(false)
  }, [contactId])

  useEffect(() => { fetchDraws() }, [fetchDraws])

  // Paid to date and the PDF's previously paid come from the job detail
  // query, so a payment recorded here refreshes it.
  const refreshJob = () => queryClient.invalidateQueries({ queryKey: ['jobDetail', contactId] })

  async function handleSave(payload: any) {
    if (!contact?.id || !userId) return false
    try {
      const amount = Number(payload.amount)
      if (!Number.isFinite(amount) || amount <= 0) {
        toastError('Amount required', 'Enter a positive amount for this draw.')
        return false
      }
      const row = {
        contact_id: contact.id,
        user_id: userId,
        title: payload.title?.trim() || `Draw ${(draws.length || 0) + 1}`,
        amount,
        status: payload.status || 'draft',
        issued_at: payload.issued_at || null,
        due_at: payload.due_at || null,
        notes: payload.notes?.trim() || null,
        description: payload.description?.trim() || null
      }
      const context = await fetchInvoiceReviewContext(contact.id, contact.client_id)
      const review = reviewInvoice({ invoice: { ...row, id: payload.id || 'new' }, ...context })
      const prior = context.invoices.find(invoice => invoice.id === payload.id)
      if (review.excess > 0 && (!prior || amount > Number(prior.amount))) {
        throw new Error('This draw exceeds approved contract value. Reduce or void unused drafts, or approve added scope first.')
      }
      // A paid draw keeps its amount and status (M-12), as the invoice's
      // own edit screen does: changing them would leave the payment that
      // paid it describing a different bill. An update never re-owns the
      // row either: it stays with whoever made it.
      const stored = draws.find((d: any) => d.id === payload.id)
      const paid = String(stored?.status || prior?.status || '').toLowerCase() === 'paid'
      if (payload.id && paid && (toCents(amount) !== toCents(stored?.amount ?? prior?.amount) || row.status !== 'paid')) {
        throw new Error('A paid draw keeps its amount and status. Delete or change its payment first.')
      }
      let res
      if (payload.id) {
        const { user_id: _owner, ...editable } = row
        const { amount: _amount, status: _status, ...paidEditable } = editable
        res = await supabase
          .from('fh_invoices')
          .update(paid ? paidEditable : editable)
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

  // Auto-create draws from the job's payment terms (M-16), read the way
  // the customer's link reads them: a named deposit, then the balance.
  // The default 50 / 40 / 10 schedule applies only when the terms are
  // blank, and terms this cannot read make nothing. Amounts come from
  // contractTotal, which already includes approved change orders.
  //
  // Guarded against duplicate generation: only enabled when no live
  // draws exist on the contract. Re-running after voiding or deleting
  // them is fine.
  async function handleGenerateFromTerms() {
    if (!contact?.id || !userId || loadFailed) return
    if (liveDraws.length > 0) {
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
    const termsText = contact?.terms_text ?? null
    const { deposit } = quoteMoney({ items: [], changeOrders: [], contactAmount: contractTotal, termsText, companyName: null })
    const schedule = drawsFromTerms({ total: contractTotal, termsText, deposit })
    if (!schedule) {
      toastError(
        'Payment terms not read',
        'The job\'s payment terms name no deposit this can read. Add the draws by hand.'
      )
      return
    }
    setBusyId('__generate__')
    try {
      // One request for every draw (DATA-19), so a dropped connection
      // leaves all of them or none. The BEFORE INSERT trigger numbers the
      // rows of one statement in order (each row sees the ones before it).
      //
      // drawsFromTerms splits in cents, so the draws add up to exactly the
      // contract, with the same deposit the customer's link asks for.
      const { error } = await supabase.from('fh_invoices').insert(schedule.map((row) => ({
        contact_id: contact.id,
        user_id: userId,
        sequence_number: 0, // trigger assigns next
        title: row.title,
        amount: row.amount,
        status: 'draft',
        notes: row.notes
      })))
      if (error) throw error
      toastSuccess(
        `Generated ${schedule.length} ${countNoun(schedule.length, 'draw')}`,
        `Filled from the payment terms: ${schedule.map((d) => money(d.amount)).join(', ')}`
      )
      await fetchDraws()
    } catch (e: any) {
      toastError("Couldn't generate draws", e?.message || 'Try again.')
      // The write may have reached the server with its answer lost. Read
      // the draws again before Generate is offered, so a retry cannot add
      // a second set.
      await fetchDraws()
    } finally {
      setBusyId(null)
    }
  }

  // Every balance (Paid to date, the job's balance, A/R, statements, the
  // customer's link) is summed from fh_payments, so marking a draw paid
  // has to record the payment, not just flip its status. The draw is an
  // invoice, so its payment screen (/invoices/:id/payment, D57) records the
  // payment linked to it and logPayment settles it.
  async function handleMarkPaid(draw: any) {
    if (!draw?.id || busyId) return
    // Money already on the books may cover this draw: a payment linked to
    // it, or job level money (say a deposit logged before the draws were
    // set up) that pays the oldest open draws first. Then only the status
    // is behind, and recording another payment would count it twice.
    const covered = invoicesPaidInFull({ invoices: draws, payments, contractTotal }).includes(draw.id)
    if (!covered) {
      // The payment screen prefills what the draw still owes.
      navigate(`/invoices/${draw.id}/payment`)
      return
    }
    setBusyId(draw.id)
    try {
      const { error } = await supabase
        .from('fh_invoices')
        .update({ status: 'paid' })
        .eq('id', draw.id)
      if (error) throw error
      toastSuccess('Marked paid', `Draw #${draw.sequence_number} is covered by payments already logged`)
      await fetchDraws()
    } catch (e: any) {
      toastError("Couldn't update", e?.message || 'Try again.')
    } finally {
      setBusyId(null)
    }
  }

  // The first tap arms the button; the second voids. A void draw stops
  // counting toward the unbilled total.
  function handleVoid(draw: any) {
    armedTap.tap(`void:${draw.id}`, () => { void voidNow(draw) })
  }

  async function voidNow(draw: any) {
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

  // Only a draft can be deleted. Its number never reached the customer,
  // while deleting a sent or paid draw hands its number to the next draw
  // and unlinks its payments. Void keeps that record on the books.
  function handleDelete(draw: any) {
    if (draw?.status !== 'draft') {
      toastError('Only drafts can be deleted', 'Void this draw instead so it stays on the books.')
      return
    }
    armedTap.tap(`delete:${draw.id}`, () => { void deleteNow(draw) })
  }

  async function deleteNow(draw: any) {
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

  const companyOf = (profile: any) => ({
    name: profile?.company_name || profile?.full_name || 'My Company',
    address: profile?.company_address || '',
    phone: profile?.company_phone || '',
    email: profile?.company_email || (profile as any)?.email || '',
    website: profile?.company_website || '',
    logo_url: profile?.logo_url || null,
    brand_accent_hex: profile?.brand_accent_hex || null,
    license_number: profile?.license_number || '',
    insured_text: profile?.insured_text || ''
  })

  // What Money asks for on this draw: the job's other draws let money
  // logged against the job count toward the oldest open one. The PDF hero
  // and the email's amount_due both read it, so they name one figure.
  function drawAmountDue(draw: any) {
    return invoiceAmountDue({ invoice: draw, contact, payments, changeOrders, invoices: draws })
  }

  // Who the draw bills, by the rule every invoice uses (billTo): the email
  // and phone of the linked client as it is now, read fresh, since the job
  // row keeps the copy from when the job was made (DATA-05). A client this
  // person cannot read leaves the job's copy.
  async function drawRecipient() {
    if (!contact?.client_id) return billTo(contact, null)
    const { data, error } = await supabase
      .from('fh_clients')
      .select('name, email, phone, address')
      .eq('id', contact.client_id)
      .maybeSingle()
    if (error) throw new Error("Couldn't read the client's email. Check your connection and try again.")
    return billTo({ ...contact, fh_clients: data ?? null }, null)
  }

  // Shared per-draw PDF builder. Used by both Download (local save)
  // and Send (upload to job-files + POST to /api/send-invoice). The
  // job_title slot carries "Draw N of M, {label}" so the invoice
  // letterhead title reflects which draw the customer is receiving.
  async function buildDrawPdf(draw: any, to: ReturnType<typeof billTo>) {
    const allActiveDraws = draws.filter((d) => d.status !== 'void')
    const drawCount = allActiveDraws.length
    const drawTitle = draw.title?.trim()
      || `Draw ${draw.sequence_number} of ${drawCount}`

    const { generateInvoice } = await loadPdf()
    return generateInvoice({
      company: companyOf(await documentProfile.load()),
      contact: {
        id: contact.id,
        name: to.name || 'Client',
        address: to.address,
        phone: to.phone,
        email: to.email,
        job_title: `${drawTitle}, ${contact.job_title || 'Construction services'}`
      },
      lineItems: [
        {
          description: drawTitle,
          notes: invoiceDescription(draw, contact),
          qty: 1,
          rate: draw.amount,
          amount: draw.amount
        }
      ],
      notes: draw.notes || '',
      dueDate: draw.due_at ? shortDate(draw.due_at) : '',
      dueDateIso: draw.due_at || null,
      invoiceId: draw.id,
      currentInvoice: draw,
      invoices: draws,
      payments,
      // RAW contract amount, generateInvoice folds approved COs in from
      // the changeOrders array itself, so passing the CO-inclusive
      // contractTotal here would double-count them in the balance box.
      // Null, not 0, when the job has no price: the PDF then leaves the
      // contract lines out instead of calling a $0 contract paid.
      contractTotal: Number(contact?.amount || 0) || null,
      previouslyPaid,
      amountDue: drawAmountDue(draw),
      insurance,
      changeOrders
    } as any)
  }

  // Build a single-draw PDF, reuses generateInvoice with this draw's
  // amount routed to thisInvoice + balanceRemaining computed from the
  // current paid total. Lets each draw print its own letterhead with
  // "Draw N of M" stamped in the title.
  async function handleDownload(draw: any) {
    if (busyId) return
    if (draw.status === 'draft') {
      const review = reviewInvoice({ invoice: draw, invoices: draws, contractTotal })
      if (review.excess > 0 || review.duplicates.length) {
        navigate(`/invoices/${draw.id}`)
        toastError('Review this draft before sending', 'Check similar invoices and approved contract value.')
        return
      }
    }
    setBusyId(draw.id)
    try {
      const result = await buildDrawPdf(draw, await drawRecipient())
      if (!result?.doc) throw new Error('PDF generator returned no document')
      const { downloadPdf } = await loadPdf()
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
  // Requires an email on file: the linked client's, read fresh, else the
  // job row's own (drawRecipient). With neither, a friendly toast points
  // the operator at the right place to fill it in.
  async function handleSend(draw: any) {
    if (busyId) return
    if (!user?.id) return
    if (draw.status === 'draft') {
      const review = reviewInvoice({ invoice: draw, invoices: draws, contractTotal })
      if (review.excess > 0 || review.duplicates.length) {
        navigate(`/invoices/${draw.id}`)
        toastError('Review this draft before sending', 'Check similar invoices and approved contract value.')
        return
      }
    }
    setBusyId(draw.id)
    try {
      const to = await drawRecipient()
      const recipientEmail = to.email
      if (!recipientEmail) {
        toastError(
          'Add a client email first',
          `Open ${to.name || 'this contact'} to add an email, then try again.`
        )
        return
      }
      const result = await buildDrawPdf(draw, to)
      if (!result?.doc) throw new Error('PDF generator returned no document')

      // Upload to private job-files bucket so the server can fetch
      // with service role + attach to the Resend send.
      const blob = result.doc.output('blob')
      const rowId = createUuid()
      const path = `${user.id}/${contact.id}/${rowId}.pdf`
      const { error: upErr } = await supabase.storage
        .from('job-files')
        .upload(path, blob, { upsert: false, contentType: 'application/pdf' })
      if (upErr) throw new Error(`Couldn't save the draw PDF: ${upErr.message}`)

      // Audit row, best-effort, never blocks the send.
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
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          contact_id: contact.id,
          invoice_id: draw.id,
          invoice_updated_at: draw.updated_at,
          sender_user_id: user.id,
          recipient_email: recipientEmail,
          recipient_name: contact.name || null,
          storage_path: path,
          filename: result.filename,
          // The same figure the PDF hero printed (drawAmountDue).
          amount_due: drawAmountDue(draw)
        })
      })
      const sendBody = await sendRes.json().catch(() => ({}))

      if (sendRes.status === 503 && sendBody?.error === 'sender_not_configured') {
        // Same fallback InvoiceDetail uses, download so the operator
        // can email manually while they set up Resend env.
        toastError(
          "Email not sent, sender isn't configured",
          'Downloaded the PDF so you can email it manually.'
        )
        const { downloadPdf } = await loadPdf()
        downloadPdf(result)
        return
      }
      if (!sendRes.ok || !sendBody?.ok) {
        const detail = sendBody?.message || sendBody?.detail || sendBody?.error || 'Unknown provider error'
        const status = sendBody?.provider_status ? ` (HTTP ${sendBody.provider_status})` : ''
        throw new Error(`Resend rejected${status}: ${detail}`)
      }

      // Flip the draw to 'sent' so the row badge updates immediately.
      // Skip if the draw is already paid (don't downgrade a paid draw
      // back to sent just because the contractor sent again the PDF).
      // Checked and tried once more (DATA-17): the email has gone, so a
      // draw left as a draft must be reported, not passed over.
      if (draw.status !== 'paid') {
        const issuedAt = draw.issued_at || new Date().toISOString()
        const { error: flipErr } = await retryOnce(() => supabase
          .from('fh_invoices')
          .update({ status: 'sent', issued_at: issuedAt })
          .eq('id', draw.id))
        if (flipErr) toastError('Draw not marked sent', 'The email went, but the draw status did not update. Refresh and check it.')
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
    // Partner view, read-only list (read policy permits this).
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
        canGenerate={!loading && !loadFailed && liveDraws.length === 0 && contractTotal > 0 && !creating && editingId == null}
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
            notes: '',
            // Prefilled with the job title (D62) so the stored column is
            // filled; Jesse can change it before saving.
            description: contact?.job_title || ''
          }}
          onSave={async (payload: any) => { const ok = await handleSave(payload); if (ok) setCreating(false) }}
          onCancel={() => setCreating(false)}
        />
      )}
      {loading ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--v3-text-muted)', fontSize: 12 }}>
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
          armedKey={armedTap.armedId}
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
        borderRadius: 10,
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
      <FileText size={14} aria-hidden="true" style={{ color: 'var(--v3-primary-text)' }} />
      <Eyebrow tone="gold">
        Invoice draws
        {count > 0 && (
          <span style={{ marginLeft: 8, color: 'var(--v3-text-muted)' }}>
            · {count}
          </span>
        )}
      </Eyebrow>
      <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
        {canGenerate && (
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            title="Fill the draws from the job's payment terms"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '8px 12px', borderRadius: 10,
              background: 'color-mix(in srgb, var(--v3-primary) 14%, transparent)',
              border: '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)',
              color: 'var(--v3-primary-text)',
              fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
              letterSpacing: 0,
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
              padding: '8px 12px', borderRadius: 10,
              background: 'transparent', border: '1px solid var(--v3-border-strong)',
              color: 'var(--v3-text)',
              fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
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
    { label: 'Paid to date',   value: money(previouslyPaid), color: 'var(--v3-success-text)' },
    { label: 'Unbilled',       value: money(unbilled),       color: 'var(--v3-primary-text)' }
  ]
  return (
    <div className="fh-draws-summary" style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
      gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--v3-border)',
      background: 'rgba(20, 20, 20, 0.18)'
    }}>
      {cells.map((c) => (
        <div key={c.label} className="fh-draws-summary__cell">
          <div className="fh-draws-summary__label" style={{
            fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
            letterSpacing: 0, color: 'var(--v3-text-muted)',
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

function List({ draws, editingId, busyId, readOnly, armedKey, onEdit, onCancelEdit, onSave, onMarkPaid, onVoid, onDelete, onDownload, onSend }: any) {
  if (draws.length === 0) {
    return (
      <div style={{
        padding: '24px 16px', textAlign: 'center',
        color: 'var(--v3-text-muted)', fontSize: 14, fontFamily: 'var(--font-body)'
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
              voidArmed={armedKey === `void:${d.id}`}
              deleteArmed={armedKey === `delete:${d.id}`}
            />
          )}
        </li>
      ))}
    </ul>
  )
}

function Row({ draw, busy, readOnly, onEdit, onDownload, onSend, onMarkPaid, onVoid, onDelete, voidArmed = false, deleteArmed = false }: any) {
  const isPaid = draw.status === 'paid'
  const isVoid = draw.status === 'void'
  const isOverdue = draw.status === 'overdue'
  // Below 600 px the buttons take a row of their own (OPS-14): beside the
  // title they covered it and squeezed the dates to a word per line.
  const narrow = useMediaQuery('(max-width: 599px)')

  const actions = !readOnly && (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: narrow ? 'flex-start' : 'flex-end', ...(narrow ? { gridColumn: '1 / -1' } : null) }}>
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
        <IconBtn onClick={onVoid} disabled={busy} title={voidArmed ? 'Tap again to void. It stops counting toward the unbilled total.' : 'Void'} aria-label={voidArmed ? 'Tap again to void' : 'Void draw'} wide={voidArmed}>
          {voidArmed ? <span style={{ fontSize: 12, fontWeight: 700, padding: '0 8px', whiteSpace: 'nowrap' }}>Tap again to void</span> : <X size={12} aria-hidden="true" />}
        </IconBtn>
      )}
      {/* Drafts only: a sent or paid draw is voided, never deleted. */}
      {draw.status === 'draft' && (
        <IconBtn onClick={onDelete} tone="danger" title={deleteArmed ? 'Tap again to delete. This cannot be undone.' : 'Delete'} aria-label={deleteArmed ? 'Tap again to delete' : 'Delete draw'} wide={deleteArmed}>
          {deleteArmed ? <span style={{ fontSize: 12, fontWeight: 700, padding: '0 8px', whiteSpace: 'nowrap' }}>Tap again to delete</span> : <Trash2 size={12} aria-hidden="true" />}
        </IconBtn>
      )}
    </div>
  )

  return (
    <div className="fh-draws-row" style={{ display: 'grid', gridTemplateColumns: narrow ? '64px minmax(0, 1fr) auto' : '72px 1fr auto', gap: narrow ? 8 : 12, padding: '12px 16px', alignItems: 'flex-start' }}>
      <div style={{
        fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
        letterSpacing: 0, color: 'var(--v3-primary-text)',
        fontVariantNumeric: 'tabular-nums', paddingTop: 4
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
        <div style={{ marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: 'var(--v3-text-muted)' }}>
          {draw.issued_at && <span style={{ whiteSpace: 'nowrap' }}>Issued {shortDate(draw.issued_at)}</span>}
          {draw.due_at && <span style={{ whiteSpace: 'nowrap' }}>Due {shortDate(draw.due_at)}</span>}
          {draw.notes && <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {draw.notes}</span>}
        </div>
        <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {isPaid && <Tag tone="green">Paid</Tag>}
          {isVoid && <Tag tone="muted">Void</Tag>}
          {isOverdue && <Tag tone="red">Overdue</Tag>}
          {!isPaid && !isVoid && !isOverdue && draw.status === 'draft' && <Tag tone="muted">Draft</Tag>}
          {!isPaid && !isVoid && !isOverdue && draw.status === 'sent'  && <Tag tone="gold">Sent</Tag>}
          {/* Each draw is an invoice of its own with a screen at /invoices/:id (D62). */}
          <Link
            to={`/invoices/${draw.id}`}
            aria-label={`Open invoice ${draw.title || draw.sequence_number}`}
            style={{
              display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 12px',
              borderRadius: 10, border: '1px solid var(--v3-border)',
              fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
              color: 'var(--v3-text)', textDecoration: 'none'
            }}
          >
            Open
          </Link>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
        <div style={{
          fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700,
          color: isVoid ? 'var(--v3-text-muted)' : 'var(--v3-text)',
          fontVariantNumeric: 'tabular-nums',
          textDecoration: isVoid ? 'line-through' : 'none',
          whiteSpace: 'nowrap'
        }}>
          {money(draw.amount)}
        </div>
        {!narrow && actions}
      </div>
      {narrow && actions}
    </div>
  )
}

function Editor({ initial, isNew, unbilled, onSave, onCancel }: any) {
  // A paid draw keeps its amount and status (M-12).
  const locked = !isNew && String(initial?.status || '').toLowerCase() === 'paid'
  const [form, setForm] = useState({
    id: initial.id || null,
    title: initial.title || '',
    amount: initial.amount != null ? String(initial.amount) : '',
    status: initial.status || 'draft',
    issued_at: initial.issued_at || null,
    due_at: initial.due_at || null,
    notes: initial.notes || '',
    description: initial.description || ''
  })
  const [saving, setSaving] = useState(false)

  function set(k: any, v: any) { setForm((prev) => ({ ...prev, [k]: v })) }

  async function submit() {
    // NaN fails BOTH `<= 0` and `> 0`, check the valid case, not the
    // invalid one, so garbage input can't slip through as $0.
    const amt = Number(form.amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      toastError('Amount required', 'Enter a positive amount for this draw.')
      return
    }
    setSaving(true)
    await onSave?.(form)
    setSaving(false)
  }

  return (
    <div className="fh-draws-editor" style={{ padding: 16, background: 'var(--v3-surface-2)', borderTop: isNew ? 'none' : '1px solid var(--v3-border)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 12 }}>
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
            <span style={{ position: 'absolute', left: 10, top: 9, color: 'var(--v3-text-muted)', fontSize: 14 }}>$</span>
            <input
              type="text"
              inputMode="decimal"
              value={form.amount}
              // Strip everything but digits/decimal, same rule as
              // the payment and invoice screens. Without it, typing
              // "1,500" (or pasting "$1,500") passed validation as NaN
              // and persisted a $0 draw.
              onChange={(e) => { if (!locked) set('amount', moneyInput(e.target.value)) }}
              readOnly={locked}
              aria-readonly={locked || undefined}
              placeholder={unbilled > 0 ? String(unbilled) : '0'}
              style={{ ...inputStyle, paddingLeft: 24 }}
            />
          </div>
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
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
        <span style={labelStyle}>Description, shows on the invoice</span>
        <input
          type="text"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Deposit for the shed slab"
          style={inputStyle}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
        <span style={labelStyle}>Notes (optional)</span>
        <textarea
          rows={2}
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Remittance / ACH instructions"
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {/* Paid is only shown for a draw that already is. A draw becomes
            paid by recording its payment (the check button), so the
            balance moves with the status. */}
        {locked && (
          <span style={{ ...labelStyle, textTransform: 'none' }}>
            Paid. The amount and status stay as they are while its payment stands.
          </span>
        )}
        {(locked ? [] : ['draft', 'sent', 'overdue']).map((s) => (
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
    muted: { bg: 'var(--v3-glass-tint)', fg: 'var(--v3-text-muted)', br: 'var(--v3-border-mid)' },
    green: { bg: 'rgba(45, 122, 79, 0.12)', fg: 'var(--v3-success-text)', br: 'rgba(45, 122, 79, 0.30)' },
    gold:  { bg: 'rgba(201, 150, 58, 0.12)', fg: 'var(--v3-primary-text)', br: 'rgba(201, 150, 58, 0.30)' },
    red:   { bg: 'rgba(192, 57, 43, 0.10)', fg: 'var(--v3-danger-text)', br: 'rgba(192, 57, 43, 0.30)' }
  } as Record<string, any>)[tone] || { bg: 'var(--v3-glass-tint)', fg: 'var(--v3-text-muted)', br: 'var(--v3-border-mid)' }
  return (
    <Eyebrow style={{ padding: '4px 8px', borderRadius: 10, background: palette.bg, border: `1px solid ${palette.br}`, color: palette.fg }}>
      {children}
    </Eyebrow>
  )
}

// `wide` lets an armed button carry its words (Tap again to delete).
function IconBtn({ children, onClick, disabled, tone, title, wide = false, ...rest }: any) {
  const danger = tone === 'danger'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      {...rest}
      style={{
        width: wide ? 'auto' : 26, height: 26, borderRadius: 10,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent',
        border: `1px solid ${danger ? 'rgba(192, 57, 43, 0.35)' : 'var(--v3-border-strong)'}`,
        color: danger ? 'var(--v3-danger-text)' : 'var(--v3-text)',
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.6 : 1
      }}
    >
      {children}
    </button>
  )
}

const labelStyle = {
  fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
  letterSpacing: 0, color: 'var(--v3-text-muted)'
}
const inputStyle: import('react').CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '8px 12px', borderRadius: 10,
  background: 'var(--v3-surface)', border: '1px solid var(--v3-border-strong)',
  color: 'var(--v3-text)', fontFamily: 'var(--font-body)', fontSize: 14, outline: 'none'
}
const chipStyle = {
  padding: '8px 12px', borderRadius: 10,
  background: 'transparent', border: '1px solid var(--v3-border-strong)',
  color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
  cursor: 'pointer'
}
const chipActiveStyle = {
  background: 'rgba(201, 150, 58, 0.15)',
  borderColor: 'var(--v3-primary)',
  color: 'var(--v3-primary-text)'
}
const primaryBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '8px 12px', borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)',
  background: 'var(--v3-primary)',
    minHeight: 44,
  color: 'var(--v3-on-primary)',
  fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
  letterSpacing: 0, cursor: 'pointer'
}
const ghostBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '8px 12px', borderRadius: 10,
  background: 'transparent', border: '1px solid var(--v3-border-strong)',
  color: 'var(--v3-text)',
  fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer'
}
