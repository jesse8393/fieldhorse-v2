// Netlify Function — Revoke a pending org invite.
// POST /api/org-invite-revoke  { invite_id }
// Authorization: Bearer <supabase access token>
//
// Owner/admin of the same org may revoke pending invites. Revocation
// sets expires_at to now (idempotent + irreversible without a new
// invite row).

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
  const inviteId = String(body?.invite_id || '').trim()
  if (!inviteId) return json({ error: 'missing_invite_id' }, 400)

  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${bearer}` } }
  })
  const { data: userData, error: authErr } = await authClient.auth.getUser(bearer)
  if (authErr || !userData?.user) return json({ error: 'invalid_token' }, 401)
  const authUserId = userData.user.id

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // Caller membership + role gate.
  const { data: myMember } = await admin
    .from('org_members')
    .select('org_id, role, revoked_at')
    .eq('user_id', authUserId)
    .is('revoked_at', null)
    .order('joined_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!myMember) return json({ error: 'no_membership' }, 403)
  if (myMember.role !== 'owner' && myMember.role !== 'admin') {
    return json({ error: 'insufficient_role' }, 403)
  }

  // Invite must belong to caller's org. Service-role read, app-side
  // org-match enforcement.
  const { data: invite } = await admin
    .from('org_invites')
    .select('id, org_id, accepted_at')
    .eq('id', inviteId)
    .maybeSingle()

  if (!invite) return json({ error: 'invite_not_found' }, 404)
  if (invite.org_id !== myMember.org_id) return json({ error: 'cross_org_revoke' }, 403)
  if (invite.accepted_at) return json({ error: 'already_accepted' }, 410)

  const { error: updErr } = await admin
    .from('org_invites')
    .update({ expires_at: new Date().toISOString() })
    .eq('id', invite.id)

  if (updErr) return json({ error: 'revoke_failed', message: updErr.message }, 500)

  return json({ ok: true })
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

export const config = { path: '/api/org-invite-revoke' }
