// Netlify Function — Flag / reject (or clear) time punches.
// POST /api/org-punch-flag  { punch_ids: string[], flagged: bool, flag_reason?: string, org_id? }
// Authorization: Bearer <supabase access token>
//
// Owner/admin/manager only. Sets flagged + flag_reason on the punches.
// Flagging a punch also clears any prior approval (a flagged/rejected
// punch shouldn't stay approved). Clearing (flagged=false) resets the
// reason. Cross-org punches are filtered out in the UPDATE. The acting
// org comes from lib/membership.js.

import { createClient } from '@supabase/supabase-js'
import { resolveCallerMembership } from './lib/membership.js'

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
  const punchIds = Array.isArray(body?.punch_ids) ? body.punch_ids.filter((x) => typeof x === 'string') : []
  if (punchIds.length === 0) return json({ error: 'missing_punch_ids' }, 400)
  if (punchIds.length > 200) return json({ error: 'too_many_punch_ids' }, 400)
  const flagged = body?.flagged !== false // default true
  const flagReason = String(body?.flag_reason || '').trim().slice(0, 500) || null

  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${bearer}` } }
  })
  const { data: userData, error: authErr } = await authClient.auth.getUser(bearer)
  if (authErr || !userData?.user) return json({ error: 'invalid_token' }, 401)
  const authUserId = userData.user.id

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

  const resolved = await resolveCallerMembership(admin, authUserId, body)
  if (!resolved.membership) return json({ error: resolved.error, message: resolved.message }, resolved.status)
  const myMember = resolved.membership
  if (!['owner', 'admin', 'manager'].includes(myMember.role)) return json({ error: 'insufficient_role' }, 403)

  const patch = flagged
    ? { flagged: true, flag_reason: flagReason, approved_at: null, approved_by: null }
    : { flagged: false, flag_reason: null }

  const { data: updated, error: updErr } = await admin
    .from('fh_time_punches').update(patch)
    .in('id', punchIds).eq('org_id', myMember.org_id)
    .select('id')
  if (updErr) {
    console.error('[org-punch-flag] update failed', updErr)
    return json({ error: 'flag_failed', message: 'Could not update these punches. Try again.' }, 500)
  }

  return json({ ok: true, count: (updated || []).length, ids: (updated || []).map((r) => r.id) })
}

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders() } })
}

export const config = { path: '/api/org-punch-flag' }
