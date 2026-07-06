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
// Optional: ANTHROPIC_MODEL (defaults to claude-fable-5)

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
    model = process.env.ANTHROPIC_MODEL || 'claude-fable-5',
    system,
    messages,
    max_tokens = 1024,
    temperature,
    effort
  } = body || {}

  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: 'messages_required' }, 400)
  }
  if (messages.length > 50) {
    return json({ error: 'too_many_messages', limit: 50 }, 400)
  }

  // Model allow-list. `model` is caller-supplied; without this a signed-in
  // user could point the shared API key at any (e.g. more expensive) model.
  // Anything off-list falls back to the configured default rather than
  // erroring, so a benign unknown id degrades instead of breaking.
  const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-fable-5'
  const ALLOWED_MODELS = new Set([
    'claude-fable-5',
    'claude-sonnet-5',
    'claude-haiku-4-5-20251001',
    DEFAULT_MODEL
  ])
  const safeModel = ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL

  // Fable 5 runs adaptive thinking on EVERY turn, and thinking tokens share
  // the max_tokens budget. Our callers ask for small caps (some as low as
  // 120) sized for a no-thinking model — on Fable that starves the actual
  // answer and truncates the JSON. Floor the budget so thinking + output
  // both have room. (Still bounded by MAX_TOKENS_CEILING.)
  const FABLE_MIN_TOKENS = 1200
  const requested = Math.max(1, Number(max_tokens) || 1024)
  const floored = safeModel === 'claude-fable-5' ? Math.max(requested, FABLE_MIN_TOKENS) : requested
  const cappedMaxTokens = Math.min(floored, MAX_TOKENS_CEILING)

  const payload = { model: safeModel, max_tokens: cappedMaxTokens, messages }
  if (system) payload.system = system

  // Claude 5 family API differences (vs the 4.x models this proxy was
  // written for):
  //   - sonnet-5 / fable-5 reject non-default sampling params with a 400
  //     → never forward temperature to them.
  //   - fable-5 thinking is always on and cannot be disabled; depth (and
  //     therefore latency + token spend) is controlled via
  //     output_config.effort. These are short, latency-sensitive utility
  //     calls, so default to LOW effort unless the caller asks otherwise —
  //     low-effort Fable still beats prior models and keeps us inside the
  //     client timeout.
  //   - sonnet-5 (allowlisted fallback) runs adaptive thinking when
  //     `thinking` is omitted; disable it there for the same latency reason.
  const isClaude5 = safeModel === 'claude-sonnet-5' || safeModel === 'claude-fable-5'
  if (typeof temperature === 'number' && !isClaude5) payload.temperature = temperature
  if (safeModel === 'claude-sonnet-5') payload.thinking = { type: 'disabled' }
  const EFFORTS = new Set(['low', 'medium', 'high'])
  if (safeModel === 'claude-fable-5') {
    payload.output_config = { effort: EFFORTS.has(effort) ? effort : 'low' }
  }

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
