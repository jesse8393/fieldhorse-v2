// Netlify Function — POST /api/send-statement
//
// Emails a client STATEMENT (one PDF rolling up every open invoice
// across all of a client's properties). Sibling of send-invoice, but
// ownership is verified against fh_clients (not a single contact),
// since a statement spans many jobs.
//
// Browser hits POST /api/send-statement with:
//   { client_id, sender_user_id, recipient_email, recipient_name?,
//     storage_path, filename, total_due? }
//
// White-label sender policy matches send-invoice / send-message:
//   From:     `${Company Name} <notifications@fieldhorse.io>`
//   Reply-To: company_email || sender's auth email

import { createClient } from '@supabase/supabase-js'
import { renderPayBlock, formatFromHeader, textField } from './lib/email.js'
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
    return json({ error: 'server_misconfigured', message: 'Server is missing Supabase credentials.' }, 500)
  }
  if (!RESEND_API_KEY || !SEND_EMAIL_FROM) {
    return json({ error: 'sender_not_configured', message: 'Email sender is not configured yet.' }, 503)
  }

  const accessToken = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!accessToken) return json({ error: 'unauthorized' }, 401)

  let payload = {}
  try { payload = await request.json() } catch { /* tolerate empty body */ }
  const {
    client_id,
    sender_user_id,
    recipient_email,
    recipient_name,
    storage_path,
    filename,
    total_due
  } = payload || {}

  if (!client_id || !sender_user_id || !recipient_email || !storage_path) {
    return json({
      error: 'missing_fields',
      required: ['client_id', 'sender_user_id', 'recipient_email', 'storage_path']
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

  // 1. Verify the caller may act on the client: its creator, or an owner,
  // admin or manager of its company.
  const access = await loadAccessibleRow(supabase, {
    table: 'fh_clients', id: client_id, callerId: sender_user_id,
    select: 'name, company_name'
  })
  if (access.error === 'lookup_failed') {
    return json({ error: 'client_lookup_failed', message: 'Could not load this client. Try again.' }, 500)
  }
  if (!access.row) {
    return json({ error: 'forbidden_or_not_found', message: 'This record was not found, or your role cannot send it. Ask an owner, admin or manager.' }, 403)
  }
  const client = access.row

  // 2. Company branding for From-line + Reply-To + pay link.
  const brandingUserId = (await brandingUserIdFor(supabase, client)) || sender_user_id
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, company_name, company_email, payment_link, payment_instructions')
    .eq('user_id', brandingUserId)
    .maybeSingle()

  const companyName = (profile?.company_name || profile?.full_name || '').trim()
  const replyTo = (profile?.company_email || authData.user.email || '').trim()

  // 3. Download the uploaded statement PDF.
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
    console.error('[send-statement] pdf download failed', dlErr)
    return json({ error: 'pdf_download_failed', detail: 'Could not read the statement PDF. Try sending again.' }, 500)
  }
  const arrayBuffer = await fileBlob.arrayBuffer()
  const base64Pdf = Buffer.from(arrayBuffer).toString('base64')

  // 4. Compose.
  const fromName = companyName || SEND_EMAIL_FROM_NAME
  const fromHeader = formatFromHeader(fromName, SEND_EMAIL_FROM)
  const clientLabel = client.company_name || client.name || 'your account'
  const amountLabel = formatMoneyLabel(total_due)
  const subject = `Statement for ${clientLabel}${amountLabel ? ` (${amountLabel} due)` : ''}`
  // Optional fields read through textField so a non string value from a
  // malformed client falls back to the default instead of throwing.
  const safeRecipientName = textField(recipient_name) || textField(client.company_name) || textField(client.name)
  const greeting = safeRecipientName ? `Hi ${safeRecipientName.split(/\s+/)[0]},` : 'Hi,'
  const senderLine = companyName || 'Your contractor'
  const payLink = (profile?.payment_link || '').trim()
  const payInstructions = (profile?.payment_instructions || '').trim()

  const text = [
    greeting,
    '',
    `Attached is your current statement of open invoices across all properties.${amountLabel ? ` Total due: ${amountLabel}.` : ''}`,
    ...(payLink ? ['', `Pay online: ${payLink}`] : []),
    ...(payInstructions ? ['', payInstructions] : []),
    '',
    'Reply directly to this email with any questions or to confirm payment.',
    '',
    senderLine
  ].join('\n')

  const html = renderStatementHtml({ greeting, clientLabel, amountLabel, senderLine, payLink, payInstructions })
  const safeFilename = (textField(filename) || `statement-${client.id}.pdf`).replace(/[^a-z0-9._-]/gi, '_')

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
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
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

  return json({ ok: true, email_id: resendBody?.id || null, sent_at: new Date().toISOString() })
}

function formatMoneyLabel(n) {
  const v = Number(n || 0)
  if (!Number.isFinite(v) || v <= 0) return ''
  // Cents shown when present so the emailed figure matches the PDF's
  // cent-precise total (see send-invoice.js formatMoneyLabel).
  const hasCents = Math.abs(v - Math.round(v)) >= 0.005
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: hasCents ? 2 : 0 })}`
}

function renderStatementHtml({ greeting, clientLabel, amountLabel, senderLine, payLink, payInstructions }) {
  const safe = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
  const payRow = renderPayBlock(payLink, payInstructions, amountLabel, safe)
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#F2EDE4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#141414;line-height:1.55;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F2EDE4;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#F2EDE4;border-radius:10px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 16px;">${safe(greeting)}</p>
          <p style="margin:0 0 16px;">Attached is your current statement of open invoices for <strong>${safe(clientLabel)}</strong> across all properties.${amountLabel ? ` Total due: <strong>${safe(amountLabel)}</strong>.` : ''}</p>
        </td></tr>
        ${payRow}
        <tr><td>
          <p style="margin:0 0 16px;color:#5C5C5C;">Reply directly to this email with any questions or to confirm payment.</p>
          <p style="margin:24px 0 0;">From ${safe(senderLine)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''))
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

export const config = { path: '/api/send-statement' }
