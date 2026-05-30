// Netlify Function — List pending timesheets for approval.
// POST /api/org-timesheets-list  { from?: iso, to?: iso }
// Authorization: Bearer <supabase access token>
//
// Caller must be owner/admin/manager. Returns punches in the caller's
// org that are clocked-out (punch_out_at IS NOT NULL) and NOT yet
// approved (approved_at IS NULL), within the optional [from, to)
// window. Decorates each punch with the puncher's display name +
// email so the approver can read a real roster, not raw user_ids.

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

  let body = {}
  try { body = (await request.json()) || {} } catch { /* allow empty */ }
  const from = typeof body.from === 'string' ? body.from : null
  const to   = typeof body.to   === 'string' ? body.to   : null

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

  // Caller role gate.
  const { data: myMember } = await admin
    .from('org_members')
    .select('org_id, role, revoked_at')
    .eq('user_id', authUserId)
    .is('revoked_at', null)
    .order('joined_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!myMember) return json({ error: 'no_membership' }, 403)
  if (!['owner', 'admin', 'manager'].includes(myMember.role)) {
    return json({ error: 'insufficient_role' }, 403)
  }

  // Pending punches in caller's org.
  let query = admin
    .from('fh_time_punches')
    .select('id, user_id, contact_id, punch_in_at, punch_out_at, hourly_rate, break_minutes, notes, flagged, flag_reason, approved_at')
    .eq('org_id', myMember.org_id)
    .is('approved_at', null)
    .not('punch_out_at', 'is', null)
    .order('punch_in_at', { ascending: true })

  if (from) query = query.gte('punch_in_at', from)
  if (to)   query = query.lt('punch_in_at', to)

  const { data: punches, error: pErr } = await query.limit(500)
  if (pErr) return json({ error: 'punches_lookup_failed', message: pErr.message }, 500)

  // Decorate with puncher info + linked-job names.
  const userIds = Array.from(new Set((punches || []).map((p) => p.user_id)))
  const contactIds = Array.from(new Set(
    (punches || []).map((p) => p.contact_id).filter(Boolean)
  ))

  let profilesById = {}
  if (userIds.length > 0) {
    const { data: profs } = await admin
      .from('profiles')
      .select('user_id, full_name, company_name')
      .in('user_id', userIds)
    profilesById = Object.fromEntries((profs || []).map((p) => [p.user_id, p]))
  }
  let emailsById = {}
  try {
    const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 1000 })
    emailsById = Object.fromEntries((usersList?.users || []).map((u) => [u.id, u.email]))
  } catch { /* non-fatal */ }
  let contactsById = {}
  if (contactIds.length > 0) {
    const { data: cs } = await admin
      .from('fh_contacts')
      .select('id, name')
      .in('id', contactIds)
    contactsById = Object.fromEntries((cs || []).map((c) => [c.id, c]))
  }

  const decorated = (punches || []).map((p) => {
    const inMs = p.punch_in_at ? new Date(p.punch_in_at).getTime() : 0
    const outMs = p.punch_out_at ? new Date(p.punch_out_at).getTime() : 0
    const minutes = Math.max(0, Math.round((outMs - inMs) / 60_000) - (p.break_minutes || 0))
    return {
      id: p.id,
      user_id: p.user_id,
      user_name: profilesById[p.user_id]?.full_name || null,
      user_email: emailsById[p.user_id] || null,
      contact_id: p.contact_id,
      contact_name: p.contact_id ? (contactsById[p.contact_id]?.name || null) : null,
      punch_in_at: p.punch_in_at,
      punch_out_at: p.punch_out_at,
      minutes,
      hourly_rate: p.hourly_rate != null ? Number(p.hourly_rate) : null,
      cost: (p.hourly_rate != null) ? Number(((minutes / 60) * Number(p.hourly_rate)).toFixed(2)) : null,
      break_minutes: p.break_minutes || 0,
      notes: p.notes || null,
      flagged: !!p.flagged,
      flag_reason: p.flag_reason || null,
    }
  })

  return json({ ok: true, caller_role: myMember.role, org_id: myMember.org_id, punches: decorated })
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

export const config = { path: '/api/org-timesheets-list' }
