import { supabaseServiceConfig } from './lib/serviceConfig.js'
// Netlify Function — Flag / reject (or clear) time punches.
// POST /api/org-punch-flag  { punch_ids: string[], flagged: bool, flag_reason?: string, org_id? }
// Authorization: Bearer <supabase access token>
//
// Owner/admin/manager only. Sets flagged + flag_reason on the punches.
// Flagging a punch also clears any prior approval (a flagged/rejected
// punch shouldn't stay approved). Clearing (flagged=false) resets the
// reason. Cross-org punches are filtered out in the UPDATE. The acting
// org comes from lib/membership.js.
//
// The caller's own punches are skipped and reported in self_skipped unless
// the caller is an owner, the same rule org-punch-approve applies: a
// manager or admin must not clear a flag someone put on their own time,
// or flag their own punch to undo its approval. When every punch asked for
// was the caller's own the answer is 403 own_punch.

import { createClient } from '@supabase/supabase-js'
import { resolveCallerMembership } from './lib/membership.js'

export default async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const { url: SUPABASE_URL, secretKey: SERVICE_KEY, publicKey: ANON_KEY } = supabaseServiceConfig()
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

  let selfIds = []
  if (myMember.role !== 'owner') {
    const { data: own, error: ownErr } = await admin
      .from('fh_time_punches').select('id')
      .in('id', punchIds).eq('org_id', myMember.org_id).eq('user_id', authUserId)
    if (ownErr) {
      console.error('[org-punch-flag] own punch lookup failed', ownErr)
      return json({ error: 'flag_failed', message: 'Could not update these punches. Try again.' }, 500)
    }
    selfIds = (own || []).map((r) => r.id)
  }
  const targetIds = punchIds.filter((id) => !selfIds.includes(id))
  if (targetIds.length === 0) {
    return json({
      error: 'own_punch',
      message: 'Another owner, admin or manager has to flag or clear your own punches.',
      self_skipped: selfIds
    }, 403)
  }

  let update = admin
    .from('fh_time_punches').update(patch)
    .in('id', targetIds).eq('org_id', myMember.org_id)
  // Belt and braces with the id filter above: the rule holds in the write itself.
  if (myMember.role !== 'owner') update = update.neq('user_id', authUserId)
  const { data: updated, error: updErr } = await update.select('id')
  if (updErr) {
    console.error('[org-punch-flag] update failed', updErr)
    return json({ error: 'flag_failed', message: 'Could not update these punches. Try again.' }, 500)
  }

  return json({ ok: true, count: (updated || []).length, ids: (updated || []).map((r) => r.id), self_skipped: selfIds })
}

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders() } })
}

export const config = { path: '/api/org-punch-flag' }
