// Netlify Function — Sub-side doc upload confirm.
// POST /api/sub-doc-confirm  { kind, storage_path }
// Authorization: Bearer <supabase access token>
//
// Called by the client after a successful upload to the sub-docs
// bucket. Writes the storage_path into the right column on every
// fh_sub_profiles row matching the caller's email.
//
// Server-side validation:
//   - kind must be one of coi / w9 / license
//   - storage_path must start with the caller's user_id (the path
//     scheme baked in by /api/sub-doc-upload-url). This prevents a
//     malicious client from claiming someone else's path as their
//     own document.

import { createClient } from '@supabase/supabase-js'

const VALID_KINDS = ['coi', 'w9', 'license']

// Map kind → column name on fh_sub_profiles.
const COLUMN_BY_KIND = {
  coi:     'coi_path',
  w9:      'w9_path',
  license: 'license_path',
}

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
  const kind = String(body?.kind || '').toLowerCase().trim()
  const storagePath = String(body?.storage_path || '').trim()

  if (!VALID_KINDS.includes(kind)) return json({ error: 'invalid_kind' }, 400)
  if (!storagePath) return json({ error: 'missing_storage_path' }, 400)

  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${bearer}` } }
  })
  const { data: userData, error: authErr } = await authClient.auth.getUser(bearer)
  if (authErr || !userData?.user) return json({ error: 'invalid_token' }, 401)
  const authUserId = userData.user.id
  const authEmail = String(userData.user.email || '').toLowerCase()
  if (!authEmail) return json({ error: 'no_auth_email' }, 400)

  // Ownership guard: the path must start with the caller's user_id.
  // Matches the path scheme produced by /api/sub-doc-upload-url:
  //   <userId>/<kind>/<ts>-<rand>.<ext>
  if (!storagePath.startsWith(`${authUserId}/${kind}/`)) {
    return json({ error: 'path_not_owned', detail: 'Storage path does not belong to this caller.' }, 403)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const col = COLUMN_BY_KIND[kind]
  const patch = { [col]: storagePath }

  const { data: updated, error: updErr } = await admin
    .from('fh_sub_profiles')
    .update(patch)
    .ilike('email', authEmail)
    .select('id')

  if (updErr) return json({ error: 'confirm_failed', message: updErr.message }, 500)

  return json({
    ok: true,
    updated_count: (updated || []).length,
    column: col,
    storage_path: storagePath,
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

export const config = { path: '/api/sub-doc-confirm' }
