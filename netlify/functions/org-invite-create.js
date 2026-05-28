// Netlify Function — Create an org invite.
// POST /api/org-invite-create  { email, role }
// Authorization: Bearer <supabase access token>
//
// Caller must be authenticated AND be an owner/admin of an active
// membership. Creates a public.org_invites row with a fresh random
// token and a 14-day expiry. Returns the accept URL so the caller can
// share it manually (email-send wiring is a Phase B follow-up).

import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

const VALID_ROLES = ['owner', 'admin', 'manager', 'foreman', 'crew']

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
  const SITE_URL = process.env.SITE_URL || process.env.URL || ''
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: 'server_misconfigured' }, 500)
  }

  const authHeader = request.headers.get('authorization') || ''
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : ''
  if (!bearer) return json({ error: 'not_authenticated' }, 401)

  let body
  try { body = await request.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const email = String(body?.email || '').trim().toLowerCase()
  const role = String(body?.role || 'crew').trim().toLowerCase()
  if (!email || !email.includes('@')) return json({ error: 'invalid_email' }, 400)
  if (!VALID_ROLES.includes(role)) return json({ error: 'invalid_role' }, 400)

  // Verify caller and capability.
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
  if (myMember.role !== 'owner' && myMember.role !== 'admin') {
    return json({ error: 'insufficient_role' }, 403)
  }

  // Generate a fresh token (URL-safe).
  const token = crypto.randomBytes(24).toString('base64url')

  // Insert. The DB sets created_at + expires_at defaults from the
  // migration 032 definition (14 days). We pass nothing extra.
  const { data: inviteRow, error: insErr } = await admin
    .from('org_invites')
    .insert({
      org_id: myMember.org_id,
      email,
      role,
      token,
      invited_by: authUserId,
    })
    .select('id, expires_at')
    .single()

  if (insErr) return json({ error: 'invite_create_failed', message: insErr.message }, 500)

  const acceptUrl = SITE_URL
    ? `${SITE_URL.replace(/\/$/, '')}/invite/${token}`
    : `/invite/${token}`

  return json({
    ok: true,
    id: inviteRow.id,
    token,
    accept_url: acceptUrl,
    expires_at: inviteRow.expires_at,
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

export const config = { path: '/api/org-invite-create' }
