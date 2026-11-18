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
import { supabaseServiceConfig } from './lib/serviceConfig.js'
import { loadAccessibleRow, brandingUserIdFor } from './lib/orgAccess.js'
import { hashIdentifier, checkRateLimit, checkDailySendCap, DAILY_SEND_LIMIT_MESSAGE } from './lib/rateLimit.js'
import { formatFromHeader, renderParagraphs, textField, documentSendKey, sendViaResend, sendFailure, greetingFor, EMAIL_HEAD } from './lib/email.js'
import { isOwnedStoragePath } from './lib/storagePath.js'

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  const { url: SUPABASE_URL, secretKey: SERVICE_KEY } = supabaseServiceConfig()
  const RESEND_API_KEY = process.env.RESEND_API_KEY
  const SEND_EMAIL_FROM = process.env.SEND_EMAIL_FROM
  const SEND_EMAIL_FROM_NAME = process.env.SEND_EMAIL_FROM_NAME || 'Notifications'

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({
      error: 'server_misconfigured',
      message: 'Email sending is not available right now. Try again later.'
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
    return json({ error: 'missing_token', detail: 'Sign in again, then try again.' }, 401)
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

  // Per sender cap shared by every send-* function (see send-quote.js).
  const rlOk = await checkRateLimit(supabase, {
    scope: 'send-email', identifier: hashIdentifier(sender_user_id), limit: 30, windowSeconds: 600,
  })
  if (!rlOk) {
    return json({ error: 'rate_limited', message: 'Too many emails sent in a short time. Try again in a few minutes.' }, 429)
  }

  const dayOk = await checkDailySendCap(supabase, sender_user_id)
  if (!dayOk) {
    return json({ error: 'rate_limited', message: DAILY_SEND_LIMIT_MESSAGE }, 429)
  }

  // 1. Verify the caller may act on the job: its creator, or an owner,
  // admin or manager of its company.
  const access = await loadAccessibleRow(supabase, {
    table: 'fh_contacts', id: contact_id, callerId: sender_user_id,
    select: 'name, job_title'
  })
  if (access.error === 'lookup_failed') {
    return json({ error: 'contact_lookup_failed', message: 'Could not load this job. Try again.' }, 500)
  }
  if (!access.row) {
    return json({ error: 'forbidden_or_not_found', message: 'This record was not found, or your role cannot send it. Ask an owner, admin or manager.' }, 403)
  }
  const contact = access.row

  // 2. Company branding (company name, reply-to).
  const brandingUserId = (await brandingUserIdFor(supabase, contact)) || sender_user_id
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, company_name, company_email')
    .eq('user_id', brandingUserId)
    .maybeSingle()

  const companyName = (profile?.company_name || profile?.full_name || '').trim()
  const replyTo = (profile?.company_email || authData.user.email || '').trim()

  // 3. Download the certificate PDF.
  // Tenant guard: the service role key ignores the per user folder rules,
  // so the path is checked here first. isOwnedStoragePath
  // (lib/storagePath.js) accepts only a PDF under the caller's own folder
  // in job-files (`${userId}/...`), written as plain segments: no "." or
  // ".." segment, no encoded character, no query string and no fragment.
  // Starting with the caller's id is not enough, because fetch resolves
  // "<id>/../.." and would take the service key to another account's file
  // or to another API of the project. See send-quote.js.
  if (!isOwnedStoragePath(storage_path, sender_user_id, { extensions: ['pdf'] })) {
    return json({ error: 'forbidden_path', detail: 'storage_path is outside your namespace.' }, 403)
  }
  const { data: fileBlob, error: dlErr } = await supabase.storage
    .from('job-files')
    .download(storage_path)
  if (dlErr || !fileBlob) {
    console.error('[send-certificate] pdf download failed', dlErr)
    return json({
      error: 'pdf_download_failed',
      detail: 'Could not read the certificate PDF. Try sending again.'
    }, 500)
  }
  const arrayBuffer = await fileBlob.arrayBuffer()
  const base64Pdf = Buffer.from(arrayBuffer).toString('base64')

  // 4. Compose. Certificate-specific subject + copy — the recipient is
  // getting a record of completed work, not a sales document, so the
  // tone is "here's your copy for your records" rather than "please
  // review and approve."
  const fromName = companyName || SEND_EMAIL_FROM_NAME
  const fromHeader = formatFromHeader(fromName, SEND_EMAIL_FROM)
  const jobLabel = contact.job_title || contact.name || 'your project'
  const subject = `Certificate of Completion for ${jobLabel}`
  // Optional fields read through textField so a non string value from a
  // malformed client falls back to the default instead of throwing.
  const safeRecipientName = textField(recipient_name) || textField(contact.name)
  const greeting = greetingFor(safeRecipientName)
  const senderLine = companyName || 'Your contractor'
  const customMessage = textField(sender_message)

  const text = [
    greeting,
    '',
    customMessage || `Attached is the Certificate of Completion for ${jobLabel}. Keep this with your records. It covers the warranty terms and the completion date.`,
    '',
    'Reply directly to this email if you have any questions or spot anything that needs follow up.',
    '',
    senderLine
  ].join('\n')

  const html = renderCertificateHtml({
    greeting,
    customMessage,
    jobLabel,
    senderLine,
    companyName
  })

  const safeFilename = (textField(filename) || `Certificate-${contact.id}.pdf`).replace(/[^a-z0-9._-]/gi, '_')

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

  const sent = await sendViaResend({
    apiKey: RESEND_API_KEY,
    payload: resendPayload,
    key: documentSendKey('send-certificate', `job:${contact_id}`, body || {}, normalizedEmail)
  })
  if (!sent.ok) {
    return json(sendFailure(sent), 502)
  }

  const emailId = sent.body?.id || null
  const sentAtIso = new Date().toISOString()

  // 6. Activity log — best-effort. Bumps fh_closeouts.updated_at via the
  // touch trigger so the recency badge on the closeout reflects the send.
  try {
    await supabase
      .from('fh_closeouts')
      .update({ updated_at: sentAtIso })
      .eq('contact_id', contact_id)
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
  // The operator's note keeps its paragraphs and line breaks.
  const msg = customMessage
    ? renderParagraphs(customMessage, safe)
    : `<p style="margin:0;">Attached is the Certificate of Completion for <strong>${safe(jobLabel)}</strong>. Keep this with your records. It covers the warranty terms and the completion date.</p>`
  return `<!doctype html>
<html lang="en">
${EMAIL_HEAD}
<body style="margin:0;padding:0;background:#F2EDE4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#141414;line-height:1.55;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F2EDE4;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#F2EDE4;border-radius:10px;border:1px solid #5C5C5C;overflow:hidden;">
        <tr><td style="padding:32px 32px 8px;">
          <p style="margin:0;font-size:12px;letter-spacing:0;color:#5C5C5C;">Certificate of completion</p>
        </td></tr>
        <tr><td style="padding:4px 32px 12px;">
          <p style="margin:0;font-size:16px;color:#141414;">${safe(greeting)}</p>
        </td></tr>
        <tr><td style="padding:0 32px 16px;">
          <div style="font-size:16px;color:#141414;">${msg}</div>
        </td></tr>
        <tr><td style="padding:0 32px 24px;">
          <p style="margin:0;font-size:14px;color:#5C5C5C;">Reply directly to this email if you have any questions or spot anything that needs follow up.</p>
        </td></tr>
        <tr><td style="padding:0 32px 32px;">
          <p style="margin:0;font-size:14px;color:#141414;">From ${safe(senderLine)}</p>
        </td></tr>
      </table>
      ${companyName ? `<p style="margin:16px 0 0;font-size:12px;color:#5C5C5C;letter-spacing:0;">Sent on behalf of ${safe(companyName)}</p>` : ''}
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

export const config = { path: '/api/send-certificate' }
