// netlify/functions/delete-account.js
//
// In-app account deletion (Apple App Store Guideline 5.1.1(v) requires apps
// with account creation to let users delete their account from inside the app).
//
// Browser/app hits POST /api/delete-account with an Authorization: Bearer
// <access_token> header (the signed-in user's Supabase access token). Identity
// comes from the verified token, so a user can only delete their own account.
//
// What happens to the data (audit 2026-10-09):
//
//   * Solo company (the caller is its only active member): the company and
//     everything in it is erased. Rows go with the auth user through the
//     user_id foreign keys (all ON DELETE CASCADE) and the company row is
//     deleted explicitly, which cascades anything left on org_id.
//
//   * Shared company (other active members exist): the team keeps its jobs,
//     clients, quotes, invoices, payments, files and notes. Rows the caller
//     created there are handed to another owner (or an admin when the caller
//     is not an owner), and so is organizations.created_by, before the auth
//     user is removed. The old version deleted every row with
//     user_id = caller and then deleted the auth user, whose cascade through
//     organizations.created_by wiped the whole company for every teammate.
//
//   * The only owner of a shared company is refused with 409
//     transfer_ownership_required until another member is made owner.
//
// Ordering: nothing destructive happens before auth.admin.deleteUser
// succeeds. Reassignment is the only write that precedes it, so a failed
// auth delete leaves a working account with its data intact instead of a
// live login over an emptied account. Storage objects are purged last.
//
// Personal records go with the person in every case: time punches, push
// subscriptions, notifications, the profile, and webhook rate limit rows.
//
// Env vars required:
//   SUPABASE_URL                — same origin as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   — server-only; bypasses RLS + enables auth admin

import { createClient } from '@supabase/supabase-js'

// Tables whose rows belong to the company's book of business. In a shared
// company, rows the caller created here are reassigned to the successor.
// Every one has user_id with ON DELETE CASCADE to auth.users, so anything
// not reassigned is removed with the account.
export const TEAM_TABLES = [
  'fh_contacts', 'fh_clients', 'fh_quote_items', 'fh_quote_versions',
  'fh_change_orders', 'fh_invoices', 'fh_payments', 'fh_expenses',
  'fh_mileage', 'fh_inspections', 'fh_insurance_claims', 'fh_closeouts',
  'fh_esign_envelopes', 'fh_public_links', 'fh_public_link_events',
  'fh_job_files', 'fh_job_todos', 'fh_notes', 'fh_schedule', 'fh_subs',
  'fh_sub_profiles', 'fh_selections', 'fh_materials', 'fh_daily_logs',
  'fh_stage_transitions', 'fh_estimate_templates', 'fh_rate_cards',
  'fh_integrations'
]

// Storage buckets the app writes to. Every object is stored under a
// `${userId}/...` path prefix (job-files: `${userId}/${jobId}/…`, job-photos
// same, sub-docs: `${userId}/${subId}/…`, logos: `${userId}/logo.ext`), so we
// can enumerate + purge a user's objects by walking that prefix.
const USER_BUCKETS = ['job-files', 'job-photos', 'sub-docs', 'logos', 'company-logos']

/**
 * Decide, per company, what happens when `userId` deletes their account.
 * Pure so it can be unit tested.
 *
 * memberships: the caller's active org_members rows [{ org_id, role }]
 * teammates:   other active members of those orgs [{ org_id, user_id, role, joined_at }]
 * orgNames:    { [org_id]: name } for error messages
 *
 * Returns { soloOrgIds, handoffs: [{ orgId, successorId }], blocked: [{ orgId, orgName }] }
 *
 * @param {{
 *   memberships?: Array<{ org_id: string, role: string }>,
 *   teammates?: Array<{ org_id: string, user_id: string, role: string, joined_at?: string | null }>,
 *   orgNames?: Record<string, string>,
 * }} input
 */
export function planAccountDeletion({ memberships = [], teammates = [], orgNames = {} }) {
  const soloOrgIds = []
  const handoffs = []
  const blocked = []
  const rank = { owner: 0, admin: 1 }
  for (const m of memberships) {
    const others = teammates
      .filter((t) => t.org_id === m.org_id)
      .sort((a, b) => {
        const ra = rank[a.role] ?? 9
        const rb = rank[b.role] ?? 9
        if (ra !== rb) return ra - rb
        return String(a.joined_at || '').localeCompare(String(b.joined_at || ''))
      })
    if (others.length === 0) {
      soloOrgIds.push(m.org_id)
      continue
    }
    const otherOwner = others.find((t) => t.role === 'owner')
    if (m.role === 'owner' && !otherOwner) {
      blocked.push({ orgId: m.org_id, orgName: orgNames[m.org_id] || 'your company' })
      continue
    }
    const successor = otherOwner || others.find((t) => t.role === 'admin')
    if (!successor) {
      blocked.push({ orgId: m.org_id, orgName: orgNames[m.org_id] || 'your company' })
      continue
    }
    handoffs.push({ orgId: m.org_id, successorId: successor.user_id })
  }
  return { soloOrgIds, handoffs, blocked }
}

// Recursively collect every object path under `prefix` in `bucket`. The
// storage list API is one directory deep and returns nested folders as
// entries whose `id` is null, so we recurse into those. Best-effort: on any
// error we return what we have so a partial listing still gets cleaned up.
async function listAllObjects(supabase, bucket, prefix) {
  const out = []
  const stack = [prefix]
  while (stack.length > 0) {
    const dir = stack.pop()
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(dir, { limit: 1000 })
    if (error || !Array.isArray(data)) continue
    for (const entry of data) {
      const full = dir ? `${dir}/${entry.name}` : entry.name
      // A null id marks a folder; a real id marks a file object.
      if (entry.id === null || entry.id === undefined) stack.push(full)
      else out.push({ bucket, path: full })
    }
  }
  return out
}

// Paths in shared companies that teammates still need after the caller
// leaves: job files and daily log photos the caller uploaded there. Their
// rows are reassigned, so the objects must survive the storage purge.
async function retainedPathsForSharedOrgs(supabase, userId, sharedOrgIds) {
  const keep = new Set()
  if (sharedOrgIds.length === 0) return keep
  const { data: files } = await supabase
    .from('fh_job_files')
    .select('storage_path')
    .eq('user_id', userId)
    .in('org_id', sharedOrgIds)
  for (const f of files || []) if (f?.storage_path) keep.add(f.storage_path)
  const { data: logs } = await supabase
    .from('fh_daily_logs')
    .select('photos')
    .eq('user_id', userId)
    .in('org_id', sharedOrgIds)
  for (const log of logs || []) {
    for (const p of Array.isArray(log?.photos) ? log.photos : []) {
      if (p && typeof p.storage_path === 'string') keep.add(p.storage_path)
    }
  }
  return keep
}

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'server_misconfigured', message: 'Account deletion is not configured on the server.' }, 500)
  }

  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    return json({ error: 'missing_token', message: 'Please sign in again.' }, 401)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // Validate the caller's token and resolve their user id.
  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData?.user?.id) {
    return json({ error: 'invalid_token', message: 'Please sign in again.' }, 401)
  }
  const userId = userData.user.id

  // 1. Work out what happens to each company before touching anything.
  const { data: memberships, error: memErr } = await supabase
    .from('org_members')
    .select('org_id, role')
    .eq('user_id', userId)
    .is('revoked_at', null)
  if (memErr) {
    console.error('[delete-account] membership lookup failed', memErr)
    return json({ error: 'lookup_failed', message: 'Could not load your company memberships. Try again.' }, 500)
  }
  const orgIds = (memberships || []).map((m) => m.org_id)
  let teammates = []
  let orgNames = {}
  if (orgIds.length > 0) {
    const [{ data: others, error: othersErr }, { data: orgs }] = await Promise.all([
      supabase
        .from('org_members')
        .select('org_id, user_id, role, joined_at')
        .in('org_id', orgIds)
        .is('revoked_at', null)
        .neq('user_id', userId),
      supabase.from('organizations').select('id, name').in('id', orgIds)
    ])
    if (othersErr) {
      console.error('[delete-account] teammate lookup failed', othersErr)
      return json({ error: 'lookup_failed', message: 'Could not load your team. Try again.' }, 500)
    }
    teammates = others || []
    orgNames = Object.fromEntries((orgs || []).map((o) => [o.id, o.name]))
  }

  const plan = planAccountDeletion({ memberships: memberships || [], teammates, orgNames })
  if (plan.blocked.length > 0) {
    const names = plan.blocked.map((b) => b.orgName).join(', ')
    return json({
      error: 'transfer_ownership_required',
      message: `You are the only owner of ${names}. Make another team member an owner in Team settings first, so the company and its records stay with your team.`,
      orgs: plan.blocked
    }, 409)
  }

  // 2. Note which storage objects teammates still need, before reassigning.
  const sharedOrgIds = plan.handoffs.map((h) => h.orgId)
  let retained = new Set()
  try {
    retained = await retainedPathsForSharedOrgs(supabase, userId, sharedOrgIds)
  } catch (e) {
    console.error('[delete-account] retained path lookup failed', e)
    return json({ error: 'lookup_failed', message: 'Could not prepare your files for handoff. Try again.' }, 500)
  }

  // 3. Hand shared company records to the successor. Non destructive.
  const handoffWarnings = []
  for (const { orgId, successorId } of plan.handoffs) {
    for (const table of TEAM_TABLES) {
      const { error } = await supabase
        .from(table)
        .update({ user_id: successorId })
        .eq('user_id', userId)
        .eq('org_id', orgId)
      if (error && error.code !== '42703' && error.code !== '42P01') {
        handoffWarnings.push({ table, message: error.message })
      }
    }
    const extra = [
      supabase.from('fh_job_partners').update({ invited_by_user_id: successorId }).eq('invited_by_user_id', userId).eq('org_id', orgId),
      supabase.from('org_invites').update({ invited_by: successorId }).eq('invited_by', userId).eq('org_id', orgId),
      supabase.from('organizations').update({ created_by: successorId }).eq('created_by', userId).eq('id', orgId)
    ]
    for (const res of await Promise.all(extra)) {
      if (res.error) handoffWarnings.push({ table: 'handoff', message: res.error.message })
    }
  }
  if (handoffWarnings.length > 0) {
    // Stop before anything is deleted. Some rows may already belong to the
    // successor, which is harmless; the caller can retry.
    console.error('[delete-account] handoff incomplete', handoffWarnings)
    return json({
      error: 'handoff_failed',
      message: 'Could not hand your company records to your team, so nothing was deleted. Try again or contact support.'
    }, 500)
  }

  // 4. Collect the caller's storage objects now (the listing needs the
  // prefix), but delete them only after the account is gone.
  const storageWarnings = []
  let objects = []
  for (const bucket of USER_BUCKETS) {
    try {
      objects = objects.concat(await listAllObjects(supabase, bucket, userId))
    } catch (e) {
      storageWarnings.push({ bucket, message: e?.message || String(e) })
    }
  }

  // 5. Hard requirement: remove the auth account. Its user_id cascades
  // remove the caller's remaining rows (solo company data and personal
  // records). A failure here leaves the account and its data intact.
  const { error: delErr } = await supabase.auth.admin.deleteUser(userId)
  if (delErr) {
    console.error('[delete-account] auth deleteUser failed', delErr)
    return json({ error: 'delete_failed', message: 'Your account could not be deleted. Nothing was removed. Try again.' }, 500)
  }

  // 6. Solo companies go with their only member. created_by usually
  // cascaded this already; the explicit delete covers companies the
  // caller joined rather than created.
  const purgeWarnings = []
  if (plan.soloOrgIds.length > 0) {
    const { error } = await supabase.from('organizations').delete().in('id', plan.soloOrgIds)
    if (error) purgeWarnings.push({ table: 'organizations', message: error.message })
  }

  // 7. Storage, skipping files teammates still reference.
  const toRemove = objects.filter((o) => !retained.has(o.path))
  const byBucket = new Map()
  for (const o of toRemove) {
    if (!byBucket.has(o.bucket)) byBucket.set(o.bucket, [])
    byBucket.get(o.bucket).push(o.path)
  }
  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await supabase.storage.from(bucket).remove(paths.slice(i, i + 100))
      if (error) storageWarnings.push({ bucket, message: error.message })
    }
  }

  // Cleanup problems after the account is gone are logged for the operator
  // and reported to the client only as a count, never as database text.
  if (purgeWarnings.length || storageWarnings.length) {
    console.error('[delete-account] cleanup warnings', { purgeWarnings, storageWarnings })
  }
  return json({
    ok: true,
    handed_off_orgs: plan.handoffs.length,
    deleted_orgs: plan.soloOrgIds.length,
    cleanup_warnings: purgeWarnings.length + storageWarnings.length
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

export const config = { path: '/api/delete-account' }
