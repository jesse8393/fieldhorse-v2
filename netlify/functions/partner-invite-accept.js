// Netlify Function — Partner invite accept.
// POST /api/partner-invite-accept  { token }
// Authorization: Bearer <supabase access token>
//
// Requires the caller to be signed in. We verify identity via
// supabase.auth.getUser(token) using the anon key; then use the service
// role to flip fh_job_partners.status -> 'accepted' and wire partner_user_id.
//
// Email-match guard: the invite was issued for a specific email, so the
// accepting user's auth email must match (case-insensitive). This prevents
// URL-sharing from letting a non-invited account accept.

import { createClient } from '@supabase/supabase-js'
import { sendPushToUser } from './lib/push.js'

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
  if (!bearer) {
    return json({ error: 'not_authenticated' }, 401)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  const { token } = body || {}
  if (!token) return json({ error: 'missing_token' }, 400)

  // Verify the bearer token with supabase's anon client — this returns the
  // authenticated user if the JWT is valid.
  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${bearer}` } }
  })
  const { data: userData, error: authErr } = await authClient.auth.getUser(bearer)
  if (authErr || !userData?.user) {
    return json({ error: 'invalid_token' }, 401)
  }
  const authUser = userData.user
  const authEmail = String(authUser.email || '').toLowerCase()
  const authUserId = authUser.id

  // Service role client for the update.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // Load the invite.
  const { data: invite, error: invErr } = await admin
    .from('fh_job_partners')
    .select('id, job_id, partner_email, status, user_id')
    .eq('invite_token', token)
    .maybeSingle()

  if (invErr) return json({ error: 'lookup_failed', message: invErr.message }, 500)
  if (!invite) return json({ error: 'invite_not_found' }, 404)
  if (invite.status === 'revoked') return json({ error: 'invite_revoked' }, 410)

  // Email-match guard.
  if (String(invite.partner_email).toLowerCase() !== authEmail) {
    return json({ error: 'email_mismatch', detail: 'This invite was issued to a different email.' }, 403)
  }

  // Already accepted? Just return the job_id so the client redirects.
  if (invite.status === 'accepted') {
    return json({ ok: true, already_accepted: true, job_id: invite.job_id })
  }

  // Flip status + wire partner_user_id + accepted_at.
  const { error: updErr } = await admin
    .from('fh_job_partners')
    .update({
      status: 'accepted',
      partner_user_id: authUserId,
      accepted_at: new Date().toISOString()
    })
    .eq('id', invite.id)

  if (updErr) return json({ error: 'accept_failed', message: updErr.message }, 500)

  // Lock-screen ping to the inviting contractor (bell row already
  // exists via the fh_notifications trigger path). Best effort.
  await sendPushToUser(admin, invite.user_id, {
    title: 'Partner joined your job',
    body: `${invite.partner_email} accepted the invite`,
    link: `/jobs/${invite.job_id}?tab=partners`,
    tag: `partner-accepted-${invite.id}`
  })

  return json({ ok: true, job_id: invite.job_id })
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

export const config = { path: '/api/partner-invite-accept' }
