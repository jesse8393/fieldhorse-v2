// Netlify Function — Sub-side doc upload URL.
// POST /api/sub-doc-upload-url  { kind, filename, content_type }
// Authorization: Bearer <supabase access token>
//
// Returns a one-shot signed upload URL into the private sub-docs
// bucket. Path scheme:
//
//   sub-docs/<authUserId>/<kind>/<timestamp>-<randomSuffix>.<ext>
//
// authUserId in the path is the privacy-clean key — not the email,
// not the sub_profile.id (which differs per GC). The caller's
// browser performs the upload itself with the signed URL, then
// confirms via /api/sub-doc-confirm to write the resulting storage
// path into fh_sub_profiles.{coi_path | w9_path | license_path}.
//
// We do NOT update the DB here so a failed upload doesn't leave a
// dangling path on the profile.

import { createClient } from '@supabase/supabase-js'
import { boundSubOrgIds, SUB_DOC_TYPES } from './lib/subAccess.js'

const VALID_KINDS = ['coi', 'w9', 'license']
const MAX_FILENAME = 80

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
  const filename = String(body?.filename || '').trim().slice(0, MAX_FILENAME)
  const contentType = String(body?.content_type || 'application/pdf').trim().toLowerCase()

  if (!VALID_KINDS.includes(kind)) return json({ error: 'invalid_kind' }, 400)
  if (!filename) return json({ error: 'missing_filename' }, 400)
  // The bucket only accepts these types (migration 063); reject others here
  // with a clear message instead of a failed upload.
  if (!SUB_DOC_TYPES[contentType]) {
    return json({ error: 'unsupported_type', detail: 'Upload a PDF, JPG or PNG file.' }, 400)
  }

  // Verify caller.
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

  // Only subs linked to a contractor through an accepted job invite can
  // store documents (see lib/subAccess.js).
  const { orgIds, error: scopeErr } = await boundSubOrgIds(admin, authUserId)
  if (scopeErr) {
    console.error('[sub-doc-upload-url] scope lookup failed', scopeErr)
    return json({ error: 'scope_lookup_failed', detail: 'Could not load your contractors. Try again shortly.' }, 500)
  }
  if (orgIds.length === 0) {
    return json({ error: 'no_linked_contractor', detail: 'Accept a job invite from your contractor first, then upload documents.' }, 403)
  }

  // Build a privacy clean path. The extension follows the checked type.
  const ext = SUB_DOC_TYPES[contentType]
  const ts = Date.now()
  const rand = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
  const storagePath = `${authUserId}/${kind}/${ts}-${rand}.${ext}`

  const { data: signed, error: signErr } = await admin.storage
    .from('sub-docs')
    .createSignedUploadUrl(storagePath)

  if (signErr || !signed) {
    console.error('[sub-doc-upload-url] signing failed', signErr)
    return json({ error: 'sign_failed', detail: 'Could not start the upload. Try again shortly.' }, 500)
  }

  return json({
    ok: true,
    bucket: 'sub-docs',
    storage_path: storagePath,
    signed_url: signed.signedUrl,
    token: signed.token,
    content_type: contentType,
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

export const config = { path: '/api/sub-doc-upload-url' }
