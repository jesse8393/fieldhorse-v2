import { supabaseServiceConfig } from './lib/serviceConfig.js'
// Netlify Function — List members + pending invites for the caller's org.
// POST /api/org-members-list  { org_id? }
// Authorization: Bearer <supabase access token>
// The acting org comes from lib/membership.js.
//
// This privileged endpoint hydrates roster identities and permits field roles
// to see teammates while withholding management-only rates. Migration 058
// also permits owner/admin/manager browser reads of org_members; the app uses
// those existing policies for a limited read-only fallback when this service
// is unavailable. Field roles must never mistake their self-only RLS result
// for the complete team.

import { createClient } from '@supabase/supabase-js'
import { readAllRows } from './lib/pagedRows.js'
import { emailsForUsers } from './lib/authEmails.js'
import { resolveCallerMembership } from './lib/membership.js'

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  const { url: SUPABASE_URL, secretKey: SERVICE_KEY, publicKey: ANON_KEY } = supabaseServiceConfig()
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: 'server_misconfigured' }, 500)
  }

  const authHeader = request.headers.get('authorization') || ''
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : ''
  if (!bearer) return json({ error: 'not_authenticated' }, 401)

  let body = {}
  try { body = (await request.json()) || {} } catch { /* allow empty */ }

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

  // 1. Find caller's active membership. lib/membership.js logs a raw DB
  // error server side and hands back a human string (a schema error was
  // previously printed verbatim in the Team UI).
  const resolved = await resolveCallerMembership(admin, authUserId, body)
  if (!resolved.membership) return json({ error: resolved.error, message: resolved.message }, resolved.status)
  const myMember = resolved.membership

  // Anyone in the org can SEE the roster (foreman + crew need to know
  // who else is on their team). Mutation actions get gated by role on
  // a per-action basis (the create + revoke endpoints).
  const orgId = myMember.org_id

  // 2. List members of this org.
  const { data: memberRows, error: memErr } = await readAllRows((from, to) => admin
    .from('org_members')
    .select('id, user_id, role, joined_at, revoked_at, invited_by, default_hourly_rate')
    .eq('org_id', orgId)
    .is('revoked_at', null)
    .order('joined_at', { ascending: true }).order('id').range(from, to))

  if (memErr) { console.error('[org-members-list] member list failed', memErr); return json({ error: 'member_list_failed', message: 'Could not load the team roster. Try again shortly.' }, 500) }

  // 3. Decorate with full_name + email from auth + profiles. Auth
  //    emails come from auth.users via admin API; profile info is a
  //    standard table read.
  const userIds = (memberRows || []).map((m) => m.user_id)
  let profilesById = {}
  if (userIds.length > 0) {
    for (let offset = 0; offset < userIds.length; offset += 100) {
      const { data: profs } = await admin
        .from('profiles')
        .select('user_id, full_name, company_name')
        .in('user_id', userIds.slice(offset, offset + 100))
      Object.assign(profilesById, Object.fromEntries((profs || []).map((p) => [p.user_id, p])))
    }
  }
  // auth.users emails for this roster only (see lib/authEmails.js).
  // Non-fatal: members render without emails if the admin API fails.
  let emailsById = {}
  try {
    emailsById = await emailsForUsers(admin, userIds)
  } catch {}

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
  const { data: inviteRows, error: inviteErr } = await readAllRows((from, to) => admin
    .from('org_invites')
    .select('id, email, role, expires_at, accepted_at, created_at, invited_by')
    .eq('org_id', orgId)
    .is('accepted_at', null)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false }).order('id').range(from, to))

  if (inviteErr) console.error('[org-members-list] invite list failed', inviteErr)

  return json({
    ok: true,
    caller_role: myMember.role,
    org_id: orgId,
    members,
    invites: inviteRows || [],
    invites_available: !inviteErr,
    ...(inviteErr ? { warning: 'invites_unavailable' } : {}),
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
