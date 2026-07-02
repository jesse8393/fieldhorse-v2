// Netlify Function — Set an org member's default hourly rate.
// POST /api/org-member-rate  { member_user_id, rate }   (rate null clears it)
// Authorization: Bearer <supabase access token>
//
// Owner/admin only, same tier guard as role changes: you can only set rates
// for members strictly below your tier. Keeps rate-setting owner-controlled
// (crew can't set their own rate — this is the trusted path that feeds crew
// labor cost).

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

  // rate: a number >= 0 and < 10000, or null to clear.
  let rate = null
  if (body?.rate !== null && body?.rate !== undefined && body?.rate !== '') {
    rate = Number(body.rate)
    if (!Number.isFinite(rate) || rate < 0 || rate >= 10000) {
      return json({ error: 'invalid_rate', message: 'Rate must be between 0 and 10000.' }, 400)
    }
    rate = Math.round(rate * 100) / 100
  }

  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${bearer}` } }
  })
  const { data: userData, error: authErr } = await authClient.auth.getUser(bearer)
  if (authErr || !userData?.user) return json({ error: 'invalid_token' }, 401)
  const authUserId = userData.user.id

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: myMember } = await admin
    .from('org_members').select('org_id, role').eq('user_id', authUserId).is('revoked_at', null)
    .order('joined_at', { ascending: false }).limit(1).maybeSingle()
  if (!myMember) return json({ error: 'no_membership' }, 403)
  if (!['owner', 'admin'].includes(myMember.role)) return json({ error: 'insufficient_role' }, 403)
  const myTier = ROLE_TIER[myMember.role] ?? 0

  const { data: target } = await admin
    .from('org_members').select('id, role, org_id').eq('user_id', memberUserId).eq('org_id', myMember.org_id)
    .is('revoked_at', null).maybeSingle()
  if (!target) return json({ error: 'member_not_found' }, 404)
  if ((ROLE_TIER[target.role] ?? 0) >= myTier) {
    return json({ error: 'member_exceeds_caller', message: 'You can only set rates for members below your own tier.' }, 403)
  }

  const { error: updErr } = await admin
    .from('org_members').update({ default_hourly_rate: rate }).eq('id', target.id).eq('org_id', myMember.org_id)
  if (updErr) return json({ error: 'rate_update_failed', message: updErr.message }, 500)

  return json({ ok: true, rate })
}

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders() } })
}

export const config = { path: '/api/org-member-rate' }
