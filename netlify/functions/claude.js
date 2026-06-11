// Netlify Function — Claude API proxy.
// Keeps the Anthropic API key server-side. Browser hits /api/claude
// which is redirected here via netlify.toml.
//
// Callers must be signed in: a Supabase access token is required in
// the Authorization header. Without it this endpoint is an open proxy
// that lets anyone on the internet spend the Anthropic API budget.
//
// ENV required: ANTHROPIC_API_KEY (set in Netlify dashboard)
//               SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (token check)
// Optional: ANTHROPIC_MODEL (defaults to claude-sonnet-4-6)

import { createClient } from '@supabase/supabase-js'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
// Ceiling on a single response. The app's largest ask is ~2048 tokens
// (doc intelligence); 8192 leaves headroom while capping abuse cost.
const MAX_TOKENS_CEILING = 8192

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders()
    })
  }

  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return json({ error: 'missing_api_key', message: 'ANTHROPIC_API_KEY is not set on the server' }, 500)
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'server_misconfigured', message: 'Server is missing Supabase credentials.' }, 500)
  }

  const authHeader = request.headers.get('authorization') || ''
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!accessToken) {
    return json({ error: 'missing_token', detail: 'Authorization: Bearer <access_token> is required.' }, 401)
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: authData, error: authErr } = await supabase.auth.getUser(accessToken)
  if (authErr || !authData?.user) {
    return json({ error: 'invalid_token' }, 401)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const {
    model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    system,
    messages,
    max_tokens = 1024,
    temperature
  } = body || {}

  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: 'messages_required' }, 400)
  }
  if (messages.length > 50) {
    return json({ error: 'too_many_messages', limit: 50 }, 400)
  }

  const cappedMaxTokens = Math.min(Math.max(1, Number(max_tokens) || 1024), MAX_TOKENS_CEILING)

  const payload = { model, max_tokens: cappedMaxTokens, messages }
  if (system) payload.system = system
  if (typeof temperature === 'number') payload.temperature = temperature

  try {
    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify(payload)
    })

    const text = await upstream.text()
    return new Response(text, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders()
      }
    })
  } catch (err) {
    return json({ error: 'upstream_failed', message: err.message || 'fetch failed' }, 502)
  }
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

export const config = { path: '/api/claude' }
