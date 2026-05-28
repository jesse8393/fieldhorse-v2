// Netlify Function — Sub portal context bundle.
// POST /api/sub-portal-context  {}
// Authorization: Bearer <supabase access token>
//
// Returns everything the /sub-portal screen needs in one round trip:
//   - matched_profiles: fh_sub_profiles rows where email matches the
//     caller's auth email (case-insensitive). A sub working for
//     multiple GCs has multiple rows — we hand them all back so the
//     UI can render a single combined profile or show the per-GC
//     differences.
//   - accepted_partners: fh_job_partners rows the caller has accepted.
//   - payments: fh_payments for jobs the caller is an accepted
//     partner on, newest first (last 100). RLS on fh_payments is
//     org-scoped so we have to use service-role here.
//   - linked_jobs: fh_contacts joins keyed by id for the partner +
//     payment lookups.

import { createClient } from '@supabase/supabase-js'

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

  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${bearer}` } }
  })
  const { data: userData, error: authErr } = await authClient.auth.getUser(bearer)
  if (authErr || !userData?.user) return json({ error: 'invalid_token' }, 401)
  const authUser = userData.user
  const authUserId = authUser.id
  const authEmail = String(authUser.email || '').toLowerCase()
  if (!authEmail) return json({ error: 'no_auth_email' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // 1) Sub profiles matching this caller's email (across all orgs).
  //    Email is lowercased in the column too (most callers), so we
  //    use ilike for safety against case drift.
  const profilesRes = await admin
    .from('fh_sub_profiles')
    .select('id, org_id, name, company, email, phone, address, ein, trades, insurance_carrier, insurance_policy, insurance_expires_on, coi_path, w9_path, license_path, license_number, payment_handle, payment_method, notes, created_at, updated_at')
    .ilike('email', authEmail)
    .order('updated_at', { ascending: false })

  if (profilesRes.error) {
    return json({ error: 'profile_lookup_failed', message: profilesRes.error.message }, 500)
  }

  // 2) Accepted partner rows for this caller.
  const partnersRes = await admin
    .from('fh_job_partners')
    .select('id, job_id, partner_role, accepted_at, invited_at, status, org_id, invited_by_user_id')
    .eq('partner_user_id', authUserId)
    .eq('status', 'accepted')
    .order('accepted_at', { ascending: false })
    .limit(200)

  if (partnersRes.error) {
    return json({ error: 'partners_lookup_failed', message: partnersRes.error.message }, 500)
  }

  const partners = partnersRes.data || []
  const jobIds = Array.from(new Set(partners.map((p) => p.job_id).filter(Boolean)))

  // 3) Linked job rows (the partner-read RLS would let the client read
  //    these too, but we already have service-role open — one batch).
  let linkedJobs = {}
  if (jobIds.length > 0) {
    const { data: jobs } = await admin
      .from('fh_contacts')
      .select('id, name, address, stage, amount, updated_at, job_title')
      .in('id', jobIds)
    linkedJobs = Object.fromEntries((jobs || []).map((j) => [j.id, j]))
  }

  // 4) Payments tied to those jobs. fh_payments has no partner-read
  //    policy, so the sub-facing view only exists through service-role
  //    here. We narrow by contact_id IN jobIds so a sub never sees an
  //    unrelated org's payment row.
  let payments = []
  if (jobIds.length > 0) {
    const { data: pmt } = await admin
      .from('fh_payments')
      .select('id, contact_id, amount, kind, method, reference, paid_on, created_at')
      .in('contact_id', jobIds)
      .order('paid_on', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(100)
    payments = pmt || []
  }

  return json({
    ok: true,
    auth: { email: authEmail, user_id: authUserId },
    matched_profiles: profilesRes.data || [],
    accepted_partners: partners,
    linked_jobs: linkedJobs,
    payments,
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

export const config = { path: '/api/sub-portal-context' }
