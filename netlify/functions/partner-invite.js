// Netlify Function — Partner invite issuance.
// Browser hits POST /api/partner-invite with { job_id, partner_email,
// invited_by_user_id, send_email? }.
//
// STATUS: LIVE (post migration 004_partner_jobs.sql).
//
// Flow:
//   1. Validate caller owns the job (service-role read, bypasses RLS).
//   2. Insert fh_job_partners row — the fh_fill_invite_token trigger
//      generates a random URL-safe token.
//   3. If send_email=true AND email env is configured, send the invite
//      via Resend with the contractor's company display name + Reply-To
//      set to the contractor's company/profile email. Phase 1 sender
//      domain is FieldHorse's verified domain (notifications@fieldhorse.io);
//      tenant-custom domains are deferred to Phase 2.
//   4. Return the invite URL so the client can fall back to copy/share
//      whether or not the email send was attempted.
//
// Env vars required:
//   SUPABASE_URL                — same origin as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   — server-only; bypasses RLS for ownership check
//
// Env vars optional (enable direct email send):
//   RESEND_API_KEY              — required if send_email=true is honored
//   SEND_EMAIL_FROM             — required, e.g. notifications@fieldhorse.io
//   SEND_EMAIL_FROM_NAME        — optional, default 'FieldHorse'

import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import { loadAccessibleRow, brandingUserIdFor } from './lib/orgAccess.js'
import { hashIdentifier, checkRateLimit } from './lib/rateLimit.js'
import { formatFromHeader } from './lib/email.js'

// Mirrors PARTNER_ROLES in src/lib/partners.ts. Anything else is dropped so
// a crafted request cannot put arbitrary text into a platform sent email.
const PARTNER_ROLES = ['Foreman', 'Sub', 'Estimator', 'Other']

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({
      error: 'server_misconfigured',
      detail: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in Netlify env.'
    }, 500)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const { job_id, partner_email, invited_by_user_id, send_email, partner_name, partner_role } = body || {}
  if (!job_id || !partner_email || !invited_by_user_id) {
    return json({ error: 'missing_fields', required: ['job_id', 'partner_email', 'invited_by_user_id'] }, 400)
  }

  const normalizedName = String(partner_name || '').trim().slice(0, 120) || null
  const requestedRole = String(partner_role || '').trim()
  const normalizedRole = PARTNER_ROLES.find((r) => r.toLowerCase() === requestedRole.toLowerCase()) || null

  const normalizedEmail = String(partner_email).toLowerCase().trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return json({ error: 'invalid_email' }, 400)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // Authenticate the caller. Without this, anyone who supplies a valid
  // (job_id, invited_by_user_id) pair could send white-labeled invite
  // email through the contractor's Resend sender and mint invite tokens
  // — the same open-relay hole closed on the send-* functions. Verify a
  // Supabase JWT and require it to match the claimed inviter.
  const authHeader = request.headers.get('authorization') || ''
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!accessToken) {
    return json({ error: 'missing_token', detail: 'Authorization: Bearer <access_token> is required.' }, 401)
  }
  const { data: authData, error: authErr } = await supabase.auth.getUser(accessToken)
  if (authErr || !authData?.user) {
    return json({ error: 'invalid_token' }, 401)
  }
  if (authData.user.id !== invited_by_user_id) {
    return json({ error: 'forbidden', detail: 'invited_by_user_id must match the signed-in user.' }, 403)
  }

  // Per sender cap shared by every send-* function (see send-quote.js).
  const rlOk = await checkRateLimit(supabase, {
    scope: 'send-email', identifier: hashIdentifier(invited_by_user_id), limit: 30, windowSeconds: 600,
  })
  if (!rlOk) {
    return json({ error: 'rate_limited', message: 'Too many invites sent in a short time. Try again in a few minutes.' }, 429)
  }

  // 1. Verify the caller may manage partners on this job: its creator, or
  // an owner, admin or manager of its company.
  const access = await loadAccessibleRow(supabase, {
    table: 'fh_contacts', id: job_id, callerId: invited_by_user_id, select: 'name'
  })
  if (access.error === 'lookup_failed') {
    return json({ error: 'job_lookup_failed', message: 'Could not load this job. Try again.' }, 500)
  }
  if (!access.row) {
    return json({ error: 'forbidden_or_not_found', message: 'This record was not found, or your role cannot send it. Ask an owner, admin or manager.' }, 403)
  }
  const ownedJob = access.row
  const brandingUserId = (await brandingUserIdFor(supabase, ownedJob)) || invited_by_user_id

  // 2. Insert the invite. Trigger fh_fill_invite_token generates invite_token.
  const { data: invite, error: insErr } = await supabase
    .from('fh_job_partners')
    .insert({
      job_id,
      invited_by_user_id,
      partner_email: normalizedEmail,
      partner_name: normalizedName,
      partner_role: normalizedRole,
      status: 'pending'
    })
    .select('invite_token')
    .single()

  if (insErr) {
    // Unique (job_id, partner_email) violation — resend existing invite.
    if (insErr.code === '23505') {
      const { data: existing, error: reErr } = await supabase
        .from('fh_job_partners')
        .select('id, invite_token, status')
        .eq('job_id', job_id)
        .eq('partner_email', normalizedEmail)
        .maybeSingle()
      if (reErr || !existing) {
        console.error('[partner-invite] unique-violation resend lookup failed', { insErr, reErr })
        return json({ error: 'db_insert_failed', message: 'Could not create the invite. Try again.' }, 500)
      }
      // Backfill name + role if the operator re-sent with new identity
      // info, and reissue a revoked or declined invite (see
      // buildResendPatch). A failed backfill alone stays quiet; a failed
      // reissue must not email the old, dead link.
      const { patch, reissue } = buildResendPatch({
        status: existing.status,
        partnerName: normalizedName,
        partnerRole: normalizedRole,
        nowIso: new Date().toISOString(),
        newToken: crypto.randomBytes(24).toString('hex')
      })
      let inviteToken = existing.invite_token
      let inviteStatus = existing.status
      if (Object.keys(patch).length > 0) {
        const { error: patchErr } = await supabase
          .from('fh_job_partners')
          .update(patch)
          .eq('id', existing.id)
        if (patchErr && reissue) {
          console.error('[partner-invite] reissue of a revoked invite failed', patchErr)
          return json({ error: 'db_insert_failed', message: 'Could not create the invite. Try again.' }, 500)
        }
        if (reissue) {
          inviteToken = patch.invite_token
          inviteStatus = patch.status
        }
      }
      const resentUrl = buildInviteUrl(request, inviteToken)
      const resentSendResult = send_email
        ? await sendInviteEmail({
            request,
            supabase,
            ownerUserId: brandingUserId,
            senderUserId: invited_by_user_id,
            jobId: job_id,
            recipientEmail: normalizedEmail,
            inviteUrl: resentUrl,
            jobName: ownedJob.name,
            partnerName: normalizedName,
            partnerRole: normalizedRole
          })
        : { skipped: true }
      return json({
        ok: true,
        resent: true,
        status: inviteStatus,
        invite_url: resentUrl,
        job_name: ownedJob.name || null,
        ...resentSendResult
      })
    }
    // Log the database error server side only; the client gets a plain
    // message (raw Postgres text and hints used to reach the browser).
    console.error('[partner-invite] insert failed', insErr)
    return json({
      error: 'db_insert_failed',
      message: 'Could not create the invite. Try again.'
    }, 500)
  }

  const newUrl = buildInviteUrl(request, invite.invite_token)
  const sendResult = send_email
    ? await sendInviteEmail({
        request,
        supabase,
        ownerUserId: brandingUserId,
        senderUserId: invited_by_user_id,
        jobId: job_id,
        recipientEmail: normalizedEmail,
        inviteUrl: newUrl,
        jobName: ownedJob.name,
        partnerName: normalizedName,
        partnerRole: normalizedRole
      })
    : { skipped: true }

  return json({
    ok: true,
    invite_url: newUrl,
    job_name: ownedJob.name || null,
    ...sendResult
  })
}

// Patch for an invite that already exists on this job (the unique
// job_id + partner_email row). Name and role are backfilled when given. A
// revoked or declined invite is reissued as a fresh pending invite with a
// new token: partner-invite-accept answers 410 invite_revoked for a revoked
// row, so mailing the old link again left the partner with a link that
// could never work while the sender saw "Invite sent". Partner fields are
// cleared so the new acceptance starts clean (including a soft delete, which
// would otherwise keep hiding the job after the partner accepts again).
export function buildResendPatch({ status, partnerName, partnerRole, nowIso, newToken }) {
  const patch = {}
  if (partnerName) patch.partner_name = partnerName
  if (partnerRole) patch.partner_role = partnerRole
  const reissue = status === 'revoked' || status === 'declined'
  if (reissue) {
    Object.assign(patch, {
      status: 'pending',
      invite_token: newToken,
      partner_user_id: null,
      accepted_at: null,
      invited_at: nowIso,
      deleted_by_partner_at: null,
      deleted_by_invited_at: null
    })
  }
  return { patch, reissue }
}

// Sends the invite email via Resend and logs the activity. Never throws —
// always returns a result object so the caller can attach it to the JSON
// response and let the client decide how to surface the outcome (success
// vs. fall back to copy/share). The token has already been issued by the
// time this runs, so the invite link is valid even if email fails.
async function sendInviteEmail({ request, supabase, ownerUserId, senderUserId, jobId, recipientEmail, inviteUrl, jobName, partnerName, partnerRole }) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY
  const SEND_EMAIL_FROM = process.env.SEND_EMAIL_FROM
  const SEND_EMAIL_FROM_NAME = process.env.SEND_EMAIL_FROM_NAME || 'FieldHorse'

  if (!RESEND_API_KEY || !SEND_EMAIL_FROM) {
    return { sent: false, sender_not_configured: true }
  }

  // Pull contractor branding so the From line and Reply-To carry the
  // owner's identity even though the verified sending domain is
  // FieldHorse's (Phase-1 sender policy).
  let profile = null
  try {
    const { data } = await supabase
      .from('profiles')
      .select('full_name, company_name, company_email')
      .eq('user_id', ownerUserId)
      .maybeSingle()
    profile = data || null
  } catch {}

  const companyName = (profile?.company_name || profile?.full_name || '').trim()
  const replyTo = (profile?.company_email || '').trim()
  // White-label sender policy: the From name is the contractor's brand,
  // never "Contractor via FieldHorse". Falls back to the platform default
  // only when the contractor hasn't filled in their company name yet.
  const fromName = companyName || SEND_EMAIL_FROM_NAME
  const fromHeader = formatFromHeader(fromName, SEND_EMAIL_FROM)
  const senderLine = companyName || 'Your contractor'
  const safeJob = jobName || 'a job'
  const greetingName = (partnerName || '').trim()
  const roleLabel = (partnerRole || '').trim()
  const subject = greetingName
    ? `${greetingName}, you're invited to co-manage ${safeJob}`
    : `Co-manage ${safeJob}`

  const text = [
    greetingName ? `Hi ${greetingName},` : 'Hi,',
    '',
    roleLabel
      ? `${senderLine} added you as ${aOrAn(roleLabel)} on ${safeJob}.`
      : `${senderLine} added you as a partner on ${safeJob}.`,
    '',
    'Open this link to accept the invite:',
    inviteUrl,
    '',
    'You will only see this specific job and no other contacts, rates, or data from their account.',
    '',
    senderLine
  ].join('\n')

  const html = renderInviteHtml({
    senderLine, jobName: safeJob, inviteUrl, companyName,
    partnerName: greetingName, partnerRole: roleLabel
  })

  const payload = {
    from: fromHeader,
    to: [recipientEmail],
    subject,
    text,
    html
  }
  if (replyTo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) {
    payload.reply_to = replyTo
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      return {
        sent: false,
        send_failed: true,
        provider_status: res.status,
        detail: body?.message || body?.error || 'Email provider rejected the send.'
      }
    }
    // Best-effort activity log; never blocks the response.
    try {
      await supabase.from('fh_notes').insert({
        user_id: senderUserId || ownerUserId,
        contact_id: jobId || null,
        text: `Partner invite sent to ${recipientEmail}${jobName ? ` for ${jobName}` : ''}`,
        category: 'activity'
      })
    } catch {}
    return { sent: true, email_id: body?.id || null }
  } catch (e) {
    return {
      sent: false,
      send_failed: true,
      detail: e?.message || 'Network error while contacting email provider.'
    }
  }
}

function renderInviteHtml({ senderLine, jobName, inviteUrl, companyName, partnerName, partnerRole }) {
  const safe = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
  const greeting = partnerName ? `Hi ${safe(partnerName)},` : 'Hi,'
  // The article is computed on its own; aOrAn() returns "an Estimator",
  // which used to print the role twice ("as an Estimator Estimator").
  const article = /^[aeiou]/i.test(String(partnerRole || '').trim()) ? 'an' : 'a'
  const roleClause = partnerRole
    ? `as ${article} <strong style="color:#C9963A;">${safe(partnerRole)}</strong>`
    : 'as a partner'
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#F2EDE4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#141414;line-height:1.55;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F2EDE4;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#F2EDE4;border-radius:10px;border:1px solid #5C5C5C;overflow:hidden;">
        <tr><td style="padding:32px 32px 8px;">
          <p style="margin:0;font-size:12px;letter-spacing:0;text-transform:uppercase;color:#5C5C5C;">Partner invite</p>
          <h1 style="margin:8px 0 0;font-size:24px;font-weight:600;color:#141414;letter-spacing:0;">You've been invited to help manage <em style="color:#C9963A;">${safe(jobName)}</em>.</h1>
        </td></tr>
        <tr><td style="padding:16px 32px;">
          <p style="margin:0 0 12px;font-size:16px;color:#141414;">${greeting}</p>
          <p style="margin:0;font-size:16px;color:#141414;">${safe(senderLine)} added you ${roleClause} on this job. You will only see this specific job and no other contacts, rates, or data from their account.</p>
        </td></tr>
        <tr><td style="padding:8px 32px 24px;" align="left">
          <a href="${safe(inviteUrl)}" style="display:inline-block;background:#C9963A;color:#141414;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:700;letter-spacing:0;">Accept Invite</a>
        </td></tr>
        <tr><td style="padding:0 32px 24px;">
          <p style="margin:0;font-size:12px;color:#5C5C5C;">If the button doesn't work, copy this link into your browser:</p>
          <p style="margin:8px 0 0;font-size:12px;color:#141414;word-break:break-all;">${safe(inviteUrl)}</p>
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

function aOrAn(noun) {
  if (!noun) return 'a partner'
  const first = String(noun).trim().charAt(0).toLowerCase()
  return ('aeiou'.includes(first) ? 'an ' : 'a ') + noun
}

function buildInviteUrl(request, token) {
  const origin = (() => {
    try {
      return new URL(request.url).origin
    } catch {
      return 'https://fieldhorse.io'
    }
  })()
  return `${origin}/partner-invite/${token}`
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

export const config = { path: '/api/partner-invite' }
