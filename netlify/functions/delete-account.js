// netlify/functions/delete-account.js
//
// In-app account deletion (Apple App Store Guideline 5.1.1(v) requires apps
// with account creation to let users delete their account from inside the app).
//
// Browser/app hits POST /api/delete-account with an Authorization: Bearer
// <access_token> header (the signed-in user's Supabase access token). The
// function validates the token server-side, purges the user's data across
// their tables, then deletes the auth user. No body needed — identity comes
// from the verified token so a user can only delete their own account.
//
// Env vars required:
//   SUPABASE_URL                — same origin as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   — server-only; bypasses RLS + enables auth admin

import { createClient } from '@supabase/supabase-js'

// User-owned tables keyed by user_id, ordered children-before-parents so
// foreign keys without ON DELETE CASCADE still clear. Each delete is
// best-effort; the auth-user deletion at the end is the hard requirement.
const USER_TABLES = [
  'fh_mileage', 'fh_expenses', 'fh_change_orders', 'fh_inspections',
  'fh_insurance_claims', 'fh_quote_items', 'fh_quote_versions', 'fh_job_files',
  'fh_job_todos', 'fh_job_partners', 'fh_public_links', 'fh_esign_envelopes',
  'fh_closeouts', 'fh_payments', 'fh_invoices', 'fh_notes', 'fh_notifications',
  'fh_schedule', 'fh_subs', 'fh_estimate_templates', 'fh_contacts', 'fh_clients',
  'profiles'
]

// Storage buckets the app writes to. Every object is stored under a
// `${userId}/...` path prefix (job-files: `${userId}/${jobId}/…`, job-photos
// same, sub-docs: `${userId}/${subId}/…`, logos: `${userId}/logo.ext`), so we
// can enumerate + purge a user's objects by walking that prefix.
const USER_BUCKETS = ['job-files', 'job-photos', 'sub-docs', 'logos', 'company-logos']

// Recursively collect every object path under `prefix` in `bucket`. The
// storage list API is one directory deep and returns nested folders as
// entries whose `id` is null, so we recurse into those. Best-effort: on any
// error we return what we have so a partial listing still gets cleaned up.
async function listAllObjects(supabase, bucket, prefix) {
  const out = []
  let stack = [prefix]
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
      else out.push(full)
    }
  }
  return out
}

// Best-effort purge of the user's storage objects across every bucket.
// Wrapped by the caller in try/catch so a storage hiccup never aborts the
// account deletion (the auth-user removal is the hard requirement).
async function purgeUserStorage(supabase, userId, warnings) {
  for (const bucket of USER_BUCKETS) {
    try {
      const paths = await listAllObjects(supabase, bucket, userId)
      for (let i = 0; i < paths.length; i += 100) {
        const batch = paths.slice(i, i + 100)
        const { error } = await supabase.storage.from(bucket).remove(batch)
        if (error) warnings.push({ bucket, message: error.message })
      }
    } catch (e) {
      warnings.push({ bucket, message: e?.message || String(e) })
    }
  }
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
    return json({ error: 'server_misconfigured', detail: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.' }, 500)
  }

  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    return json({ error: 'missing_token', detail: 'Authorization: Bearer <access_token> is required.' }, 401)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // Validate the caller's token and resolve their user id.
  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData?.user?.id) {
    return json({ error: 'invalid_token' }, 401)
  }
  const userId = userData.user.id

  // Best-effort purge of the user's data.
  const failed = []
  for (const table of USER_TABLES) {
    const { error } = await supabase.from(table).delete().eq('user_id', userId)
    if (error) failed.push({ table, message: error.message })
  }

  // Best-effort purge of the user's storage objects (job-files, job-photos,
  // sub-docs, logos, …). Wrapped so a storage failure logs a warning but
  // never aborts the account deletion below.
  const storageWarnings = []
  try {
    await purgeUserStorage(supabase, userId, storageWarnings)
  } catch (e) {
    console.error('[delete-account] storage purge failed', e)
    storageWarnings.push({ bucket: '*', message: e?.message || String(e) })
  }

  // Hard requirement: remove the auth account.
  const { error: delErr } = await supabase.auth.admin.deleteUser(userId)
  if (delErr) {
    console.error('[delete-account] auth deleteUser failed', delErr)
    return json({ error: 'delete_failed', detail: delErr.message }, 500)
  }

  return json({ ok: true, purge_warnings: failed, storage_warnings: storageWarnings })
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
