// Netlify Function — inbound lead webhook.
// External tools (GoHighLevel, Zapier, Make, Facebook Lead Ads) POST JSON here.
// We validate the ?key= against profiles.webhook_key, find the company from
// the key owner's active membership, resolve the client (fh_resolve_client
// matches by phone or email inside the company, else makes one) and insert
// a row into fh_leads pointing at it (SPEC D53).
//
// Senders retry. A delivery that names itself (the Idempotency-Key header or
// an external_id field) always lands on the lead first made with that name.
// One that does not is treated as a repeat when an identical open lead (same
// client, title and source) was made in the last 10 minutes.
//
// ENV required:
//   SUPABASE_URL       (e.g. https://pnmhblvslftdzfcdezbw.supabase.co)
//   SUPABASE_SERVICE_ROLE_KEY  (service-role, server-only)

import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { sendPushToUser } from './lib/push.js'
import { logError, requestId } from './lib/logError.js'

const REQUIRED_FIELDS = ['name']
const MAX_BODY_BYTES = 64 * 1024
const RATE_LIMIT_WINDOW_SECONDS = 60
const DEFAULT_RATE_LIMIT_PER_MINUTE = 60
const REPEAT_WINDOW_MS = 10 * 60 * 1000
const MAX_IDEMPOTENCY_KEY_LENGTH = 200

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

export default async (request, context) => {
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

  // The company comes from the key owner's active membership, never from
  // profiles.org_id alone: nothing keeps that column current, so it can be
  // empty for a real member or still name a company the person was removed
  // from.
  const { data: memberRows, error: memberErr } = await supabase
    .from('org_members')
    .select('org_id, joined_at')
    .eq('user_id', userId)
    .is('revoked_at', null)
  if (memberErr) {
    console.error('[webhook-lead] membership lookup failed', memberErr)
    return json({ error: 'membership_lookup_failed' }, 502)
  }
  const orgId = pickWebhookOrgId(memberRows, profile.org_id)

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

  if (!orgId) {
    return json({
      error: 'no_company',
      detail: 'This webhook key is not linked to an active company, so the lead was not saved.'
    }, 409)
  }

  let payload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  // `null`, arrays, strings and numbers are valid JSON but not a lead; the
  // field loop below used to throw a TypeError (500) on `null`.
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return json({ error: 'invalid_payload', detail: 'Send a JSON object with at least a name.' }, 400)
  }

  for (const f of REQUIRED_FIELDS) {
    if (!payload[f] || String(payload[f]).trim() === '') {
      return json({ error: `missing_field:${f}` }, 400)
    }
  }

  // Sanitize and shape the two rows: who (the client) and what (the lead).
  const person = {
    name: String(payload.name).trim().slice(0, 200),
    phone: payload.phone ? String(payload.phone).trim().slice(0, 40) : null,
    email: payload.email ? String(payload.email).trim().slice(0, 200) : null,
    address: payload.address ? String(payload.address).trim().slice(0, 400) : null
  }
  const source = payload.source ? String(payload.source).slice(0, 80) : 'webhook'
  const amount = Number.isFinite(Number(payload.amount)) ? Math.max(0, Number(payload.amount)) : 0
  const lead = {
    user_id: userId,
    org_id: orgId,
    title: payload.job_title ? String(payload.job_title).trim().slice(0, 240) : null,
    job_type: payload.job_type ? String(payload.job_type).trim().slice(0, 120) : null,
    // fh_leads has no amount column; a figure the source sent stays in the notes.
    notes: leadNotes(payload.notes, amount),
    source,
    status: 'open'
  }

  // A named delivery: the lead id is derived from the company and the name,
  // so the same name always means the same row and the primary key settles
  // two copies arriving at once. No extra column is needed.
  const idempotencyKey = readIdempotencyKey(request, payload)
  const keyedLeadId = idempotencyKey ? leadIdForIdempotencyKey(orgId, idempotencyKey) : null
  if (keyedLeadId) {
    const prior = await findLeadById(supabase, orgId, keyedLeadId)
    if (prior) return repeatResponse(prior)
  }

  const clientId = await resolveClient(supabase, { orgId, person, source })
  if (!clientId) {
    return json({ error: 'client_failed', detail: 'Could not save the customer. Try again shortly.' }, 500)
  }

  if (!keyedLeadId) {
    const prior = await findRecentIdenticalLead(supabase, { orgId, clientId, title: lead.title, source })
    if (prior) return repeatResponse(prior)
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('fh_leads')
    .insert({ ...lead, client_id: clientId, ...(keyedLeadId ? { id: keyedLeadId } : {}) })
    .select('id')
  if (insertErr) {
    // The other copy of a named delivery won the insert a moment ago.
    if (keyedLeadId && insertErr.code === '23505') {
      const prior = await findLeadById(supabase, orgId, keyedLeadId)
      if (prior) return repeatResponse(prior)
    }
    logError('webhook-lead', 'insert failed', insertErr, { org_id: orgId, request_id: requestId(request) })
    return json({ error: 'insert_failed', detail: 'Could not save the lead. Try again shortly.' }, 500)
  }
  const newId = inserted[0]?.id

  // Bell + lock screen: a new lead is the most time-sensitive event in
  // the app, speed to call decides whether it converts. Best effort.
  const body = [lead.title, person.phone].filter(Boolean).join(' · ') || 'Tap to view'
  try {
    await supabase.from('fh_notifications').insert({
      user_id: userId,
      org_id: orgId,
      kind: 'new_lead',
      title: `New lead · ${person.name}`,
      body,
      link: newId ? `/leads/${newId}` : '/leads'
    })
  } catch (e) {
    console.warn('[webhook-lead] notify failed', e)
  }
  // The sender is not kept waiting on the push services. The platform is
  // asked to let the push finish after the response has gone.
  const push = Promise.resolve()
    .then(() => sendPushToUser(supabase, userId, {
      title: `New lead · ${person.name}`,
      body,
      link: newId ? `/leads/${newId}` : '/leads',
      tag: `new-lead-${newId || person.name}`
    }, { orgId }))
    .then(() => undefined)
    .catch((e) => { console.warn('[webhook-lead] push failed', e) })
  if (typeof context?.waitUntil === 'function') context.waitUntil(push)

  // `stage: 'lead'` stays for integrations that read it; the row is a lead.
  return json({ ok: true, id: newId, client_id: clientId, record: 'lead', stage: 'lead' }, 200)
}

// A repeated delivery answers like the first one did, with `duplicate: true`,
// and makes no new lead and no new alert.
function repeatResponse(prior) {
  return json({ ok: true, id: prior.id, client_id: prior.client_id, record: 'lead', stage: 'lead', duplicate: true }, 200)
}

/** The name a delivery gives itself: the Idempotency-Key header, else external_id in the body. */
export function readIdempotencyKey(request, payload) {
  const fromHeader = request.headers.get('idempotency-key')
  const fromBody = ['string', 'number'].includes(typeof payload?.external_id) ? payload.external_id : null
  const raw = fromHeader && fromHeader.trim() ? fromHeader : fromBody
  const key = raw == null ? '' : String(raw).trim().slice(0, MAX_IDEMPOTENCY_KEY_LENGTH)
  return key || null
}

/** A stable uuid for (company, delivery name). The same pair always gives the same lead id. */
export function leadIdForIdempotencyKey(orgId, key) {
  const hex = createHash('sha256').update(`webhook-lead:${orgId}:${key}`).digest('hex')
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

async function findLeadById(supabase, orgId, leadId) {
  const { data, error } = await supabase
    .from('fh_leads')
    .select('id, client_id')
    .eq('id', leadId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (error) {
    console.warn('[webhook-lead] repeat lookup failed', error)
    return null
  }
  return data || null
}

async function findRecentIdenticalLead(supabase, { orgId, clientId, title, source }) {
  let query = supabase
    .from('fh_leads')
    .select('id, client_id')
    .eq('org_id', orgId)
    .eq('client_id', clientId)
    .eq('status', 'open')
    .eq('source', source)
    .gte('created_at', new Date(Date.now() - REPEAT_WINDOW_MS).toISOString())
  query = title === null ? query.is('title', null) : query.eq('title', title)
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1)
  if (error) {
    console.warn('[webhook-lead] repeat lookup failed', error)
    return null
  }
  return data?.[0] || null
}

export function leadNotes(notes, amount) {
  const parts = []
  if (notes) parts.push(String(notes).slice(0, 2000))
  if (amount > 0) parts.push(`Estimated amount $${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`)
  return parts.length ? parts.join('\n') : null
}

/**
 * Which company a webhook key writes into. `memberRows` are the key owner's
 * active memberships. One membership: that company. None: null. Several: the
 * company on the profile when it is one of them, else the oldest membership.
 */
export function pickWebhookOrgId(memberRows, profileOrgId) {
  const rows = (memberRows || []).filter((m) => m?.org_id)
  if (rows.length === 0) return null
  if (rows.length === 1) return rows[0].org_id
  if (profileOrgId && rows.some((m) => m.org_id === profileOrgId)) return profileOrgId
  const joinedMs = (m) => {
    const t = new Date(m.joined_at || 0).getTime()
    return Number.isFinite(t) ? t : 0
  }
  return [...rows].sort((a, b) => joinedMs(a) - joinedMs(b))[0].org_id
}

// The client the lead belongs to: fh_resolve_client matches by phone, then
// email, then makes one, the same path the inbound text and email functions
// take.
async function resolveClient(supabase, { orgId, person, source }) {
  const { data, error } = await supabase.rpc('fh_resolve_client', {
    p_org_id: orgId,
    p_phone: person.phone,
    p_email: person.email,
    p_name: person.name,
    p_address: person.address,
    p_source: source
  })
  if (error) {
    console.error('[webhook-lead] fh_resolve_client failed', error)
    return null
  }
  const row = Array.isArray(data) ? data[0] : data
  return row?.client_id || null
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
    'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key'
  }
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(), ...extraHeaders }
  })
}

export const config = { path: '/api/webhook-lead' }
