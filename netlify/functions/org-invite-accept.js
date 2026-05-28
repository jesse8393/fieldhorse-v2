// Netlify Function — Org invite accept.
// POST /api/org-invite-accept  { token }
// Authorization: Bearer <supabase access token>
//
// Verifies the caller is signed in AND that their auth email matches
// the email on the invite. Then creates a public.org_members row and
// marks public.org_invites.accepted_at via service role (which is
// the only safe path past the org_members write policy without
// risking the self-recursion that killed migration 033).
//
// Idempotent: if the user already belongs to the target org, returns
// ok with already_member=true.

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
  const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: 'server_misconfigured' }, 500)
  }

  const authHeader = request.headers.get('authorization') || ''
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : ''
  if (!bearer) return json({ error: 'not_authenticated' }, 401)

  let body
  try { body = await request.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const { token } = body || {}
  if (!token) return json({ error: 'missing_token' }, 400)

  // Verify caller JWT.
  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${bearer}` } }
  })
  const { data: userData, error: authErr } = await authClient.auth.getUser(bearer)
  if (authErr || !userData?.user) return json({ error: 'invalid_token' }, 401)

  const authUser = userData.user
  const authEmail = String(authUser.email || '').toLowerCase()
  const authUserId = authUser.id

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // Load invite.
  const { data: invite, error: invErr } = await admin
    .from('org_invites')
    .select('id, org_id, email, role, expires_at, accepted_at')
    .eq('token', token)
    .maybeSingle()

  if (invErr) return json({ error: 'lookup_failed', message: invErr.message }, 500)
  if (!invite) return json({ error: 'invite_not_found' }, 404)

  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return json({ error: 'invite_expired' }, 410)
  }
  if (String(invite.email).toLowerCase() !== authEmail) {
    return json({ error: 'email_mismatch', detail: 'This invite was issued to a different email.' }, 403)
  }

  // Already a member? Idempotent return.
  const { data: existingMember } = await admin
    .from('org_members')
    .select('id, role, revoked_at')
    .eq('org_id', invite.org_id)
    .eq('user_id', authUserId)
    .maybeSingle()

  if (existingMember && !existingMember.revoked_at) {
    return json({ ok: true, already_member: true, org_id: invite.org_id, role: existingMember.role })
  }

  // Create the membership row OR revive a revoked one.
  if (existingMember && existingMember.revoked_at) {
    const { error: revErr } = await admin
      .from('org_members')
      .update({ role: invite.role, revoked_at: null, invited_by: invite.invited_by ?? null })
      .eq('id', existingMember.id)
    if (revErr) return json({ error: 'membership_revive_failed', message: revErr.message }, 500)
  } else {
    const { error: insErr } = await admin
      .from('org_members')
      .insert({
        org_id: invite.org_id,
        user_id: authUserId,
        role: invite.role,
        invited_by: invite.invited_by ?? null,
      })
    if (insErr) return json({ error: 'membership_create_failed', message: insErr.message }, 500)
  }

  // Mark invite accepted (best-effort; the membership row is the
  // source of truth, so don't fail the request if this step has a
  // transient hiccup).
  await admin
    .from('org_invites')
    .update({ accepted_at: new Date().toISOString(), accepted_by: authUserId })
    .eq('id', invite.id)

  return json({ ok: true, org_id: invite.org_id, role: invite.role })
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

export const config = { path: '/api/org-invite-accept' }
