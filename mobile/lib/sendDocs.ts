// mobile/lib/sendDocs.ts
//
// Platform send for customer facing documents (proposal now, invoice
// reuses the same plumbing). Mirrors the web Quote.tsx handleSend /
// InvoiceDetail send flows:
//   1. render the HTML to a PDF on device (expo-print)
//   2. upload the PDF to the private job-files bucket
//   3. POST the storage_path to the Netlify function, which downloads
//      the PDF with the service role, emails it via Resend, logs
//      activity, and flips the document status (sent).
//
// The same backend the website uses, we just call it from RN.

import * as Print from 'expo-print'
import { supabase } from './supabase'
import { confirmMutation } from './mutationResult'
import { API_BASE } from './apiBase'

// The send-* Netlify functions require the signed-in user's access
// token; sender_user_id alone is no longer trusted on the server.
async function authHeaders(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

async function uploadPdf(html: string, userId: string, contactId: string, filename: string): Promise<string> {
  const { uri } = await Print.printToFileAsync({ html, base64: false })
  const arrayBuffer = await fetch(uri).then((r) => r.arrayBuffer())
  const pathId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const path = `${userId}/${contactId}/${pathId}.pdf`
  const { error: upErr } = await supabase.storage
    .from('job-files')
    .upload(path, arrayBuffer, { contentType: 'application/pdf', upsert: false })
  if (upErr) throw new Error(`Couldn't save the PDF: ${upErr.message}`)
  // Stop before sending when the saved document cannot be indexed.
  const { error: indexError } = await confirmMutation(supabase.from('fh_job_files').insert({
    user_id: userId,
    job_id: contactId,
    filename,
    storage_path: path,
    mime_type: 'application/pdf',
    size_bytes: (arrayBuffer as ArrayBuffer).byteLength,
    kind: 'file'
  } as any).select('id'))
  if (indexError) throw new Error(`PDF indexing failed. ${indexError.message}`)
  return path
}

export type SendResult = { ok: boolean; notConfigured?: boolean; message?: string }

export async function sendProposalEmail(input: {
  html: string
  filename: string
  userId: string
  contact: { id: string; name?: string | null; email?: string | null }
  followUpOn?: string | null
}): Promise<SendResult> {
  const email = (input.contact.email || '').trim()
  if (!email) return { ok: false, message: 'Add a client email first so we know where to send.' }
  const storagePath = await uploadPdf(input.html, input.userId, input.contact.id, input.filename)
  const res = await fetch(`${API_BASE}/api/send-quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({
      contact_id: input.contact.id,
      sender_user_id: input.userId,
      recipient_email: email,
      recipient_name: input.contact.name || null,
      storage_path: storagePath,
      filename: input.filename,
      follow_up_on: input.followUpOn ?? null
    })
  })
  const body = await res.json().catch(() => ({} as any))
  if (res.status === 503 && body?.error === 'sender_not_configured') {
    return { ok: false, notConfigured: true, message: 'Email sending is not configured on the server yet. The PDF was saved to Files.' }
  }
  if (!res.ok || !body?.ok) {
    return { ok: false, message: body?.detail || body?.error || 'Email send failed.' }
  }
  return { ok: true }
}

export async function sendMessageEmail(input: {
  userId: string
  contactId: string
  recipientEmail: string
  recipientName?: string | null
  subject?: string | null
  body: string
}): Promise<SendResult> {
  const email = (input.recipientEmail || '').trim()
  if (!email) return { ok: false, message: 'No recipient email.' }
  const res = await fetch(`${API_BASE}/api/send-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({
      contact_id: input.contactId,
      sender_user_id: input.userId,
      recipient_email: email,
      recipient_name: input.recipientName || null,
      subject: input.subject || null,
      body: input.body
    })
  })
  const body = await res.json().catch(() => ({} as any))
  if (res.status === 503 && body?.error === 'sender_not_configured') {
    return { ok: false, notConfigured: true, message: 'Email sending is not configured on the server yet.' }
  }
  if (!res.ok || !body?.ok) return { ok: false, message: body?.detail || body?.error || 'Send failed.' }
  return { ok: true }
}

// The invoice row being sent. The server refuses a send without one
// (tracked_invoice_required) and refuses one that changed after it was
// opened (invoice_changed), so both travel with the request.
export type InvoiceToSend = {
  id: string
  contact_id: string | null
  status: string | null
  amount: number | null
  title?: string | null
  description?: string | null
  updated_at: string
}

// The invoice a job's Send acts on: the one that was opened, else the only
// open one. Null with a reason when there is nothing or too much to choose.
export function pickInvoiceToSend<T extends { id: string; status: string | null }>(
  invoices: T[], requestedId: string | null | undefined
): { invoice: T | null; message?: string } {
  if (requestedId) {
    const hit = invoices.find((i) => i.id === requestedId)
    return hit ? { invoice: hit } : { invoice: null, message: 'This invoice is no longer on the job. Go back and open it again.' }
  }
  const open = invoices.filter((i) => i.status !== 'void' && i.status !== 'paid')
  if (open.length === 1) return { invoice: open[0] }
  if (open.length === 0) return { invoice: null, message: 'Create an invoice for this job before sending one.' }
  return { invoice: null, message: 'This job has more than one open invoice. Open the one to send from Invoices.' }
}

// Checks what the server will check before a PDF is saved, so a send that
// would be refused does not leave a stray PDF in the job's Files.
async function invoiceSendProblem(invoice: InvoiceToSend, contactId: string): Promise<string | null> {
  const { data, error } = await supabase.from('fh_invoices')
    .select('id, contact_id, status, amount, updated_at').eq('id', invoice.id).maybeSingle()
  if (error) return `Could not check the invoice: ${error.message}`
  const row = data as any
  if (!row) return 'This invoice was not found. Go back and open it again.'
  if ((row.contact_id || null) !== contactId) return 'This invoice does not belong to this job.'
  if (row.status === 'void') return 'A void invoice cannot be sent.'
  if (!(Number(row.amount) > 0)) return 'Enter a positive invoice amount before sending.'
  if (row.updated_at !== invoice.updated_at) return 'This invoice changed after it was opened. Go back, review it and send again.'
  return null
}

export async function sendInvoiceEmail(input: {
  html: string
  filename: string
  userId: string
  contact: { id: string; name?: string | null; email?: string | null }
  invoice: InvoiceToSend
}): Promise<SendResult> {
  const email = (input.contact.email || '').trim()
  if (!email) return { ok: false, message: 'Add a client email first so we know where to send.' }
  const problem = await invoiceSendProblem(input.invoice, input.contact.id)
  if (problem) return { ok: false, message: problem }
  const storagePath = await uploadPdf(input.html, input.userId, input.contact.id, input.filename)
  const res = await fetch(`${API_BASE}/api/send-invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({
      contact_id: input.contact.id,
      invoice_id: input.invoice.id,
      invoice_updated_at: input.invoice.updated_at,
      amount_due: Number(input.invoice.amount),
      description: input.invoice.description || input.invoice.title || null,
      sender_user_id: input.userId,
      recipient_email: email,
      recipient_name: input.contact.name || null,
      storage_path: storagePath,
      filename: input.filename
    })
  })
  const body = await res.json().catch(() => ({} as any))
  if (res.status === 503 && body?.error === 'sender_not_configured') {
    return { ok: false, notConfigured: true, message: 'Email sending is not configured on the server yet. The PDF was saved to Files.' }
  }
  if (!res.ok || !body?.ok) {
    return { ok: false, message: body?.message || body?.detail || body?.error || 'Email send failed.' }
  }
  return { ok: true }
}
