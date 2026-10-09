// Netlify Function: sub side profile update.
// POST /api/sub-profile-update  { fields: {...} }
// Authorization: Bearer <supabase access token>
//
// Updates the sub editable fields on every fh_sub_profiles row for the
// caller's email in orgs where the caller accepted a job invite, so a sub
// working for three contractors keeps one set of insurance details current.
// See lib/subAccess.js for why the accepted invite is required.
//
// Fields the sub controls: phone, address, ein, trades, insurance_carrier,
// insurance_policy, insurance_expires_on, license_number, payment_handle,
// payment_method.
//
// Fields the contractor controls (never writable here): name, company,
// email, notes, and the document paths (managed through /api/sub-doc-confirm).

import { createClient } from '@supabase/supabase-js'
import { boundSubOrgIds, normalizeEmail, sanitizeSubProfilePatch } from './lib/subAccess.js'

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

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

  const { patch, error: patchError, detail } = sanitizeSubProfilePatch(body?.fields)
  if (patchError) return json({ error: patchError, detail }, 400)

  // Verify the caller and read their email.
  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${bearer}` } }
  })
  const { data: userData, error: authErr } = await authClient.auth.getUser(bearer)
  if (authErr || !userData?.user) return json({ error: 'invalid_token' }, 401)
  const authUserId = userData.user.id
  const authEmail = normalizeEmail(userData.user.email)
  if (!authEmail) return json({ error: 'no_auth_email' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const { orgIds, error: scopeErr } = await boundSubOrgIds(admin, authUserId)
  if (scopeErr) {
    console.error('[sub-profile-update] scope lookup failed', scopeErr)
    return json({ error: 'scope_lookup_failed', detail: 'Could not load your contractors. Try again shortly.' }, 500)
  }
  if (orgIds.length === 0) {
    return json({ error: 'no_linked_contractor', detail: 'Accept a job invite from your contractor first, then update your profile.' }, 403)
  }

  // Exact match, NOT .ilike: LIKE metacharacters (`_`, `%`) in a caller's
  // own address would match other subs' rows. Stored emails are lowercased
  // by a trigger (migration 065).
  const { data: updated, error: updErr } = await admin
    .from('fh_sub_profiles')
    .update(patch)
    .eq('email', authEmail)
    .in('org_id', orgIds)
    .select('id')

  if (updErr) {
    console.error('[sub-profile-update] update failed', updErr)
    return json({ error: 'update_failed', detail: 'Could not save your profile. Try again shortly.' }, 500)
  }

  return json({
    ok: true,
    updated_count: (updated || []).length,
    updated_ids: (updated || []).map((r) => r.id),
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

export const config = { path: '/api/sub-profile-update' }
