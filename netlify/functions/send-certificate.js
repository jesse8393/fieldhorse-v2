// Netlify Function — Email the Certificate of Completion PDF to the client.
//
// Mirrors send-quote.js: the client uploads the certificate PDF to
// job-files first, then POSTs here. We verify ownership server-side,
// download the PDF with the service-role key, send it via Resend with
// the contractor's company name as the From display, and log activity
// to fh_notes.
//
// Side-effect after a successful send: bumps fh_closeouts.updated_at
// (no new column needed — the existing touch trigger handles it) and
// drops an activity note tagged with the recipient.
//
// White-label sender policy: identical to send-quote.js —
//   From:     `${Company Name} <notifications@fieldhorse.io>`
//   Reply-To: company_email || sender's auth email
// No 'via FieldHorse' anywhere in the inbox.

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

  // 1. Verify ownership.
  const { data: contact, error: contactErr } = await supabase
    .from('fh_contacts')
    .select('id, name, job_title, user_id')
    .eq('id', contact_id)
    .eq('user_id', sender_user_id)
    .maybeSingle()
  if (contactErr) {
    return json({ error: 'contact_lookup_failed', detail: contactErr.message }, 500)
  }
  if (!contact) {
    return json({ error: 'forbidden_or_not_found' }, 403)
  }

  // 2. Profile branding (company name, reply-to).
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, company_name, company_email')
    .eq('user_id', sender_user_id)
    .maybeSingle()

  const companyName = (profile?.company_name || profile?.full_name || '').trim()
  const replyTo = (profile?.company_email || authData.user.email || '').trim()

  // 3. Download the certificate PDF.
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

  // 4. Compose. Certificate-specific subject + copy — the recipient is
  // getting a record of completed work, not a sales document, so the
  // tone is "here's your copy for your records" rather than "please
  // review and approve."
  const fromName = companyName || SEND_EMAIL_FROM_NAME
  const fromHeader = `${fromName} <${SEND_EMAIL_FROM}>`
  const jobLabel = contact.job_title || contact.name || 'your project'
  const subject = `Certificate of Completion — ${jobLabel}`
  const safeRecipientName = (recipient_name || contact.name || '').trim()
  const greeting = safeRecipientName ? `Hi ${safeRecipientName.split(/\s+/)[0]},` : 'Hi,'
  const senderLine = companyName || 'Your contractor'
  const customMessage = (sender_message || '').trim()

  const text = [
    greeting,
    '',
    customMessage || `Attached is the Certificate of Completion for ${jobLabel}. Keep this with your records — it covers the warranty terms and the completion date.`,
    '',
    'Reply directly to this email if you have any questions or spot anything that needs follow-up.',
    '',
    `— ${senderLine}`
  ].join('\n')

  const html = renderCertificateHtml({
    greeting,
    customMessage,
    jobLabel,
    senderLine,
    companyName
  })

  const safeFilename = (filename || `Certificate-${contact.id}.pdf`).replace(/[^a-z0-9._-]/gi, '_')

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

  // 6. Activity log — best-effort. Bumps fh_closeouts.updated_at via the
  // touch trigger so the recency badge on the closeout reflects the send.
  try {
    await supabase
      .from('fh_closeouts')
      .update({ updated_at: sentAtIso })
      .eq('contact_id', contact_id)
      .eq('user_id', sender_user_id)
  } catch (e) {
    console.warn('[send-certificate] closeout touch failed', e)
  }

  try {
    await supabase.from('fh_notes').insert({
      user_id: sender_user_id,
      contact_id,
      text: `Certificate of Completion sent to ${normalizedEmail}`,
      category: 'activity'
    })
  } catch (e) {
    console.warn('[send-certificate] activity log insert failed', e)
  }

  return json({
    ok: true,
    email_id: emailId,
    sent_at: sentAtIso
  })
}

function renderCertificateHtml({ greeting, customMessage, jobLabel, senderLine, companyName }) {
  const safe = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
  const msg = customMessage
    ? safe(customMessage)
    : `Attached is the Certificate of Completion for <strong>${safe(jobLabel)}</strong>. Keep this with your records — it covers the warranty terms and the completion date.`
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#f7f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f1f1f;line-height:1.55;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f7f5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e7e5e0;overflow:hidden;">
        <tr><td style="padding:28px 32px 6px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#9a9a93;">Certificate of completion</p>
        </td></tr>
        <tr><td style="padding:4px 32px 12px;">
          <p style="margin:0;font-size:15px;color:#1f1f1f;">${safe(greeting)}</p>
        </td></tr>
        <tr><td style="padding:0 32px 16px;">
          <p style="margin:0;font-size:15px;color:#1f1f1f;">${msg}</p>
        </td></tr>
        <tr><td style="padding:0 32px 24px;">
          <p style="margin:0;font-size:14px;color:#5d5d57;">Reply directly to this email if you have any questions or spot anything that needs follow-up.</p>
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

export const config = { path: '/api/send-certificate' }
