// Netlify Function — Partner invite info lookup.
// GET /api/partner-invite-info?token=...
//
// Public (unauthenticated) endpoint. Returns the minimal info the landing
// page needs to render: inviter company name, job title, invited email.
// Never leak the invited_by_user_id, job_id, or any other internals.

import { createClient } from '@supabase/supabase-js'
import { clientIp, hashIdentifier, checkRateLimit } from './lib/rateLimit.js'

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }
  if (request.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'server_misconfigured' }, 500)
  }

  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  if (!token) return json({ error: 'missing_token' }, 400)

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // Unauthenticated token lookup — rate-limit per client IP so invite
  // tokens can't be brute-forced (30/min is far above any human flow).
  const rlOk = await checkRateLimit(supabase, {
    scope: 'partner-invite-info',
    identifier: hashIdentifier(clientIp(request)),
    limit: 30,
  })
  if (!rlOk) return json({ error: 'rate_limited' }, 429)

  const { data: invite, error } = await supabase
    .from('fh_job_partners')
    .select('job_id, partner_email, status, invited_by_user_id')
    .eq('invite_token', token)
    .maybeSingle()

  if (error) return json({ error: 'lookup_failed', message: error.message }, 500)
  if (!invite) return json({ error: 'invite_not_found' }, 404)
  if (invite.status === 'revoked') return json({ error: 'invite_revoked' }, 410)

  // Fetch just the job title and inviter's profile name/company, nothing else.
  const [{ data: job }, { data: profile }] = await Promise.all([
    supabase
      .from('fh_contacts')
      .select('name, job_title')
      .eq('id', invite.job_id)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('full_name, company_name')
      .eq('user_id', invite.invited_by_user_id)
      .maybeSingle()
  ])

  return json({
    ok: true,
    partner_email: invite.partner_email,
    status: invite.status,
    job_title: job?.job_title || job?.name || 'a job',
    inviter_name: profile?.full_name || null,
    inviter_company: profile?.company_name || null
  })
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  })
}

export const config = { path: '/api/partner-invite-info' }
