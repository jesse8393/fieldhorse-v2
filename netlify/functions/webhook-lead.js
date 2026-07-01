// Netlify Function — inbound lead webhook.
// External tools (GoHighLevel, Zapier, Make, Facebook Lead Ads) POST JSON here.
// We validate the ?key= against fh_profiles.webhook_key, then insert a row
// into fh_contacts with stage='lead'.
//
// ENV required:
//   SUPABASE_URL       (e.g. https://pnmhblvslftdzfcdezbw.supabase.co)
//   SUPABASE_SERVICE_ROLE_KEY  (service-role, server-only)

import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { sendPushToUser } from './lib/push.js'

const REQUIRED_FIELDS = ['name']
const MAX_BODY_BYTES = 64 * 1024
const RATE_LIMIT_WINDOW_SECONDS = 60
const DEFAULT_RATE_LIMIT_PER_MINUTE = 60

export function getWebhookRateLimitPerMinute(value = process.env.WEBHOOK_LEAD_RATE_LIMIT_PER_MINUTE) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RATE_LIMIT_PER_MINUTE
  return Math.max(1, Math.min(1000, Math.floor(parsed)))
}

export function fingerprintWebhookKey(key) {
  return createHash('sha256').update(String(key)).digest('hex')
}

export function getWebhookRateBucketStart(now = new Date(), windowSeconds = RATE_LIMIT_WINDOW_SECONDS) {
  const bucketMs = Math.max(1, windowSeconds) * 1000
  return new Date(Math.floor(now.getTime() / bucketMs) * bucketMs).toISOString()
}

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  const url = new URL(request.url)
  const key = url.searchParams.get('key')
  if (!key || key.length < 16) {
    return json({ error: 'missing_key' }, 401)
  }

  const supaUrl = process.env.SUPABASE_URL
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supaUrl || !supaKey) {
    return json({ error: 'server_misconfigured' }, 500)
  }

  let rawBody
  try {
    rawBody = await request.text()
    const bodyBytes = new TextEncoder().encode(rawBody).length
    if (bodyBytes > MAX_BODY_BYTES) {
      return json({ error: 'payload_too_large', detail: 'Lead payload limit is 64 KB.' }, 413)
    }
  } catch {
    return json({ error: 'body_read_failed' }, 400)
  }

  const supabase = createClient(supaUrl, supaKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  // Look up the owner + org before parsing JSON so malformed bursts
  // from a valid source still count against the durable rate limit.
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('user_id, org_id')
    .eq('webhook_key', key)
    .maybeSingle()
  if (profileErr) {
    return json({ error: 'profile_lookup_failed' }, 502)
  }
  if (!profile) {
    return json({ error: 'invalid_key' }, 401)
  }
  const userId = profile.user_id
  const orgId = profile.org_id || null

  const rateLimit = await checkWebhookRateLimit(supabase, { userId, orgId, key })
  if (!rateLimit.allowed) {
    return json(
      {
        error: 'rate_limited',
        detail: `Webhook rate limit is ${rateLimit.limit} requests per minute.`
      },
      429,
      { 'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS) }
    )
  }

  let payload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  for (const f of REQUIRED_FIELDS) {
    if (!payload[f] || String(payload[f]).trim() === '') {
      return json({ error: `missing_field:${f}` }, 400)
    }
  }

  // Sanitize and shape the contact row
  const row = {
    user_id: userId,
    org_id: orgId,
    name: String(payload.name).trim().slice(0, 200),
    phone: payload.phone ? String(payload.phone).trim().slice(0, 40) : null,
    email: payload.email ? String(payload.email).trim().slice(0, 200) : null,
    address: payload.address ? String(payload.address).trim().slice(0, 400) : null,
    job_title: payload.job_title ? String(payload.job_title).trim().slice(0, 240) : null,
    job_type: payload.job_type ? String(payload.job_type).trim().slice(0, 120) : null,
    amount: Number.isFinite(Number(payload.amount)) ? Number(payload.amount) : 0,
    notes: payload.notes ? String(payload.notes).slice(0, 2000) : null,
    stage: 'lead',
    source: payload.source ? String(payload.source).slice(0, 80) : 'webhook'
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('fh_contacts')
    .insert(row)
    .select('id')
  if (insertErr) {
    return json({ error: 'insert_failed', detail: insertErr.message }, 502)
  }
  const newId = inserted[0]?.id

  // Bell + lock screen: a new lead is the most time-sensitive event in
  // the app — speed-to-call decides whether it converts. Best effort.
  try {
    await supabase.from('fh_notifications').insert({
      user_id: userId,
      org_id: orgId,
      kind: 'new_lead',
      title: `New lead · ${row.name}`,
      body: [row.job_title, row.phone].filter(Boolean).join(' · ') || 'Tap to view',
      link: newId ? `/leads/${newId}` : '/leads'
    })
    await sendPushToUser(supabase, userId, {
      title: `New lead · ${row.name}`,
      body: [row.job_title, row.phone].filter(Boolean).join(' · ') || 'Tap to view',
      link: newId ? `/leads/${newId}` : '/leads',
      tag: `new-lead-${newId || row.name}`
    })
  } catch (e) {
    console.warn('[webhook-lead] notify failed', e)
  }

  return json({ ok: true, id: newId, stage: 'lead' }, 200)
}

async function checkWebhookRateLimit(supabase, { userId, orgId, key }) {
  const limit = getWebhookRateLimitPerMinute()
  const { data, error } = await supabase.rpc('fh_increment_webhook_rate_limit', {
    p_user_id: userId,
    p_org_id: orgId,
    p_key_hash: fingerprintWebhookKey(key),
    p_bucket_start: getWebhookRateBucketStart(),
    p_limit: limit,
    p_window_seconds: RATE_LIMIT_WINDOW_SECONDS
  })
  if (error) {
    console.warn('[webhook-lead] rate limit unavailable', error)
    return { allowed: true, degraded: true, limit, count: 0 }
  }

  const row = Array.isArray(data) ? data[0] : data
  return {
    allowed: row?.allowed !== false,
    limit,
    count: Number(row?.request_count || 0)
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(), ...extraHeaders }
  })
}

export const config = { path: '/api/webhook-lead' }
