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
//   APP_BASE_URL                — optional, default https://fieldhorse.io

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

  const normalizedName = String(partner_name || '').trim() || null
  const normalizedRole = String(partner_role || '').trim() || null

  const normalizedEmail = String(partner_email).toLowerCase().trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return json({ error: 'invalid_email' }, 400)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // 1. Verify the caller owns the job.
  const { data: ownedJob, error: ownErr } = await supabase
    .from('fh_contacts')
    .select('id, name, user_id')
    .eq('id', job_id)
    .eq('user_id', invited_by_user_id)
    .maybeSingle()
  if (ownErr) {
    console.error('[partner-invite] job lookup failed', ownErr)
    return json({ error: 'job_lookup_failed', detail: ownErr.message }, 500)
  }
  if (!ownedJob) {
    return json({ error: 'forbidden_or_not_found' }, 403)
  }

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
        .select('invite_token, status')
        .eq('job_id', job_id)
        .eq('partner_email', normalizedEmail)
        .maybeSingle()
      if (reErr || !existing) {
        console.error('[partner-invite] unique-violation resend lookup failed', { insErr, reErr })
        return json({ error: 'db_insert_failed', detail: insErr.message, code: insErr.code }, 500)
      }
      // Backfill name + role on the existing invite if the operator
      // re-sent with new identity info. Quiet — we don't care about
      // failures here.
      if (normalizedName || normalizedRole) {
        const patch = {}
        if (normalizedName) patch.partner_name = normalizedName
        if (normalizedRole) patch.partner_role = normalizedRole
        try {
          await supabase
            .from('fh_job_partners')
            .update(patch)
            .eq('job_id', job_id)
            .eq('partner_email', normalizedEmail)
        } catch {}
      }
      const resentUrl = buildInviteUrl(request, existing.invite_token)
      const resentSendResult = send_email
        ? await sendInviteEmail({
            request,
            supabase,
            ownerUserId: invited_by_user_id,
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
        status: existing.status,
        invite_url: resentUrl,
        job_name: ownedJob.name || null,
        ...resentSendResult
      })
    }
    // Surface the raw Supabase error to both Netlify logs and the client so
    // the operator can see whether it's a missing-table (migration 004 not run)
    // vs an RLS / schema issue.
    console.error('[partner-invite] insert failed', insErr)
    const missingTable = String(insErr.message || '').toLowerCase().includes('fh_job_partners')
      && /does not exist|not.found/.test(String(insErr.message || '').toLowerCase())
    return json({
      error: 'db_insert_failed',
      code: insErr.code || null,
      detail: insErr.message || null,
      hint: missingTable
        ? 'Table fh_job_partners does not exist. Re-run supabase/migrations/004_partner_jobs.sql in the SQL editor.'
        : (insErr.hint || null)
    }, 500)
  }

  const newUrl = buildInviteUrl(request, invite.invite_token)
  const sendResult = send_email
    ? await sendInviteEmail({
        request,
        supabase,
        ownerUserId: invited_by_user_id,
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

// Sends the invite email via Resend and logs the activity. Never throws —
// always returns a result object so the caller can attach it to the JSON
// response and let the client decide how to surface the outcome (success
// vs. fall back to copy/share). The token has already been issued by the
// time this runs, so the invite link is valid even if email fails.
async function sendInviteEmail({ request, supabase, ownerUserId, recipientEmail, inviteUrl, jobName, partnerName, partnerRole }) {
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
  const fromHeader = `${fromName} <${SEND_EMAIL_FROM}>`
  const senderLine = companyName || 'Your contractor'
  const safeJob = jobName || 'a job'
  const greetingName = (partnerName || '').trim()
  const roleLabel = (partnerRole || '').trim()
  const subject = greetingName
    ? `${greetingName} — co-manage ${safeJob}`
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
    'You will only see this specific job — no other contacts, rates, or data.',
    '',
    `— ${senderLine}`
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
        user_id: ownerUserId,
        contact_id: null,
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
  const roleClause = partnerRole
    ? `as ${aOrAn(partnerRole)} <strong style="color:#c9963a;">${safe(partnerRole)}</strong>`
    : 'as a partner'
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#f7f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f1f1f;line-height:1.55;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f7f5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e7e5e0;overflow:hidden;">
        <tr><td style="padding:28px 32px 8px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#9a9a93;">Partner invite</p>
          <h1 style="margin:8px 0 0;font-size:22px;font-weight:600;color:#1f1f1f;letter-spacing:-0.01em;">You've been invited to co-manage <em style="color:#c9963a;">${safe(jobName)}</em>.</h1>
        </td></tr>
        <tr><td style="padding:16px 32px;">
          <p style="margin:0 0 10px;font-size:15px;color:#1f1f1f;">${greeting}</p>
          <p style="margin:0;font-size:15px;color:#1f1f1f;">${safe(senderLine)} added you ${roleClause} on this job. You will only see this specific job — no other contacts, rates, or data from their account.</p>
        </td></tr>
        <tr><td style="padding:8px 32px 24px;" align="left">
          <a href="${safe(inviteUrl)}" style="display:inline-block;background:#c9963a;color:#1a1a1a;text-decoration:none;padding:12px 22px;border-radius:10px;font-size:14px;font-weight:700;letter-spacing:0.06em;">Accept Invite</a>
        </td></tr>
        <tr><td style="padding:0 32px 24px;">
          <p style="margin:0;font-size:12px;color:#5d5d57;">If the button doesn't work, copy this link into your browser:</p>
          <p style="margin:6px 0 0;font-size:12px;color:#1f1f1f;word-break:break-all;">${safe(inviteUrl)}</p>
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
    'Access-Control-Allow-Headers': 'Content-Type'
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  })
}

export const config = { path: '/api/partner-invite' }
