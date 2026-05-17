// Netlify Function — Send a free-text email message to a contact.
//
// Sibling of send-quote / send-invoice but without a PDF attachment.
// Built for the AI Compose flow: the operator generates a draft, then
// taps Send to push it as a plain email to the linked client.
//
// Browser hits POST /api/send-message with:
//   { contact_id, sender_user_id, recipient_email, recipient_name?,
//     subject?, body }
// We verify ownership server-side, send via Resend with the
// contractor's company name in the display name + Reply-To, then log
// activity to fh_notes.
//
// Phase 1 sender policy (matches send-quote / send-invoice):
//   From:     `${Company Name} via FieldHorse <notifications@fieldhorse.io>`
//   Reply-To: company_email || sender's auth email
//
// Env vars (server-only — no VITE_ prefix):
//   RESEND_API_KEY              — required to actually send
//   SEND_EMAIL_FROM             — required, e.g. notifications@fieldhorse.io
//   SEND_EMAIL_FROM_NAME        — optional, default "FieldHorse"
//   SUPABASE_URL                — required for service-role lookups
//   SUPABASE_SERVICE_ROLE_KEY   — required, bypasses RLS for owner check
//
// When env is missing returns 503 sender_not_configured so the client
// can surface a friendly "Email sender is not configured yet" toast
// and fall back to the existing mailto: handoff.

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
    return json({ error: 'server_misconfigured', message: 'Server is missing Supabase credentials.' }, 500)
  }
  if (!RESEND_API_KEY || !SEND_EMAIL_FROM) {
    return json({ error: 'sender_not_configured', message: 'Email sender is not configured yet.' }, 503)
  }

  let body
  try { body = await request.json() }
  catch { return json({ error: 'invalid_json' }, 400) }

  const {
    contact_id,
    sender_user_id,
    recipient_email,
    recipient_name,
    subject,
    body: messageBody
  } = body || {}

  if (!sender_user_id || !recipient_email || !messageBody) {
    return json({
      error: 'missing_fields',
      required: ['sender_user_id', 'recipient_email', 'body']
    }, 400)
  }

  const normalizedEmail = String(recipient_email).toLowerCase().trim()
  if (!isEmail(normalizedEmail)) {
    return json({ error: 'invalid_email' }, 400)
  }

  const trimmedBody = String(messageBody).trim()
  if (trimmedBody.length === 0) {
    return json({ error: 'empty_body' }, 400)
  }
  if (trimmedBody.length > 20000) {
    return json({ error: 'body_too_long', detail: 'Limit is 20,000 characters per message.' }, 400)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // Verify the caller owns the contact (when one is linked). For "generic"
  // Compose drafts where no contact is selected, the activity log skips
  // the contact_id column — but we still require sender_user_id auth.
  let contact = null
  if (contact_id) {
    const { data, error: cErr } = await supabase
      .from('fh_contacts')
      .select('id, name, job_title, user_id')
      .eq('id', contact_id)
      .eq('user_id', sender_user_id)
      .maybeSingle()
    if (cErr) return json({ error: 'contact_lookup_failed', detail: cErr.message }, 500)
    if (!data) return json({ error: 'forbidden_or_not_found' }, 403)
    contact = data
  }

  // Pull contractor branding for From-line + Reply-To.
  const { data: profile } = await supabase
    .from('fh_profiles')
    .select('full_name, company_name, company_email, email')
    .eq('user_id', sender_user_id)
    .maybeSingle()

  const companyName = (profile?.company_name || profile?.full_name || '').trim()
  const replyTo = (profile?.company_email || profile?.email || '').trim()
  const fromName = companyName ? `${companyName} via ${SEND_EMAIL_FROM_NAME}` : SEND_EMAIL_FROM_NAME
  const fromHeader = `${fromName} <${SEND_EMAIL_FROM}>`

  const finalSubject = (subject || '').trim()
    || (contact?.job_title ? `Re: ${contact.job_title}` : `Message from ${companyName || 'your contractor'}`)

  // Compose HTML by paragraphizing the plain-text body. Email clients
  // render plain text differently; sending both keeps it consistent.
  const html = renderMessageHtml({ body: trimmedBody, senderLine: companyName || 'Your contractor', companyName })

  const resendPayload = {
    from: fromHeader,
    to: [normalizedEmail],
    subject: finalSubject,
    text: trimmedBody,
    html
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

  // Activity log — best effort. contact_id is nullable so generic
  // messages still record a sender_user_id row that surfaces on Notes
  // even when no job is linked.
  try {
    await supabase.from('fh_notes').insert({
      user_id: sender_user_id,
      contact_id: contact_id || null,
      text: `Message sent to ${normalizedEmail}${contact?.name ? ` (${contact.name})` : ''}`,
      category: 'activity'
    })
  } catch (e) {
    console.warn('[send-message] activity log insert failed', e)
  }

  return json({ ok: true, email_id: emailId, sent_at: sentAtIso })
}

function renderMessageHtml({ body, senderLine, companyName }) {
  const safe = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
  // Convert plain-text paragraphs (double newline) into <p> blocks;
  // single newlines become <br>. Preserves the operator's intended
  // paragraph rhythm.
  const paragraphs = String(body || '')
    .split(/\n{2,}/)
    .map((p) => safe(p).replace(/\n/g, '<br>'))
    .filter((p) => p.length > 0)
  const bodyHtml = paragraphs.map((p) => `<p style="margin:0 0 14px;">${p}</p>`).join('')
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#f7f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f1f1f;line-height:1.55;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f7f5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e7e5e0;overflow:hidden;">
        <tr><td style="padding:28px 32px 8px;">
          <div style="font-size:15px;color:#1f1f1f;">${bodyHtml}</div>
        </td></tr>
        <tr><td style="padding:8px 32px 28px;">
          <p style="margin:0;font-size:14px;color:#5d5d57;">Reply directly to this email to reach ${safe(senderLine)}.</p>
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

export const config = { path: '/api/send-message' }
