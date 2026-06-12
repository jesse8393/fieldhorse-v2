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
//   APP_BASE_URL                — optional, default https://fieldhorse.io
//   SUPABASE_URL                — required for service-role lookups
//   SUPABASE_SERVICE_ROLE_KEY   — required, bypasses RLS for owner check
//
// When RESEND_API_KEY or SEND_EMAIL_FROM are missing the function
// returns 503 with a friendly error so the client can surface
// "Email sender is not configured yet."

import { createClient } from '@supabase/supabase-js'

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
    sender_user_id,
    recipient_email,
    recipient_name,
    storage_path,
    filename,
    sender_message,
    amount_due
  } = body || {}

  if (!contact_id || !sender_user_id || !recipient_email || !storage_path) {
    return json({
      error: 'missing_fields',
      required: ['contact_id', 'sender_user_id', 'recipient_email', 'storage_path']
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

  // 1. Verify the caller owns the contact (job).
  const { data: contact, error: contactErr } = await supabase
    .from('fh_contacts')
    .select('id, name, job_title, user_id, amount')
    .eq('id', contact_id)
    .eq('user_id', sender_user_id)
    .maybeSingle()
  if (contactErr) {
    return json({ error: 'contact_lookup_failed', detail: contactErr.message }, 500)
  }
  if (!contact) {
    return json({ error: 'forbidden_or_not_found' }, 403)
  }

  // 2. Pull contractor branding for From-line + Reply-To.
  const { data: profile } = await supabase
    .from('fh_profiles')
    .select('full_name, company_name, company_email, email')
    .eq('user_id', sender_user_id)
    .maybeSingle()

  const companyName = (profile?.company_name || profile?.full_name || '').trim()
  const replyTo = (profile?.company_email || profile?.email || '').trim()

  // 3. Download the uploaded invoice PDF.
  const { data: fileBlob, error: dlErr } = await supabase.storage
    .from('job-files')
    .download(storage_path)
  if (dlErr || !fileBlob) {
    return json({
      error: 'pdf_download_failed',
      detail: dlErr?.message || 'PDF not found at storage_path'
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
  const fromHeader = `${fromName} <${SEND_EMAIL_FROM}>`
  const jobTitle = contact.job_title || 'your project'
  const amountLabel = formatMoneyLabel(amount_due ?? contact.amount)
  const subject = `Invoice — ${jobTitle}${amountLabel ? ` — ${amountLabel}` : ''}`
  const safeRecipientName = (recipient_name || contact.name || '').trim()
  const greeting = safeRecipientName ? `Hi ${safeRecipientName.split(/\s+/)[0]},` : 'Hi,'
  const senderLine = companyName || 'Your contractor'
  const customMessage = (sender_message || '').trim()

  const text = [
    greeting,
    '',
    customMessage || `Your invoice for ${jobTitle} is attached.${amountLabel ? ` Balance due: ${amountLabel}.` : ''}`,
    '',
    'Reply directly to this email with any questions about the invoice or to confirm payment.',
    '',
    `— ${senderLine}`
  ].join('\n')

  const html = renderInvoiceHtml({
    greeting,
    customMessage,
    jobTitle,
    amountLabel,
    senderLine,
    companyName
  })

  const safeFilename = (filename || `invoice-${contact.id}.pdf`).replace(/[^a-z0-9._-]/gi, '_')

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

  // 6. Log activity. Best-effort, never blocks the success response.
  // Schema note: fh_contacts has no invoice_sent_at column today, so the
  // activity log is the source of truth for "did we email this invoice".
  // Adding the column is a future schema change.
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

  return json({
    ok: true,
    email_id: emailId,
    sent_at: sentAtIso
  })
}

function formatMoneyLabel(n) {
  const v = Number(n || 0)
  if (!Number.isFinite(v) || v <= 0) return ''
  return `$${Math.round(v).toLocaleString()}`
}

function renderInvoiceHtml({ greeting, customMessage, jobTitle, amountLabel, senderLine, companyName }) {
  const safe = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
  const msg = customMessage
    ? safe(customMessage)
    : `Your invoice for <strong>${safe(jobTitle)}</strong> is attached.${amountLabel ? ` Balance due: <strong>${safe(amountLabel)}</strong>.` : ''}`
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#f7f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f1f1f;line-height:1.55;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f7f5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e7e5e0;overflow:hidden;">
        <tr><td style="padding:28px 32px 8px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#9a9a93;">Invoice</p>
          <p style="margin:8px 0 0;font-size:15px;color:#1f1f1f;">${safe(greeting)}</p>
        </td></tr>
        <tr><td style="padding:8px 32px 16px;">
          <p style="margin:0;font-size:15px;color:#1f1f1f;">${msg}</p>
        </td></tr>
        <tr><td style="padding:8px 32px 24px;">
          <p style="margin:0;font-size:14px;color:#5d5d57;">Reply directly to this email with any questions about the invoice or to confirm payment.</p>
        </td></tr>
        <tr><td style="padding:0 32px 28px;">
          <p style="margin:0;font-size:14px;color:#1f1f1f;">— ${safe(senderLine)}</p>
        </td></tr>
      </table>
      ${companyName ? `<p style="margin:14px 0 0;font-size:11px;color:#9a9a93;letter-spacing:0.08em;text-transform:uppercase;">Sent on behalf of ${safe(companyName)}</p>` : ''}
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

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  })
}

export const config = { path: '/api/send-invoice' }
