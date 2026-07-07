// Shared fixed-window rate limiter for public (unauthenticated) edge
// endpoints, backed by the fh_increment_rate_limit RPC (migration 055).
//
// Usage:
//   import { clientIp, hashIdentifier, checkRateLimit } from './lib/rateLimit.js'
//   const ip = clientIp(req)
//   const ok = await checkRateLimit(supabase, {
//     scope: 'public-link', identifier: hashIdentifier(ip), limit: 60,
//   })
//   if (!ok) return json({ error: 'rate_limited' }, 429)
//
// Fails OPEN: if the limiter RPC errors, we allow the request (a limiter
// outage must not take down a customer's ability to view/pay a link) and
// log server-side so the failure is visible.

import crypto from 'node:crypto'

export function clientIp(req) {
  // Prefer Netlify's platform-set client IP. x-forwarded-for is
  // client-controllable — its FIRST token is whatever the caller sent
  // (proxies append, they don't prepend), so trusting it lets an
  // attacker rotate a fresh identifier per request and never trip the
  // fixed-window limit. Only fall back to XFF when the platform header
  // is absent (non-Netlify runtime / local dev).
  return (
    req.headers.get('x-nf-client-connection-ip') ||
    req.headers.get('x-real-ip') ||
    req.headers.get('client-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  )
}

export function hashIdentifier(value, salt = process.env.PUBLIC_LINK_AUDIT_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || 'fieldhorse-rate-limit') {
  return crypto.createHmac('sha256', salt).update(String(value || 'unknown')).digest('hex').slice(0, 40)
}

export async function checkRateLimit(supabase, { scope, identifier, limit = 60, windowSeconds = 60 }) {
  try {
    const nowMs = Date.now()
    const bucketMs = Math.floor(nowMs / (windowSeconds * 1000)) * windowSeconds * 1000
    const bucketStart = new Date(bucketMs).toISOString()
    const { data, error } = await supabase.rpc('fh_increment_rate_limit', {
      p_scope: scope,
      p_identifier: identifier,
      p_bucket_start: bucketStart,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    })
    if (error) {
      console.warn('[rateLimit] RPC error — failing open', { scope, message: error.message })
      return true
    }
    // rpc returns table(request_count, allowed); supabase-js gives an array.
    const row = Array.isArray(data) ? data[0] : data
    return row ? !!row.allowed : true
  } catch (e) {
    console.warn('[rateLimit] threw — failing open', { scope, message: e?.message })
    return true
  }
}
