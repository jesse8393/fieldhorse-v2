// Netlify Function — Sub-side profile update.
// POST /api/sub-profile-update  { fields: {...} }
// Authorization: Bearer <supabase access token>
//
// Updates the sub-side-editable fields on EVERY fh_sub_profiles row
// whose email matches the caller. A sub working for three GCs sees
// the same self-updated insurance info on all three records.
//
// Fields the SUB controls:
//   phone, address, ein, trades (array),
//   insurance_carrier, insurance_policy, insurance_expires_on,
//   license_number,
//   payment_handle, payment_method, notes
//
// Fields the OWNER controls (NOT writable here):
//   name, company, email, coi_path, w9_path, license_path
//   (storage paths are managed via /api/sub-doc-confirm)

import { createClient } from '@supabase/supabase-js'

const ALLOWED = [
  'phone', 'address', 'ein', 'trades',
  'insurance_carrier', 'insurance_policy', 'insurance_expires_on',
  'license_number',
  'payment_handle', 'payment_method',
  'notes',
]

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
  const fields = (body && typeof body.fields === 'object') ? body.fields : null
  if (!fields) return json({ error: 'missing_fields' }, 400)

  // Whitelist + sanitize.
  const patch = {}
  for (const key of ALLOWED) {
    if (!(key in fields)) continue
    let v = fields[key]
    if (typeof v === 'string') v = v.trim()
    if (v === '') v = null
    // Date guard: keep YYYY-MM-DD only.
    if (key === 'insurance_expires_on' && v !== null) {
      const d = new Date(v)
      if (!Number.isFinite(d.getTime())) {
        return json({ error: 'invalid_expires', detail: 'insurance_expires_on must be a valid date.' }, 400)
      }
      v = d.toISOString().slice(0, 10)
    }
    // Trades guard: array of strings only.
    if (key === 'trades' && v !== null) {
      if (!Array.isArray(v)) return json({ error: 'invalid_trades' }, 400)
      v = v.map((x) => String(x || '').trim()).filter(Boolean)
    }
    patch[key] = v
  }
  if (Object.keys(patch).length === 0) {
    return json({ error: 'no_writable_fields' }, 400)
  }

  // Verify caller + grab their email.
  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${bearer}` } }
  })
  const { data: userData, error: authErr } = await authClient.auth.getUser(bearer)
  if (authErr || !userData?.user) return json({ error: 'invalid_token' }, 401)
  const authEmail = String(userData.user.email || '').toLowerCase()
  if (!authEmail) return json({ error: 'no_auth_email' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // Update all matching rows.
  // Exact (case-insensitive) match, NOT .ilike: authEmail is caller-controlled
  // and LIKE metacharacters (`_`, `%`) in their own address would match OTHER
  // subs' rows and let them overwrite foreign profiles. authEmail is already
  // lowercased above and sub emails are stored lowercased, so .eq is both
  // correct and wildcard-safe.
  const { data: updated, error: updErr } = await admin
    .from('fh_sub_profiles')
    .update(patch)
    .eq('email', authEmail)
    .select('id')

  if (updErr) return json({ error: 'update_failed', message: updErr.message }, 500)

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
