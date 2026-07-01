// Netlify Function — Remove (revoke) an org member.
// POST /api/org-member-remove  { member_user_id }
// Authorization: Bearer <supabase access token>
//
// Owner/admin only. Sets revoked_at on the member row. Guards:
//   - target must be in the caller's org
//   - you can't remove someone whose role is >= your own tier
//   - you can't remove the last remaining owner
//   - you can't remove yourself here (use leave/delete-account)

import { createClient } from '@supabase/supabase-js'

const ROLE_TIER = { crew: 0, foreman: 1, manager: 2, admin: 3, owner: 4 }

export default async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return json({ error: 'server_misconfigured' }, 500)

  const bearer = (request.headers.get('authorization') || '').toLowerCase().startsWith('bearer ')
    ? request.headers.get('authorization').slice(7) : ''
  if (!bearer) return json({ error: 'not_authenticated' }, 401)

  let body
  try { body = await request.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const memberUserId = String(body?.member_user_id || '').trim()
  if (!memberUserId) return json({ error: 'missing_member_user_id' }, 400)

  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${bearer}` } }
  })
  const { data: userData, error: authErr } = await authClient.auth.getUser(bearer)
  if (authErr || !userData?.user) return json({ error: 'invalid_token' }, 401)
  const authUserId = userData.user.id
  if (authUserId === memberUserId) return json({ error: 'cannot_remove_self' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: myMember } = await admin
    .from('org_members').select('org_id, role').eq('user_id', authUserId).is('revoked_at', null)
    .order('joined_at', { ascending: false }).limit(1).maybeSingle()
  if (!myMember) return json({ error: 'no_membership' }, 403)
  if (!['owner', 'admin'].includes(myMember.role)) return json({ error: 'insufficient_role' }, 403)

  const { data: target } = await admin
    .from('org_members').select('id, role, org_id').eq('user_id', memberUserId).eq('org_id', myMember.org_id)
    .is('revoked_at', null).maybeSingle()
  if (!target) return json({ error: 'member_not_found' }, 404)

  if ((ROLE_TIER[target.role] ?? 0) >= (ROLE_TIER[myMember.role] ?? 0)) {
    return json({ error: 'role_exceeds_caller', message: 'You can only remove members below your own role.' }, 403)
  }
  if (target.role === 'owner') {
    const { count } = await admin.from('org_members')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', myMember.org_id).eq('role', 'owner').is('revoked_at', null)
    if ((count ?? 0) <= 1) return json({ error: 'last_owner' }, 400)
  }

  const { error: updErr } = await admin
    .from('org_members').update({ revoked_at: new Date().toISOString() })
    .eq('id', target.id).eq('org_id', myMember.org_id)
  if (updErr) return json({ error: 'remove_failed', message: updErr.message }, 500)

  return json({ ok: true })
}

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders() } })
}

export const config = { path: '/api/org-member-remove' }
