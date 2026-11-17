// Netlify Function: error reports from the browser.
// POST /api/client-error  { route, build, message, kind }
//
// The app sends one of these when a screen crashes (either error
// boundary), when an error or a rejected promise goes uncaught, and when a
// query or a save fails. Each report becomes one structured log line in
// the Netlify function log; nothing is stored. The fields are trimmed and
// capped and lose record ids, link tokens, emails, phone numbers and
// amounts (src/lib/errorReport.js), so the log never holds customer data.
// Public, so it is rate limited per client IP like the other public
// endpoints.

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { supabaseServiceConfig } from './lib/serviceConfig.js'
import { clientIp, hashIdentifier, checkRateLimit } from './lib/rateLimit.js'
import { cleanErrorReport } from '../../src/lib/errorReport.js'

const MAX_BODY = 4096

export function createHandler({ env = process.env, createClient = createSupabaseClient } = {}) {
  return async (request) => {
    if (request.method !== 'POST') return status(405)
    if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return status(413)
    const raw = await request.text()
    if (raw.length > MAX_BODY) return status(413)
    let body
    try { body = JSON.parse(raw) } catch { return status(400) }

    const { url, secretKey } = supabaseServiceConfig(env)
    if (!url || !secretKey) return status(500)
    const admin = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const allowed = await checkRateLimit(admin, {
      scope: 'client-error',
      identifier: hashIdentifier(clientIp(request)),
      limit: 20
    })
    if (!allowed) return status(429)

    console.error(JSON.stringify({ at: 'client-error', ...cleanErrorReport(body) }))
    return status(204)
  }
}

function status(code) {
  return new Response(null, { status: code })
}

export default createHandler()

export const config = { path: '/api/client-error' }
