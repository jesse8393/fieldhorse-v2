// Netlify Function — Org invite preview.
// POST /api/org-invite-info  { token }
//
// Public (no auth required). Used by /invite/:token to render the
// "You've been invited to {Org} as a {role} by {inviter}" pre-accept
// screen without consuming or revealing other invites.

import { createClient } from '@supabase/supabase-js'
import { clientIp, hashIdentifier, checkRateLimit } from './lib/rateLimit.js'

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
    return json({ error: 'server_misconfigured' }, 500)
  }

  let body
  try { body = await request.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const { token } = body || {}
  if (!token) return json({ error: 'missing_token' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // Unauthenticated token lookup — rate-limit per client IP so invite
  // tokens can't be brute-forced (30/min is far above any human flow).
  const rlOk = await checkRateLimit(admin, {
    scope: 'org-invite-info',
    identifier: hashIdentifier(clientIp(request)),
    limit: 30,
  })
  if (!rlOk) return json({ error: 'rate_limited' }, 429)

  // Single invite read. Service-role bypasses RLS; we hand back only
  // the fields the accept screen needs.
  const { data: invite, error: invErr } = await admin
    .from('org_invites')
    .select('id, org_id, email, role, expires_at, accepted_at, invited_by')
    .eq('token', token)
    .maybeSingle()

  if (invErr) return json({ error: 'lookup_failed', message: invErr.message }, 500)
  if (!invite) return json({ error: 'invite_not_found' }, 404)

  // Hand back state so the UI can render the right banner without an
  // extra round-trip.
  const expired = invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()
  const accepted = !!invite.accepted_at

  // Look up the org name (the public has no RLS read on organizations
  // without a membership, so service-role is the only way pre-accept).
  const { data: org } = await admin
    .from('organizations')
    .select('id, name')
    .eq('id', invite.org_id)
    .maybeSingle()

  // Inviter's display name from profiles (best-effort).
  let inviterName = null
  if (invite.invited_by) {
    const { data: inviterProfile } = await admin
      .from('profiles')
      .select('full_name, company_name')
      .eq('user_id', invite.invited_by)
      .maybeSingle()
    inviterName = inviterProfile?.full_name || inviterProfile?.company_name || null
  }

  return json({
    ok: true,
    invite: {
      email: invite.email,
      role: invite.role,
      expires_at: invite.expires_at,
      accepted: accepted,
      expired: !!expired,
      org_id: invite.org_id,
      org_name: org?.name || null,
      inviter_name: inviterName,
    }
  })
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

export const config = { path: '/api/org-invite-info' }
