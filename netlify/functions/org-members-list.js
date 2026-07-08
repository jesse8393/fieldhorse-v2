// Netlify Function — List members + pending invites for the caller's org.
// POST /api/org-members-list  {}
// Authorization: Bearer <supabase access token>
//
// Why an edge function instead of a direct client query:
//   public.org_members has a deliberately narrow RLS policy
//   (`org_members_self_read`) that only permits reading the caller's
//   OWN row. That avoids the self-recursion that took down migration
//   033. Listing teammates therefore has to go through service-role
//   here, which applies the role gate in JS before returning data.

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

  // 1. Find caller's active membership.
  const { data: myMember, error: myErr } = await admin
    .from('org_members')
    .select('org_id, role, revoked_at')
    .eq('user_id', authUserId)
    .is('revoked_at', null)
    .order('joined_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (myErr) return json({ error: 'membership_lookup_failed', message: myErr.message }, 500)
  if (!myMember) return json({ error: 'no_membership' }, 403)

  // Anyone in the org can SEE the roster (foreman + crew need to know
  // who else is on their team). Mutation actions get gated by role on
  // a per-action basis (the create + revoke endpoints).
  const orgId = myMember.org_id

  // 2. List members of this org.
  const { data: memberRows, error: memErr } = await admin
    .from('org_members')
    .select('id, user_id, role, joined_at, revoked_at, invited_by, default_hourly_rate')
    .eq('org_id', orgId)
    .is('revoked_at', null)
    .order('joined_at', { ascending: true })

  if (memErr) return json({ error: 'member_list_failed', message: memErr.message }, 500)

  // 3. Decorate with full_name + email from auth + profiles. Auth
  //    emails come from auth.users via admin API; profile info is a
  //    standard table read.
  const userIds = (memberRows || []).map((m) => m.user_id)
  let profilesById = {}
  if (userIds.length > 0) {
    const { data: profs } = await admin
      .from('profiles')
      .select('user_id, full_name, company_name')
      .in('user_id', userIds)
    profilesById = Object.fromEntries((profs || []).map((p) => [p.user_id, p]))
  }
  // auth.users emails — admin.listUsers is paginated; for orgs with
  // small membership counts (the common case) one page suffices. If a
  // single org ever grows past 1000 members we'll need pagination
  // here, but that's not a Phase B concern.
  let emailsById = {}
  try {
    const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 1000 })
    emailsById = Object.fromEntries((usersList?.users || []).map((u) => [u.id, u.email]))
  } catch {
    // Non-fatal — return members without emails if the admin API call fails.
  }

  // Pay rates are management-only data. Every member can see the roster,
  // but crew/foreman must NOT learn each teammate's default_hourly_rate —
  // only owners and admins get the field; for everyone else it's omitted.
  const canSeeRates = myMember.role === 'owner' || myMember.role === 'admin'
  const members = (memberRows || []).map((m) => ({
    id: m.id,
    user_id: m.user_id,
    role: m.role,
    joined_at: m.joined_at,
    invited_by: m.invited_by,
    is_self: m.user_id === authUserId,
    ...(canSeeRates ? { default_hourly_rate: m.default_hourly_rate ?? null } : {}),
    name: profilesById[m.user_id]?.full_name || null,
    company_name: profilesById[m.user_id]?.company_name || null,
    email: emailsById[m.user_id] || null,
  }))

  // 4. Pending invites (un-accepted, not expired).
  const nowIso = new Date().toISOString()
  const { data: inviteRows } = await admin
    .from('org_invites')
    .select('id, email, role, expires_at, accepted_at, created_at, invited_by')
    .eq('org_id', orgId)
    .is('accepted_at', null)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })

  return json({
    ok: true,
    caller_role: myMember.role,
    org_id: orgId,
    members,
    invites: inviteRows || [],
  })
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

export const config = { path: '/api/org-members-list' }
