// Netlify Function — Send proposal/quote email to the client.
//
// Browser hits POST /api/send-quote with the contact_id, recipient email,
// storage_path of the PDF already uploaded to the job-files bucket, and
// the calling user's id. We verify ownership server-side, download the
// PDF using the service role, send it via Resend with the contractor's
// company name in the display name and Reply-To, then flip
// proposal_status='sent' + quote_sent_at + log activity to fh_notes.
//
// White-label sender policy:
//   From:     `${Company Name} <notifications@fieldhorse.io>`
//   Reply-To: company_email || sender's auth email
// The customer sees ONLY the contractor's company name in the From
// display. The shared sender mailbox is the technical envelope and
// stays opaque — no "via FieldHorse" leaks anywhere in the inbox.
//
// True per-tenant sender domains (quotes@parkerconstructioncompany.com)
// remain the Phase 2 plan once each tenant completes DNS verification.
// Until then this display-name-only white-labeling is what the
// customer reads.
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

  const { data: authData, error: authErr } = await supabase.auth.getUser(accessToken)
  if (authErr || !authData?.user) {
    return json({ error: 'invalid_token' }, 401)
  }
  if (authData.user.id !== sender_user_id) {
    return json({ error: 'forbidden', detail: 'sender_user_id must match the signed-in user.' }, 403)
  }

  // 1. Verify the caller owns the contact (job). Service role bypasses
  // RLS, so we filter explicitly on user_id to prevent open-relay use.
  const { data: contact, error: contactErr } = await supabase
    .from('fh_contacts')
    .select('id, name, job_title, user_id, stage, proposal_status')
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
    .from('profiles')
    .select('full_name, company_name, company_email')
    .eq('user_id', sender_user_id)
    .maybeSingle()

  const companyName = (profile?.company_name || profile?.full_name || '').trim()
  const replyTo = (profile?.company_email || authData.user.email || '').trim()

  // 3. Download the uploaded proposal PDF from job-files. Service role
  // bypasses the per-user folder RLS, so we must re-impose tenant scoping
  // ourselves: every job-files object is written under `${userId}/...`
  // (see src/screens/**/Quote.tsx upload paths), so a path that doesn't
  // start with the caller's own id belongs to another tenant. Reject it
  // rather than let a forged storage_path exfiltrate another user's PDF.
  if (!String(storage_path).startsWith(`${sender_user_id}/`)) {
    return json({ error: 'forbidden_path', detail: 'storage_path is outside your namespace.' }, 403)
  }
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
  // White-label From header — the customer sees ONLY the contractor's
  // company name. The shared sender mailbox (whatever domain Resend
  // authenticates) is the technical envelope but its display name
  // belongs to the contractor. No "via FieldHorse" leaks to the
  // recipient inbox. Falls back to the env name only when company_name
  // is empty (incomplete contractor profile).
  const fromName = companyName || SEND_EMAIL_FROM_NAME
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
  const locked = contact.proposal_status === 'approved'
    || ['job', 'invoice', 'closed', 'lost'].includes(contact.stage)
  const nextStatus = locked ? contact.proposal_status : 'sent'
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
<body style="margin:0;padding:0;background:#F2EDE4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#141414;line-height:1.55;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F2EDE4;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#F2EDE4;border-radius:10px;border:1px solid #5C5C5C;overflow:hidden;">
        <tr><td style="padding:32px 32px 8px;">
          <p style="margin:0;font-size:16px;color:#141414;">${safe(greeting)}</p>
        </td></tr>
        <tr><td style="padding:8px 32px 16px;">
          <p style="margin:0;font-size:16px;color:#141414;">${msg}</p>
        </td></tr>
        <tr><td style="padding:8px 32px 24px;">
          <p style="margin:0;font-size:14px;color:#5C5C5C;">Reply directly to this email if you have any questions.</p>
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

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  })
}

export const config = { path: '/api/send-quote' }
