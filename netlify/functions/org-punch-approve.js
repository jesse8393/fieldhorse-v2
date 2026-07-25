// Netlify Function — Approve one or many time punches.
// POST /api/org-punch-approve  { punch_ids: string[] }
// Authorization: Bearer <supabase access token>
//
// Caller must be owner/admin/manager of the punches' org. Service-
// role stamps approved_at = now() and approved_by = caller_user_id.
// Cross-org punches are silently filtered out so a bulk-approve from
// one tab can't accidentally touch another tenant.

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
  const punchIds = Array.isArray(body?.punch_ids) ? body.punch_ids.filter((x) => typeof x === 'string') : []
  if (punchIds.length === 0) return json({ error: 'missing_punch_ids' }, 400)
  if (punchIds.length > 200) return json({ error: 'too_many_punch_ids' }, 400)

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

  // Freeze the rate on approval: any punch still missing an
  // hourly_rate snapshot gets the member's CURRENT default rate
  // stamped before the approval lands. Approving without a snapshot
  // left the shift priced at whatever the member's rate happens to be
  // when job cost is next computed — a raise months later silently
  // repriced already-approved (even closed-job) shifts. Service role
  // is exempt from the 054 one-time-set guard, but we only fill NULLs.
  const { data: unrated } = await admin
    .from('fh_time_punches')
    .select('id, user_id')
    .in('id', punchIds)
    .eq('org_id', myMember.org_id)
    .is('hourly_rate', null)
  if (unrated?.length) {
    const userIds = [...new Set(unrated.map((p) => p.user_id).filter(Boolean))]
    const { data: members } = await admin
      .from('org_members')
      .select('user_id, default_hourly_rate')
      .eq('org_id', myMember.org_id)
      .in('user_id', userIds)
      .is('revoked_at', null)
    const rateByUser = new Map()
    for (const m of members || []) {
      const r = Number(m.default_hourly_rate)
      if (Number.isFinite(r) && r > 0) rateByUser.set(m.user_id, r)
    }
    await Promise.all(unrated.map((p) => {
      const rate = rateByUser.get(p.user_id)
      if (!rate) return null
      return admin
        .from('fh_time_punches')
        .update({ hourly_rate: rate })
        .eq('id', p.id)
        .is('hourly_rate', null)
    }).filter(Boolean))
  }

  // Only approve punches that are (a) in the caller's org, (b) not
  // already approved, and (c) actually clocked out. Doing the org
  // match in the UPDATE filter (not just trusting punch_ids) is the
  // cross-tenant guard.
  const { data: updated, error: updErr } = await admin
    .from('fh_time_punches')
    .update({
      approved_at: new Date().toISOString(),
      approved_by: authUserId,
    })
    .in('id', punchIds)
    .eq('org_id', myMember.org_id)
    .is('approved_at', null)
    .not('punch_out_at', 'is', null)
    .select('id')

  if (updErr) return json({ error: 'approve_failed', message: updErr.message }, 500)

  return json({
    ok: true,
    approved_count: (updated || []).length,
    approved_ids: (updated || []).map((r) => r.id),
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

export const config = { path: '/api/org-punch-approve' }
