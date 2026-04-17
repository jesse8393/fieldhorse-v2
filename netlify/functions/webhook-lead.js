// Netlify Function — inbound lead webhook.
// External tools (GoHighLevel, Zapier, Make, Facebook Lead Ads) POST JSON here.
// We validate the ?key= against fh_profiles.webhook_key, then insert a row
// into fh_contacts with stage='lead'.
//
// ENV required:
//   SUPABASE_URL       (e.g. https://pnmhblvslftdzfcdezbw.supabase.co)
//   SUPABASE_SERVICE_ROLE_KEY  (service-role, server-only)

const REQUIRED_FIELDS = ['name']

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

  let payload
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  for (const f of REQUIRED_FIELDS) {
    if (!payload[f] || String(payload[f]).trim() === '') {
      return json({ error: `missing_field:${f}` }, 400)
    }
  }

  // Look up the user_id that owns this webhook key
  const profileRes = await fetch(
    `${supaUrl}/rest/v1/profiles?select=user_id&webhook_key=eq.${encodeURIComponent(key)}&limit=1`,
    {
      headers: {
        apikey: supaKey,
        Authorization: `Bearer ${supaKey}`,
        'Accept': 'application/json'
      }
    }
  )
  if (!profileRes.ok) {
    return json({ error: 'profile_lookup_failed' }, 502)
  }
  const profiles = await profileRes.json()
  if (!Array.isArray(profiles) || profiles.length === 0) {
    return json({ error: 'invalid_key' }, 401)
  }
  const userId = profiles[0].user_id

  // Sanitize and shape the contact row
  const row = {
    user_id: userId,
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

  const insertRes = await fetch(
    `${supaUrl}/rest/v1/fh_contacts`,
    {
      method: 'POST',
      headers: {
        apikey: supaKey,
        Authorization: `Bearer ${supaKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(row)
    }
  )

  if (!insertRes.ok) {
    const msg = await insertRes.text()
    return json({ error: 'insert_failed', detail: msg }, 502)
  }
  const inserted = await insertRes.json()
  return json({ ok: true, id: inserted[0]?.id, stage: 'lead' }, 200)
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  })
}

export const config = { path: '/api/webhook-lead' }
