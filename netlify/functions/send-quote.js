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
//   SUPABASE_URL                — required for service-role lookups
//   SUPABASE_SERVICE_ROLE_KEY   — required, bypasses RLS for owner check
//
// When RESEND_API_KEY or SEND_EMAIL_FROM are missing the function
// returns 503 with a friendly error so the client can surface
// "Email sender is not configured yet." Status/activity are NOT updated
// in that case — sending must succeed before we claim it happened.

import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import { loadAccessibleRow, brandingUserIdFor } from './lib/orgAccess.js'
import { hashIdentifier, checkRateLimit, checkDailySendCap, DAILY_SEND_LIMIT_MESSAGE } from './lib/rateLimit.js'
import { formatFromHeader, renderParagraphs, textField, idempotencyKey, sendViaResend, sendFailure, greetingFor, EMAIL_HEAD } from './lib/email.js'

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
    quote_id,
    sender_user_id,
    recipient_email,
    recipient_name,
    storage_path,
    filename,
    sender_message,
    follow_up_on
  } = body || {}
  const followUpProvided = Object.prototype.hasOwnProperty.call(body || {}, 'follow_up_on')

  // A quote record (fh_quotes, Task 11) sends with quote_id; a job's
  // proposal still sends with contact_id.
  if ((!contact_id && !quote_id) || !sender_user_id || !recipient_email || !storage_path) {
    return json({
      error: 'missing_fields',
      required: ['contact_id or quote_id', 'sender_user_id', 'recipient_email', 'storage_path']
    }, 400)
  }

  const normalizedEmail = String(recipient_email).toLowerCase().trim()
  if (!isEmail(normalizedEmail)) {
    return json({ error: 'invalid_email' }, 400)
  }
  const safeFollowUpOn = follow_up_on == null ? null : normalizeFollowUpOn(follow_up_on)
  if (followUpProvided && follow_up_on != null && !safeFollowUpOn) {
    return json({ error: 'invalid_follow_up_on' }, 400)
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

  // Per sender cap shared by every send-* function so a signed in account
  // cannot use the platform mailbox as a bulk relay.
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

  // 1. Verify the caller may act on the contact (job): its creator, or an
  // owner, admin or manager of its company. Service role bypasses RLS, so
  // this check is what prevents open-relay use.
  const isQuote = Boolean(quote_id)
  const access = await loadAccessibleRow(supabase, isQuote
    ? { table: 'fh_quotes', id: quote_id, callerId: sender_user_id, select: 'title, status, client_id' }
    : { table: 'fh_contacts', id: contact_id, callerId: sender_user_id, select: 'name, job_title, stage, proposal_status' })
  if (access.error === 'lookup_failed') {
    return json({ error: 'contact_lookup_failed', message: isQuote ? 'Could not load this quote. Try again.' : 'Could not load this job. Try again.' }, 500)
  }
  if (!access.row) {
    return json({ error: 'forbidden_or_not_found', message: 'This record was not found, or your role cannot send it. Ask an owner, admin or manager.' }, 403)
  }
  // The row the email is written from: for a quote, its title and the
  // client's name stand where the job's title and contact name did.
  let contact = access.row
  if (isQuote) {
    const { data: client } = await supabase
      .from('fh_clients')
      .select('name')
      .eq('id', access.row.client_id)
      .maybeSingle()
    contact = { ...access.row, job_title: access.row.title, name: client?.name || null }
  }

  // 2. Pull the company's profile for branding (company name) and the
  // reply-to address. company_email is preferred over the operator's auth
  // email because the operator may not want their personal address on the
  // wire. The company owner's profile carries the branding, so a teammate
  // sending still goes out under the company's name.
  const brandingUserId = (await brandingUserIdFor(supabase, contact)) || sender_user_id
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, company_name, company_email')
    .eq('user_id', brandingUserId)
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
    console.error('[send-quote] pdf download failed', dlErr)
    return json({
      error: 'pdf_download_failed',
      detail: 'Could not read the proposal PDF. Try sending again.'
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
  const fromHeader = formatFromHeader(fromName, SEND_EMAIL_FROM)
  const subject = `Proposal${contact.job_title ? ` for ${contact.job_title}` : ''}`
  // Optional fields read through textField so a non string value from a
  // malformed client falls back to the default instead of throwing.
  const safeRecipientName = textField(recipient_name) || textField(contact.name)
  const greeting = greetingFor(safeRecipientName)
  const senderLine = companyName || 'Your contractor'
  const customMessage = textField(sender_message)
  // The PDF tells the customer to approve through the link the estimate
  // was delivered with, so the email carries it (PT-08).
  const approveUrl = await proposalLinkUrl(supabase, {
    request, isQuote, quoteId: quote_id, contactId: contact_id, orgId: access.row.org_id, senderId: sender_user_id
  })

  const text = [
    greeting,
    '',
    customMessage || `Please find the proposal for ${contact.job_title || 'your project'} attached.`,
    ...(approveUrl ? ['', `View and approve: ${approveUrl}`] : []),
    '',
    'Reply directly to this email if you have any questions.',
    '',
    senderLine
  ].join('\n')

  const html = renderQuoteHtml({
    greeting,
    customMessage,
    jobTitle: contact.job_title,
    approveUrl,
    senderLine,
    companyName
  })

  const safeFilename = (textField(filename) || `proposal-${contact.id}.pdf`).replace(/[^a-z0-9._-]/gi, '_')

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

  const sent = await sendViaResend({
    apiKey: RESEND_API_KEY,
    payload: resendPayload,
    key: idempotencyKey('send-quote', isQuote ? `quote:${quote_id}` : `job:${contact_id}`, storage_path, normalizedEmail)
  })
  if (!sent.ok) {
    // Do NOT update quote_sent_at / proposal_status. Sending failed.
    return json(sendFailure(sent), 502)
  }

  const emailId = sent.body?.id || null
  const sentAtIso = new Date().toISOString()

  // 6. Update the contact row + log activity. Only flip status to 'sent'
  // if the quote isn't already past 'sent' (approved/closed shouldn't
  // be demoted). The CHECK constraint from migration 014 enforces the
  // legal value set.
  // A failed write answers an error: the quote would otherwise still read
  // Draft after the customer has the email. Trying again is safe, the
  // idempotency key keeps the provider from mailing the customer twice.
  let scheduledFollowUpOn = null
  let statusWrite
  if (isQuote) {
    // fh_quotes keeps its own status and sent_at; it has no follow up date.
    statusWrite = await supabase
      .from('fh_quotes')
      .update(buildQuoteSendPatch({ status: contact.status, sentAtIso }))
      .eq('id', quote_id)
  } else {
    const tracking = buildQuoteTrackingPatch({
      stage: contact.stage,
      proposalStatus: contact.proposal_status,
      sentAtIso,
      followUpProvided,
      followUpOn: safeFollowUpOn
    })
    scheduledFollowUpOn = tracking.scheduledFollowUpOn
    // Access was established above; scope by id only so a teammate's send
    // records the same tracking state as the creator's.
    statusWrite = await supabase
      .from('fh_contacts')
      .update(tracking.contactPatch)
      .eq('id', contact_id)
  }
  if (statusWrite?.error) {
    console.error('[send-quote] sent status write failed', statusWrite.error)
    return json({
      error: 'status_not_saved',
      email_sent: true,
      email_id: emailId,
      message: 'The proposal was sent, but it could not be marked as sent. Try again to record it. The customer will not get a second email.'
    }, 500)
  }

  // Activity log row — best effort, never blocks the success response.
  try {
    await supabase.from('fh_notes').insert({
      user_id: sender_user_id,
      contact_id: isQuote ? null : contact_id,
      quote_id: isQuote ? quote_id : null,
      text: scheduledFollowUpOn
        ? `Proposal sent to ${normalizedEmail}. Follow up ${formatFollowUpOn(scheduledFollowUpOn)}.`
        : `Proposal sent to ${normalizedEmail}`,
      category: 'activity'
    })
  } catch (e) {
    console.warn('[send-quote] activity log insert failed', e)
  }

  return json({
    ok: true,
    email_id: emailId,
    sent_at: sentAtIso,
    follow_up_on: scheduledFollowUpOn
  })
}

// The customer link for this proposal, on the origin the request came in
// on: the newest active (not revoked, not expired) proposal link for the
// quote, or for a job's proposal the job, else a new one minted the way
// the app mints it (src/lib/publicLink.ts), under the record's company.
// Returns '' when no link can be read or made; the email still goes out.
const TOKEN_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
async function proposalLinkUrl(supabase, { request, isQuote, quoteId, contactId, orgId, senderId }) {
  let origin = ''
  try { origin = new URL(request.url).origin } catch { return '' }
  try {
    const { data: links, error } = await supabase
      .from('fh_public_links')
      .select('token, expires_at')
      .eq(isQuote ? 'quote_id' : 'contact_id', isQuote ? quoteId : contactId)
      .eq('kind', 'proposal')
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) throw error
    const now = Date.now()
    let token = (links || []).find((l) => !l.expires_at || new Date(l.expires_at).getTime() >= now)?.token
    if (!token) {
      token = Array.from({ length: 24 }, () => TOKEN_ALPHABET[crypto.randomInt(TOKEN_ALPHABET.length)]).join('')
      const { error: insErr } = await supabase
        .from('fh_public_links')
        .insert({
          user_id: senderId,
          org_id: orgId || null,
          contact_id: isQuote ? null : contactId,
          quote_id: isQuote ? quoteId : null,
          kind: 'proposal',
          token
        })
      if (insErr) throw insErr
    }
    return `${origin}/p/${token}`
  } catch (e) {
    console.warn('[send-quote] customer link unavailable, sending without it', e?.message || e)
    return ''
  }
}

function renderQuoteHtml({ greeting, customMessage, jobTitle, approveUrl, senderLine, companyName }) {
  const safe = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
  // The operator's note keeps its paragraphs and line breaks.
  const msg = customMessage
    ? renderParagraphs(customMessage, safe)
    : `<p style="margin:0;">Please find the proposal for <strong>${safe(jobTitle || 'your project')}</strong> attached.</p>`
  return `<!doctype html>
<html lang="en">
${EMAIL_HEAD}
<body style="margin:0;padding:0;background:#F2EDE4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#141414;line-height:1.55;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F2EDE4;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#F2EDE4;border-radius:10px;border:1px solid #5C5C5C;overflow:hidden;">
        <tr><td style="padding:32px 32px 8px;">
          <p style="margin:0;font-size:16px;color:#141414;">${safe(greeting)}</p>
        </td></tr>
        <tr><td style="padding:8px 32px 16px;">
          <div style="font-size:16px;color:#141414;">${msg}</div>
        </td></tr>
        ${approveUrl ? `<tr><td style="padding:4px 32px 16px;">
          <a href="${safe(approveUrl)}" style="display:inline-block;background:#C9963A;color:#141414;font-size:14px;font-weight:700;text-decoration:none;padding:12px 24px;border-radius:10px;">View and approve</a>
          <p style="margin:12px 0 0;font-size:12px;color:#5C5C5C;">Or open this link:</p>
          <p style="margin:4px 0 0;font-size:12px;color:#141414;word-break:break-all;">${safe(approveUrl)}</p>
        </td></tr>` : ''}
        <tr><td style="padding:8px 32px 24px;">
          <p style="margin:0;font-size:14px;color:#5C5C5C;">Reply directly to this email if you have any questions.</p>
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

export function normalizeFollowUpOn(value, now = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''))
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const timestamp = Date.UTC(year, month - 1, day)
  const parsed = new Date(timestamp)
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return null

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  if (timestamp < today - 86400000 || timestamp > today + (92 * 86400000)) return null
  return `${match[1]}-${match[2]}-${match[3]}`
}

export function buildQuoteTrackingPatch({
  stage,
  proposalStatus,
  sentAtIso,
  followUpProvided,
  followUpOn
}) {
  const locked = proposalStatus === 'approved'
    || ['job', 'invoice', 'closed', 'lost'].includes(stage)
  const contactPatch = {
    quote_sent_at: sentAtIso,
    proposal_status: locked ? proposalStatus : 'sent'
  }
  if (!locked && followUpProvided) contactPatch.follow_up_on = followUpOn

  return {
    contactPatch,
    scheduledFollowUpOn: !locked && followUpProvided ? followUpOn : null
  }
}

// fh_quotes after a send: sent_at is always the latest send; the status
// becomes sent unless the quote is already decided (approved, rejected,
// lost or expired), which a resend never demotes.
export function buildQuoteSendPatch({ status, sentAtIso }) {
  const current = String(status || 'draft').toLowerCase()
  const locked = ['approved', 'rejected', 'lost', 'expired'].includes(current)
  return { status: locked ? current : 'sent', sent_at: sentAtIso }
}

function formatFollowUpOn(value) {
  const [year, month, day] = String(value).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  })
}

export const config = { path: '/api/send-quote' }
