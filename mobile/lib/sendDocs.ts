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

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL || 'https://fieldhorse.io').replace(/\/+$/, '')

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
  // Index it in the Files list (best-effort, send still works if this misses).
  await supabase.from('fh_job_files').insert({
    user_id: userId,
    job_id: contactId,
    filename,
    storage_path: path,
    mime_type: 'application/pdf',
    size_bytes: (arrayBuffer as ArrayBuffer).byteLength,
    kind: 'file'
  } as any)
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

export async function sendInvoiceEmail(input: {
  html: string
  filename: string
  userId: string
  contact: { id: string; name?: string | null; email?: string | null }
  invoiceId?: string | null
}): Promise<SendResult> {
  const email = (input.contact.email || '').trim()
  if (!email) return { ok: false, message: 'Add a client email first so we know where to send.' }
  const storagePath = await uploadPdf(input.html, input.userId, input.contact.id, input.filename)
  const res = await fetch(`${API_BASE}/api/send-invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({
      contact_id: input.contact.id,
      invoice_id: input.invoiceId || null,
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
    return { ok: false, message: body?.detail || body?.error || 'Email send failed.' }
  }
  return { ok: true }
}
