// Netlify Function — Send proposal/quote email to the client.
//
// Browser hits POST /api/send-quote with the contact_id, recipient email,
// storage_path of the PDF already uploaded to the job-files bucket, and
// the calling user's id. We verify ownership server-side, download the
// PDF using the service role, send it via Resend with the contractor's
// company name in the display name and Reply-To, then flip
// proposal_status='sent' + quote_sent_at + log activity to fh_notes.
//
// Phase 1 sender policy (intentional):
//   From: `${Company Name} via FieldHorse <notifications@fieldhorse.io>`
//   Reply-To: company_email || sender's auth email
//
// True custom sender domains (quotes@parkerconstructioncompany.com) come
// in Phase 2 once each tenant has completed DNS verification. The
// "via FieldHorse" wording keeps the customer's mailbox client (Apple
// Mail / Gmail) from showing a generic "noreply" — they see the
// contractor's brand alongside the verified-sender domain.
//
// Env vars (server-only — no VITE_ prefix):
//   RESEND_API_KEY              — required to actually send
//   SEND_EMAIL_FROM             — required, e.g. notifications@fieldhorse.io
//   SEND_EMAIL_FROM_NAME        — optional, default "FieldHorse"
//   APP_BASE_URL                — optional, default https://fieldhorse.io
//   SUPABASE_URL                — required for service-role lookups
//   SUPABASE_SERVICE_ROLE_KEY   — required, bypasses RLS for owner check
//
// When RESEND_API_KEY or SEND_EMAIL_FROM are missing the function
// returns 503 with a friendly error so the client can surface
// "Email sender is not configured yet." Status/activity are NOT updated
// in that case — sending must succeed before we claim it happened.

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
  const SEND_EMAIL_FROM_NAME = process.env.SEND_EMAIL_FROM_NAME || 'FieldHorse'

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
    sender_message
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

  // 1. Verify the caller owns the contact (job). Service role bypasses
  // RLS, so we filter explicitly on user_id to prevent open-relay use.
  const { data: contact, error: contactErr } = await supabase
    .from('fh_contacts')
    .select('id, name, job_title, user_id, proposal_status')
    .eq('id', contact_id)
    .eq('user_id', sender_user_id)
    .maybeSingle()
  if (contactErr) {
    return json({ error: 'contact_lookup_failed', detail: contactErr.message }, 500)
  }
  if (!contact) {
    return json({ error: 'forbidden_or_not_found' }, 403)
  }

  // 2. Pull the contractor's profile for branding (company name) and
  // the reply-to address. company_email is preferred over the operator's
  // auth email because the operator may not want their personal address
  // on the wire.
  const { data: profile } = await supabase
    .from('fh_profiles')
    .select('full_name, company_name, company_email, email')
    .eq('user_id', sender_user_id)
    .maybeSingle()

  const companyName = (profile?.company_name || profile?.full_name || '').trim()
  const replyTo = (profile?.company_email || profile?.email || '').trim()

  // 3. Download the uploaded proposal PDF from job-files. Service role
  // bypasses the per-user folder RLS — we already verified ownership.
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

  // 4. Compose the email. Display name shows the contractor's brand
  // alongside the FieldHorse-verified sending domain — this is the
  // multi-tenant Phase-1 pattern. When companyName is empty we fall
  // back to the SEND_EMAIL_FROM_NAME default so the from line never
  // reads as a bare email address.
  const fromName = companyName
    ? `${companyName} via ${SEND_EMAIL_FROM_NAME}`
    : SEND_EMAIL_FROM_NAME
  const fromHeader = `${fromName} <${SEND_EMAIL_FROM}>`
  const subject = `Proposal${contact.job_title ? ` — ${contact.job_title}` : ''}`
  const safeRecipientName = (recipient_name || contact.name || '').trim()
  const greeting = safeRecipientName ? `Hi ${safeRecipientName.split(/\s+/)[0]},` : 'Hi,'
  const senderLine = companyName || 'Your contractor'
  const customMessage = (sender_message || '').trim()

  const text = [
    greeting,
    '',
    customMessage || `Please find the proposal for ${contact.job_title || 'your project'} attached.`,
    '',
    'Reply directly to this email if you have any questions.',
    '',
    `— ${senderLine}`
  ].join('\n')

  const html = renderQuoteHtml({
    greeting,
    customMessage,
    jobTitle: contact.job_title,
    senderLine,
    companyName
  })

  const safeFilename = (filename || `proposal-${contact.id}.pdf`).replace(/[^a-z0-9._-]/gi, '_')

  // 5. Send via Resend. Direct fetch — no SDK dependency to keep the
  // function bundle small.
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
    // Do NOT update quote_sent_at / proposal_status. Sending failed.
    return json({
      error: 'send_failed',
      provider_status: resendRes.status,
      detail: resendBody?.message || resendBody?.error || 'Email provider rejected the send.'
    }, 502)
  }

  const emailId = resendBody?.id || null
  const sentAtIso = new Date().toISOString()

  // 6. Update the contact row + log activity. Only flip status to 'sent'
  // if the quote isn't already past 'sent' (approved/closed shouldn't
  // be demoted). The CHECK constraint from migration 014 enforces the
  // legal value set.
  const nextStatus = ['draft'].includes(contact.proposal_status)
    ? 'sent'
    : contact.proposal_status
  await supabase
    .from('fh_contacts')
    .update({ quote_sent_at: sentAtIso, proposal_status: nextStatus })
    .eq('id', contact_id)
    .eq('user_id', sender_user_id)

  // Activity log row — best effort, never blocks the success response.
  try {
    await supabase.from('fh_notes').insert({
      user_id: sender_user_id,
      contact_id,
      text: `Proposal sent to ${normalizedEmail}`,
      category: 'activity'
    })
  } catch (e) {
    console.warn('[send-quote] activity log insert failed', e)
  }

  return json({
    ok: true,
    email_id: emailId,
    sent_at: sentAtIso
  })
}

function renderQuoteHtml({ greeting, customMessage, jobTitle, senderLine, companyName }) {
  const safe = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
  const msg = customMessage
    ? safe(customMessage)
    : `Please find the proposal for <strong>${safe(jobTitle || 'your project')}</strong> attached.`
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#f7f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f1f1f;line-height:1.55;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f7f5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e7e5e0;overflow:hidden;">
        <tr><td style="padding:28px 32px 8px;">
          <p style="margin:0;font-size:15px;color:#1f1f1f;">${safe(greeting)}</p>
        </td></tr>
        <tr><td style="padding:8px 32px 16px;">
          <p style="margin:0;font-size:15px;color:#1f1f1f;">${msg}</p>
        </td></tr>
        <tr><td style="padding:8px 32px 24px;">
          <p style="margin:0;font-size:14px;color:#5d5d57;">Reply directly to this email if you have any questions.</p>
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
    'Access-Control-Allow-Headers': 'Content-Type'
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  })
}

export const config = { path: '/api/send-quote' }
