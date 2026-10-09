// Netlify Function — Approve one or many time punches.
// POST /api/org-punch-approve  { punch_ids: string[], org_id? }
// Authorization: Bearer <supabase access token>
//
// Caller must be owner/admin/manager of the punches' org (the acting org
// comes from lib/membership.js). Service role stamps
// approved_at = now() and approved_by = caller_user_id.
// Cross-org punches are silently filtered out so a bulk-approve from
// one tab can't accidentally touch another tenant.
//
// Skipped and reported back (lib/punches.js):
//   skipped_ids:  zero length shifts, the rows org-timesheets-list marks
//                 invalid; a stale client could otherwise freeze them as
//                 payroll
//   self_skipped: the caller's own punches when the caller is not an
//                 owner, so a manager or admin cannot sign off their own
//                 hours

import { createClient } from '@supabase/supabase-js'
import { resolveCallerMembership } from './lib/membership.js'
import { partitionApprovablePunches } from './lib/punches.js'

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

  const resolved = await resolveCallerMembership(admin, authUserId, body)
  if (!resolved.membership) return json({ error: resolved.error, message: resolved.message }, resolved.status)
  const myMember = resolved.membership
  if (!['owner', 'admin', 'manager'].includes(myMember.role)) {
    return json({ error: 'insufficient_role' }, 403)
  }

  // The requested punches that are still pending in the caller's org.
  // PostgREST cannot compare two columns, so the duration check runs on
  // these rows in JS and only the approvable ids reach the UPDATE below.
  const { data: pending, error: pendingErr } = await admin
    .from('fh_time_punches')
    .select('id, user_id, punch_in_at, punch_out_at, break_minutes, hourly_rate')
    .in('id', punchIds)
    .eq('org_id', myMember.org_id)
    .is('approved_at', null)
    .not('punch_out_at', 'is', null)
  if (pendingErr) {
    console.error('[org-punch-approve] punch lookup failed', pendingErr)
    return json({ error: 'approve_failed', message: 'Could not approve these punches. Try again.' }, 500)
  }
  const { approvable, invalidIds, selfIds } = partitionApprovablePunches(pending, {
    callerId: authUserId,
    callerRole: myMember.role,
  })
  const approvableIds = approvable.map((p) => p.id)
  if (approvableIds.length === 0) {
    return json({ ok: true, approved_count: 0, approved_ids: [], skipped_ids: invalidIds, self_skipped: selfIds })
  }

  // Freeze the rate on approval: any punch still missing an
  // hourly_rate snapshot gets the member's CURRENT default rate
  // stamped before the approval lands. Approving without a snapshot
  // left the shift priced at whatever the member's rate happens to be
  // when job cost is next computed — a raise months later silently
  // repriced already-approved (even closed-job) shifts. Service role
  // is exempt from the 054 one-time-set guard, but we only fill NULLs.
  const unrated = approvable.filter((p) => p.hourly_rate == null)
  if (unrated.length) {
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
    .in('id', approvableIds)
    .eq('org_id', myMember.org_id)
    .is('approved_at', null)
    .not('punch_out_at', 'is', null)
    .select('id')

  if (updErr) {
    console.error('[org-punch-approve] update failed', updErr)
    return json({ error: 'approve_failed', message: 'Could not approve these punches. Try again.' }, 500)
  }

  return json({
    ok: true,
    approved_count: (updated || []).length,
    approved_ids: (updated || []).map((r) => r.id),
    skipped_ids: invalidIds,
    self_skipped: selfIds,
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
