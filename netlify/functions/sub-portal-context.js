// Netlify Function — Sub portal context bundle.
// POST /api/sub-portal-context  {}
// Authorization: Bearer <supabase access token>
//
// Returns everything the /sub-portal screen needs in one round trip:
//   - matched_profiles: fh_sub_profiles rows whose email matches the
//     caller's auth email, limited to orgs where the caller accepted a job
//     invite (see lib/subAccess.js for why email alone is not enough). A sub
//     working for several contractors has one row per contractor.
//     The contractor's private notes and org ids are never returned.
//   - accepted_partners: fh_job_partners rows the caller has accepted.
//   - linked_jobs: fh_contacts rows keyed by id for the partner rows.

import { createClient } from '@supabase/supabase-js'
import { normalizeEmail } from './lib/subAccess.js'

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
  const authEmail = normalizeEmail(authUser.email)
  if (!authEmail) return json({ error: 'no_auth_email' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // 1) Accepted partner rows for this caller.
  const partnersRes = await admin
    .from('fh_job_partners')
    .select('id, job_id, partner_role, accepted_at, invited_at, status, org_id, invited_by_user_id')
    .eq('partner_user_id', authUserId)
    .eq('status', 'accepted')
    .order('accepted_at', { ascending: false })
    .limit(200)

  if (partnersRes.error) {
    console.error('[sub-portal-context] partner lookup failed', partnersRes.error)
    return json({ error: 'partners_lookup_failed', message: 'Could not load your jobs. Try again shortly.' }, 500)
  }

  const partners = partnersRes.data || []
  const jobIds = Array.from(new Set(partners.map((p) => p.job_id).filter(Boolean)))

  // 2) Linked job rows. No `amount`: the contractor's contract value with
  //    their customer is not the sub's business. org_id is read only to
  //    scope the profile lookup below and is not returned.
  let linkedJobs = {}
  const boundOrgIds = new Set()
  if (jobIds.length > 0) {
    const { data: jobs, error: jobsErr } = await admin
      .from('fh_contacts')
      .select('id, org_id, name, address, stage, updated_at, job_title')
      .in('id', jobIds)
    if (jobsErr) {
      console.error('[sub-portal-context] job lookup failed', jobsErr)
      return json({ error: 'jobs_lookup_failed', message: 'Could not load your jobs. Try again shortly.' }, 500)
    }
    for (const j of jobs || []) {
      if (j.org_id) boundOrgIds.add(j.org_id)
      const { org_id: _org, ...publicJob } = j
      linkedJobs[j.id] = publicJob
    }
  }

  // 3) Vendor profiles for this email, only in orgs where the caller
  //    accepted a job invite. Exact match, NOT .ilike: LIKE metacharacters
  //    (`_`, `%`) in a caller's own address would match other subs' rows.
  //    Stored emails are lowercased by a trigger (migration 065).
  let profiles = []
  if (boundOrgIds.size > 0) {
    const profilesRes = await admin
      .from('fh_sub_profiles')
      .select('id, name, company, email, phone, address, ein, trades, insurance_carrier, insurance_policy, insurance_expires_on, coi_path, w9_path, license_path, license_number, payment_handle, payment_method, created_at, updated_at')
      .eq('email', authEmail)
      .in('org_id', Array.from(boundOrgIds))
      .order('updated_at', { ascending: false })
    if (profilesRes.error) {
      console.error('[sub-portal-context] profile lookup failed', profilesRes.error)
      return json({ error: 'profile_lookup_failed', message: 'Could not load your profile. Try again shortly.' }, 500)
    }
    profiles = profilesRes.data || []
  }

  // NOTE — deliberately NO fh_payments here. Those rows are the GC's
  // client→contractor receipts, not money paid to the sub; returning
  // them (as this endpoint used to) both showed the sub a wildly wrong
  // "Paid YTD" (the GC's revenue) and leaked every payment's amount /
  // method / reference to every partner on the job. There is no per-sub
  // payment ledger in the schema today; until one exists the portal
  // shows no payment figures at all.

  return json({
    ok: true,
    auth: { email: authEmail, user_id: authUserId },
    matched_profiles: profiles,
    accepted_partners: partners,
    linked_jobs: linkedJobs,
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
