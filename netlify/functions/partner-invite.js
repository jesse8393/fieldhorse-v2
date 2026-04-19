// Netlify Function — Partner invite issuance.
// Browser hits POST /api/partner-invite with { job_id, partner_email, invited_by_user_id }.
//
// STATUS: LIVE (post migration 004_partner_jobs.sql).
//
// Flow:
//   1. Validate caller owns the job (service-role read, bypasses RLS).
//   2. Insert fh_job_partners row — the fh_fill_invite_token trigger
//      generates a random URL-safe token.
//   3. Return the invite URL. Email delivery is not yet wired — the client
//      copies the URL to clipboard so the flow can be test-driven today.
//
// Env vars required:
//   SUPABASE_URL                — same origin as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   — server-only; bypasses RLS for ownership check
//
// Future: add Resend/SendGrid key + sendInviteEmail() before going wide.

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

  const { job_id, partner_email, invited_by_user_id } = body || {}
  if (!job_id || !partner_email || !invited_by_user_id) {
    return json({ error: 'missing_fields', required: ['job_id', 'partner_email', 'invited_by_user_id'] }, 400)
  }

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
    return json({ error: 'job_lookup_failed', message: ownErr.message }, 500)
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
        return json({ error: 'db_insert_failed', message: insErr.message }, 500)
      }
      return json({
        ok: true,
        resent: true,
        status: existing.status,
        invite_url: buildInviteUrl(request, existing.invite_token),
        job_name: ownedJob.name || null
      })
    }
    return json({ error: 'db_insert_failed', message: insErr.message }, 500)
  }

  return json({
    ok: true,
    invite_url: buildInviteUrl(request, invite.invite_token),
    job_name: ownedJob.name || null
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
