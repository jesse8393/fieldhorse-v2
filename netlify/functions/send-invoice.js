// Netlify Function — Send invoice email to the client.
//
// Twin of send-quote.js. The browser uploads the generated invoice PDF
// to job-files, then POSTs the storage_path + recipient_email here.
// We verify ownership server-side, download the PDF using the service
// role, send it via Resend with the contractor's company name in the
// display name and Reply-To, then log activity to fh_notes.
//
// Why a sibling function instead of reusing send-quote:
//   - Email subject + body differ ("Invoice attached" vs "Proposal
//     attached"; mentions balance due / payment options instead of
//     review-and-approve).
//   - Activity log message differs ("Invoice sent to X").
//   - Status updates differ (no proposal_status flip on invoice send;
//     the stage is already 'invoice' or downstream of it).
//
// White-label sender policy (matches send-quote / send-message):
//   From:     `${Company Name} <notifications@fieldhorse.io>`
//   Reply-To: company_email || sender's auth email
// The customer sees ONLY the contractor's company name in the From
// display. The shared sender mailbox is the technical envelope and
// stays opaque — no "via FieldHorse" leaks anywhere in the inbox.
//
// Env vars (server-only — no VITE_ prefix):
//   RESEND_API_KEY              — required to actually send
//   SEND_EMAIL_FROM             — required, e.g. notifications@fieldhorse.io
//   SEND_EMAIL_FROM_NAME        — optional, default "Notifications" (used
//                                  ONLY when the contractor has no
//                                  company_name on file)
//   SUPABASE_URL                — required for service-role lookups
//   SUPABASE_SERVICE_ROLE_KEY   — required, bypasses RLS for owner check
//
// When RESEND_API_KEY or SEND_EMAIL_FROM are missing the function
// returns 503 with a friendly error so the client can surface
// "Email sender is not configured yet."

import { reviewInvoice } from '../../src/lib/invoiceReview.js'
import { createClient } from '@supabase/supabase-js'
import { renderPayBlock as payBlock, formatFromHeader, renderParagraphs, textField } from './lib/email.js'
import { loadAccessibleRow, brandingUserIdFor } from './lib/orgAccess.js'
import { hashIdentifier, checkRateLimit } from './lib/rateLimit.js'

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  const RESEND_API_KEY = process.env.RESEND_API_KEY
  const SEND_EMAIL_FROM = process.env.SEND_EMAIL_FROM
  const SEND_EMAIL_FROM_NAME = process.env.SEND_EMAIL_FROM_NAME || 'Notifications'

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({
      error: 'server_misconfigured',
      message: 'Server is missing Supabase credentials.'
    }, 500)
  }
  if (!RESEND_API_KEY || !SEND_EMAIL_FROM) {
    return json({
      error: 'sender_not_configured',
      message: 'Email sender is not configured yet.'
    }, 503)
  }

  // Caller must be signed in. sender_user_id is client input; without
  // verifying it against the caller's Supabase access token this
  // endpoint is an open relay. Token is validated against auth below.
  const authHeader = request.headers.get('authorization') || ''
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!accessToken) {
    return json({ error: 'missing_token', detail: 'Authorization: Bearer <access_token> is required.' }, 401)
  }

  let body
  try { body = await request.json() }
  catch { return json({ error: 'invalid_json' }, 400) }

  const {
    contact_id,
    invoice_id,
    sender_user_id,
    recipient_email,
    recipient_name,
    storage_path,
    filename,
    sender_message,
    amount_due,
    description
  } = body || {}

  // An invoice bills a job (contact_id) or, with no job, a client directly
  // (D62): then the invoice row names the client through its client_id.
  if ((!contact_id && !invoice_id) || !sender_user_id || !recipient_email || !storage_path) {
    return json({
      error: 'missing_fields',
      required: ['contact_id or invoice_id', 'sender_user_id', 'recipient_email', 'storage_path']
    }, 400)
  }

  const normalizedEmail = String(recipient_email).toLowerCase().trim()
  if (!isEmail(normalizedEmail)) {
    return json({ error: 'invalid_email' }, 400)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const { data: authData, error: authErr } = await supabase.auth.getUser(accessToken)
  if (authErr || !authData?.user) {
    return json({ error: 'invalid_token' }, 401)
  }
  if (authData.user.id !== sender_user_id) {
    return json({ error: 'forbidden', detail: 'sender_user_id must match the signed-in user.' }, 403)
  }

  // Per sender cap shared by every send-* function (see send-quote.js).
  const rlOk = await checkRateLimit(supabase, {
    scope: 'send-email', identifier: hashIdentifier(sender_user_id), limit: 30, windowSeconds: 600,
  })
  if (!rlOk) {
    return json({ error: 'rate_limited', message: 'Too many emails sent in a short time. Try again in a few minutes.' }, 429)
  }

  // 1. Verify the caller may act on the record: the job when the invoice
  // bills one, else the invoice itself, whose client stands in for the
  // job's name. Either way: its creator, or an owner, admin or manager of
  // its company.
  const contact = await loadBilledRecord(supabase, { contact_id, invoice_id, sender_user_id })
  if (contact === 'lookup_failed') {
    return json({ error: 'contact_lookup_failed', message: 'Could not load this record. Try again.' }, 500)
  }
  if (!contact) {
    return json({ error: 'forbidden_or_not_found', message: 'This record was not found, or your role cannot send it. Ask an owner, admin or manager.' }, 403)
  }

  if (!invoice_id) return json({ error: 'tracked_invoice_required', message: 'Open or create an invoice before sending a payment request.' }, 409)

  // Re-read the actual invoice and its obligations immediately before delivery.
  // The request cannot attach an invoice from a different job or company.
  if (invoice_id) {
    const access = await loadAccessibleRow(supabase, {
      table: 'fh_invoices', id: invoice_id, callerId: sender_user_id,
      select: 'contact_id, client_id, title, description, amount, status, due_at, updated_at'
    })
    if (access.error === 'lookup_failed') return json({ error: 'billing_review_unavailable', message: 'Could not verify current billing. Try again.' }, 503)
    const invoice = access.row
    if (!invoice || (invoice.contact_id || null) !== (contact_id || null)) return json({ error: 'invoice_mismatch', message: 'This invoice does not belong to the selected record.' }, 403)
    if (invoice.updated_at && body.invoice_updated_at !== invoice.updated_at) return json({ error: 'invoice_changed', message: 'This invoice changed after it was opened. Refresh and review before sending.' }, 409)
    if (!Number.isFinite(Number(invoice.amount)) || Number(invoice.amount) <= 0) return json({ error: 'invalid_invoice_amount', message: 'Enter a positive invoice amount before sending.' }, 409)
    if (invoice.status === 'void') return json({ error: 'invoice_void', message: 'A void invoice cannot be sent.' }, 409)
    if (invoice.status === 'draft') {
      const siblings = []
      for (let from = 0; ; from += 500) {
        let query = supabase.from('fh_invoices').select('id, contact_id, client_id, title, description, amount, status, due_at').neq('status', 'void')
        query = invoice.org_id ? query.eq('org_id', invoice.org_id) : query.eq('user_id', invoice.user_id)
        query = invoice.contact_id ? query.eq('contact_id', invoice.contact_id) : query.eq('client_id', invoice.client_id).is('contact_id', null)
        const result = await query.order('id').range(from, from + 499)
        if (result.error) return json({ error: 'billing_review_unavailable', message: 'Could not verify current invoices. Try again.' }, 503)
        siblings.push(...(result.data || []))
        if ((result.data?.length || 0) < 500) break
      }
      let contractTotal = null
      if (invoice.contact_id) {
        if (contact.amount != null && !Number.isFinite(Number(contact.amount))) return json({ error: 'invalid_contract_amount', message: 'Review the saved contract amount before sending.' }, 409)
        let approved = 0
        for (let from = 0; ; from += 500) {
          const changes = await supabase.from('fh_change_orders').select('amount').eq('contact_id', invoice.contact_id).eq('status', 'approved').order('id').range(from, from + 499)
          if (changes.error) return json({ error: 'billing_review_unavailable', message: 'Could not verify approved scope. Try again.' }, 503)
          if ((changes.data || []).some(row => !Number.isFinite(Number(row.amount)))) return json({ error: 'invalid_scope_amount', message: 'Review approved change amounts before sending.' }, 409)
          approved += (changes.data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0)
          if ((changes.data?.length || 0) < 500) break
        }
        if (Number(contact.amount) > 0 || approved > 0) contractTotal = Number(contact.amount || 0) + approved
      }
      const review = reviewInvoice({ invoice, invoices: siblings, contractTotal })
      if (review.excess > 0) return json({ error: 'contract_billing_exceeded', message: 'Invoices and drafts exceed approved contract value. Reduce or void unused drafts before sending.' }, 409)
      if (review.duplicates.length && body.duplicate_reviewed !== true) return json({ error: 'duplicate_review_required', message: 'Similar invoices found. Refresh the invoice and confirm this bills a separate installment.' }, 409)
    }
  }

  // 2. Pull the company's branding for From-line + Reply-To + pay link.
  const brandingUserId = (await brandingUserIdFor(supabase, contact)) || sender_user_id
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, company_name, company_email, payment_link, payment_instructions')
    .eq('user_id', brandingUserId)
    .maybeSingle()

  const companyName = (profile?.company_name || profile?.full_name || '').trim()
  const replyTo = (profile?.company_email || authData.user.email || '').trim()

  // 3. Download the uploaded invoice PDF.
  // Tenant guard: service role bypasses the per-user folder RLS, and every
  // job-files object is written under `${userId}/...` (see the upload paths
  // in src/screens/**). A path that doesn't start with the caller's own id
  // belongs to another tenant — reject it so a forged storage_path can't
  // exfiltrate another user's PDF.
  if (!String(storage_path).startsWith(`${sender_user_id}/`)) {
    return json({ error: 'forbidden_path', detail: 'storage_path is outside your namespace.' }, 403)
  }
  const { data: fileBlob, error: dlErr } = await supabase.storage
    .from('job-files')
    .download(storage_path)
  if (dlErr || !fileBlob) {
    console.error('[send-invoice] pdf download failed', dlErr)
    return json({
      error: 'pdf_download_failed',
      detail: 'Could not read the invoice PDF. Try sending again.'
    }, 500)
  }
  const arrayBuffer = await fileBlob.arrayBuffer()
  const base64Pdf = Buffer.from(arrayBuffer).toString('base64')

  // 4. Compose the email.
  // White-label From header — customer sees ONLY the contractor's
  // company name. The shared sender mailbox is the technical envelope
  // (its domain is what Resend authenticates against), but its display
  // name belongs to the contractor. No "via FieldHorse" leaks to the
  // recipient. Falls back to the env name only when company_name is
  // empty (incomplete profile).
  const fromName = companyName || SEND_EMAIL_FROM_NAME
  const fromHeader = formatFromHeader(fromName, SEND_EMAIL_FROM)
  // What the invoice is for: the invoice's own description when the client
  // sent one (the same words its PDF prints), else the job title as before.
  const jobTitle = textField(description).slice(0, 200) || contact.job_title || 'your project'
  const amountLabel = formatMoneyLabel(amount_due ?? contact.amount)
  const subject = `Invoice for ${jobTitle}${amountLabel ? ` (${amountLabel})` : ''}`
  // Optional fields read through textField so a non string value from a
  // malformed client falls back to the default instead of throwing.
  const safeRecipientName = textField(recipient_name) || textField(contact.name)
  const greeting = safeRecipientName ? `Hi ${safeRecipientName.split(/\s+/)[0]},` : 'Hi,'
  const senderLine = companyName || 'Your contractor'
  const customMessage = textField(sender_message)
  // Bring-your-own pay link — rendered as a button when present.
  const payLink = (profile?.payment_link || '').trim()
  const payInstructions = (profile?.payment_instructions || '').trim()

  const text = [
    greeting,
    '',
    customMessage || `Your invoice for ${jobTitle} is attached.${amountLabel ? ` Amount due: ${amountLabel}.` : ''}`,
    ...(payLink ? ['', `Pay online: ${payLink}`] : []),
    ...(payInstructions ? ['', payInstructions] : []),
    '',
    'Reply directly to this email with any questions about the invoice or to confirm payment.',
    '',
    senderLine
  ].join('\n')

  const html = renderInvoiceHtml({
    greeting,
    customMessage,
    jobTitle,
    amountLabel,
    senderLine,
    companyName,
    payLink,
    payInstructions
  })

  const safeFilename = (textField(filename) || `invoice-${contact.id}.pdf`).replace(/[^a-z0-9._-]/gi, '_')

  // 5. Send via Resend.
  const resendPayload = {
    from: fromHeader,
    to: [normalizedEmail],
    subject,
    text,
    html,
    attachments: [{ filename: safeFilename, content: base64Pdf }]
  }
  if (replyTo && isEmail(replyTo)) {
    resendPayload.reply_to = replyTo
  }

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(resendPayload)
  })
  const resendBody = await resendRes.json().catch(() => ({}))

  if (!resendRes.ok) {
    return json({
      error: 'send_failed',
      provider_status: resendRes.status,
      detail: resendBody?.message || resendBody?.error || 'Email provider rejected the send.'
    }, 502)
  }

  const emailId = resendBody?.id || null
  const sentAtIso = new Date().toISOString()

  // 6. Log activity on the job. Best-effort, never blocks the success
  // response. fh_contacts has no invoice_sent_at column today, so the
  // activity log is the source of truth for "did we email this invoice".
  // An invoice with no job has no job note to write; its row's status
  // moving to sent is its record.
  if (contact_id) {
    try {
      await supabase.from('fh_notes').insert({
        user_id: sender_user_id,
        contact_id,
        text: `Invoice sent to ${normalizedEmail}${amountLabel ? ` (${amountLabel})` : ''}`,
        category: 'activity'
      })
    } catch (e) {
      console.warn('[send-invoice] activity log insert failed', e)
    }
  }

  return json({
    ok: true,
    email_id: emailId,
    sent_at: sentAtIso
  })
}

// The record the invoice bills, shaped like a job row ({ id, user_id,
// org_id, name, job_title, amount }). With contact_id it is the job. With
// only invoice_id (an invoice that bills a client with no job, D62) it is
// the invoice row with the client's name on it and no job title, so the
// email reads "Invoice for <description>" and greets the client.
// Returns null when the caller may not act on it, 'lookup_failed' on a
// database error.
async function loadBilledRecord(supabase, { contact_id, invoice_id, sender_user_id }) {
  if (contact_id) {
    const access = await loadAccessibleRow(supabase, {
      table: 'fh_contacts', id: contact_id, callerId: sender_user_id,
      select: 'name, job_title, amount'
    })
    if (access.error === 'lookup_failed') return 'lookup_failed'
    return access.row || null
  }
  const access = await loadAccessibleRow(supabase, {
    table: 'fh_invoices', id: invoice_id, callerId: sender_user_id,
    select: 'client_id, amount, title'
  })
  if (access.error === 'lookup_failed') return 'lookup_failed'
  if (!access.row) return null
  let clientName = ''
  if (access.row.client_id) {
    const { data: client } = await supabase
      .from('fh_clients')
      .select('name')
      .eq('id', access.row.client_id)
      .maybeSingle()
    clientName = client?.name || ''
  }
  return {
    id: access.row.id,
    user_id: access.row.user_id,
    org_id: access.row.org_id,
    name: clientName,
    job_title: null,
    amount: access.row.amount
  }
}

function formatMoneyLabel(n) {
  const v = Number(n || 0)
  if (!Number.isFinite(v) || v <= 0) return ''
  // Show cents when the amount has them — rounding a $2,499.50 invoice
  // to "$2,500" in the email subject made customers overpay by 50¢ and
  // the invoice never reconciled.
  const hasCents = Math.abs(v - Math.round(v)) >= 0.005
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: hasCents ? 2 : 0 })}`
}

function renderInvoiceHtml({ greeting, customMessage, jobTitle, amountLabel, senderLine, companyName, payLink, payInstructions }) {
  const safe = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
  // The operator's note keeps its paragraphs and line breaks.
  const msg = customMessage
    ? renderParagraphs(customMessage, safe)
    : `<p style="margin:0;">Your invoice for <strong>${safe(jobTitle)}</strong> is attached.${amountLabel ? ` Amount due: <strong>${safe(amountLabel)}</strong>.` : ''}</p>`
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#F2EDE4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#141414;line-height:1.55;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F2EDE4;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#F2EDE4;border-radius:10px;border:1px solid #5C5C5C;overflow:hidden;">
        <tr><td style="padding:32px 32px 8px;">
          <p style="margin:0;font-size:12px;letter-spacing:0;text-transform:uppercase;color:#5C5C5C;">Invoice</p>
          <p style="margin:8px 0 0;font-size:16px;color:#141414;">${safe(greeting)}</p>
        </td></tr>
        <tr><td style="padding:8px 32px 16px;">
          <div style="font-size:16px;color:#141414;">${msg}</div>
        </td></tr>
        ${payBlock(payLink, payInstructions, amountLabel, safe)}
        <tr><td style="padding:8px 32px 24px;">
          <p style="margin:0;font-size:14px;color:#5C5C5C;">Reply directly to this email with any questions about the invoice or to confirm payment.</p>
        </td></tr>
        <tr><td style="padding:0 32px 32px;">
          <p style="margin:0;font-size:14px;color:#141414;">From ${safe(senderLine)}</p>
        </td></tr>
      </table>
      ${companyName ? `<p style="margin:16px 0 0;font-size:12px;color:#5C5C5C;letter-spacing:0;text-transform:uppercase;">Sent on behalf of ${safe(companyName)}</p>` : ''}
    </td></tr>
  </table>
</body>
</html>`
}


function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  }
}

// The app shows `detail` (then the error code) when a send fails, so a
// plain `message` is mirrored into `detail` for the person reading it.
function json(obj, status = 200) {
  const body = obj && obj.message && !obj.detail ? { ...obj, detail: obj.message } : obj
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  })
}

export const config = { path: '/api/send-invoice' }
