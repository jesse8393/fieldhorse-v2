// Netlify Function — Partner invite issuance.
// Browser hits POST /api/partner-invite with { job_id, partner_email, invited_by_user_id }.
//
// STATUS: SKELETON. Active code path returns a stub invite URL so the UI can
// be test-driven end-to-end. Full wiring activates once migration
// 004_partner_jobs.sql has been applied to Supabase AND email delivery
// (Supabase magic-link OR Resend) is configured.
//
// Required env vars (when fully wired):
//   SUPABASE_URL                — same as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   — server-only, bypasses RLS for validation
//   PARTNER_INVITE_SECRET       — signed token pepper
//   RESEND_API_KEY              — optional, for transactional email
//
// Security considerations for the real version:
//   - Validate invited_by_user_id actually owns the job (server-side fetch
//     of fh_contacts with .eq('user_id', invited_by_user_id).eq('id', job_id))
//   - Rate-limit per inviter (max 10 invites/hour)
//   - Token must be single-use; mark consumed once status flips to 'accepted'
//   - Log revoke events for audit

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const { job_id, partner_email, invited_by_user_id } = body || {}
  if (!job_id || !partner_email || !invited_by_user_id) {
    return json({ error: 'missing_fields', required: ['job_id', 'partner_email', 'invited_by_user_id'] }, 400)
  }

  // Basic email shape check. Full validation happens in the UI.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(partner_email))) {
    return json({ error: 'invalid_email' }, 400)
  }

  // ============================================================
  // TODO — wire to Supabase once migration 004_partner_jobs.sql has been run
  // ============================================================
  //
  // const { createClient } = await import('@supabase/supabase-js')
  // const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  //
  // // 1. Verify the caller owns the job.
  // const { data: ownedJob, error: ownErr } = await supabase
  //   .from('fh_contacts')
  //   .select('id, name, user_id')
  //   .eq('id', job_id)
  //   .eq('user_id', invited_by_user_id)
  //   .maybeSingle()
  // if (ownErr || !ownedJob) {
  //   return json({ error: 'forbidden_or_not_found' }, 403)
  // }
  //
  // // 2. Insert the invite. The fh_fill_invite_token trigger generates the token.
  // const { data: invite, error: insErr } = await supabase
  //   .from('fh_job_partners')
  //   .insert({
  //     job_id,
  //     invited_by_user_id,
  //     partner_email: partner_email.toLowerCase().trim(),
  //     status: 'pending'
  //   })
  //   .select('invite_token, job_id')
  //   .single()
  // if (insErr) {
  //   // Unique constraint violation = already invited. Treat as success but return
  //   // the existing invite_token so the email can be re-sent.
  //   if (insErr.code === '23505') {
  //     const { data: existing } = await supabase
  //       .from('fh_job_partners')
  //       .select('invite_token')
  //       .eq('job_id', job_id)
  //       .eq('partner_email', partner_email.toLowerCase().trim())
  //       .single()
  //     return json({ ok: true, invite_url: buildInviteUrl(request, existing?.invite_token), resent: true })
  //   }
  //   return json({ error: 'db_insert_failed', message: insErr.message }, 500)
  // }
  //
  // // 3. Send the email. If RESEND_API_KEY is set, go direct. Else fall back to
  // //    supabase.auth.admin.inviteUserByEmail() which handles the magic link.
  // await sendInviteEmail({
  //   to: partner_email,
  //   invite_url: buildInviteUrl(request, invite.invite_token),
  //   job_name: ownedJob.name || 'a job'
  // })
  //
  // return json({ ok: true, invite_url: buildInviteUrl(request, invite.invite_token) })

  // ============================================================
  // STUB (pre-migration) — generate a fake token so the UI flow works
  // ============================================================
  const stubToken = genStubToken()
  const invite_url = buildInviteUrl(request, stubToken)
  return json({
    ok: true,
    stub: true,
    invite_url,
    note: 'migration_004_not_applied — invite is not persisted and no email was sent. Copy this URL manually to test the landing page.'
  })
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

function genStubToken() {
  // 48 hex chars of browser-side-lookalike randomness. Do not trust.
  const chars = 'abcdef0123456789'
  let out = ''
  for (let i = 0; i < 48; i++) out += chars[Math.floor(Math.random() * 16)]
  return out
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
