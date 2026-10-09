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
import { hashIdentifier, checkRateLimit } from './lib/rateLimit.js'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
// Ceiling on a single response. The app's largest ask is ~2048 tokens
// (doc intelligence); 8192 leaves headroom while capping abuse cost.
const MAX_TOKENS_CEILING = 8192

// Input caps. The per user rate limit bounds how many requests run; these
// bound what one request can cost. Before them a signed in account could
// send megabytes of filler in `system` on every allowed request. Every
// caller in src/ sends a short prompt (a few thousand characters), and the
// vision helpers send one photo compressed to about 1.2 MB (1.6 MB of
// base64), which the body cap leaves room for.
export const INPUT_LIMITS = {
  bodyChars: 4_000_000,
  textChars: 60_000,
  imageBlocks: 2,
}

/**
 * Size of a request's prompt: characters of text in `system` and every
 * message, plus the number of image blocks. Image data is not counted as
 * text (an image's token cost is bounded by its size cap, so the count is
 * what matters); any other block type counts by its JSON length.
 */
export function measureClaudeInput({ system, messages }) {
  let textChars = 0
  let imageBlocks = 0
  const add = (content) => {
    if (content == null) return
    if (typeof content === 'string') {
      textChars += content.length
      return
    }
    if (!Array.isArray(content)) {
      textChars += JSON.stringify(content).length
      return
    }
    for (const block of content) {
      if (block?.type === 'image') imageBlocks += 1
      else if (block?.type === 'text' && typeof block.text === 'string') textChars += block.text.length
      else textChars += JSON.stringify(block ?? null).length
    }
  }
  add(system)
  for (const message of Array.isArray(messages) ? messages : []) add(message?.content)
  return { textChars, imageBlocks }
}

/**
 * How the proxy treats a model, keyed on the family prefix rather than
 * exact ids, so pointing ANTHROPIC_MODEL at another Claude 5 model (for
 * example claude-fable-5-1 or claude-opus-5-5) keeps the same handling.
 *   isClaude5:       every Claude 5 model rejects a non default
 *                    temperature with a 400, so it is never forwarded
 *   disableThinking: claude-sonnet-5 only, as before. Other Claude 5
 *                    models keep thinking on (Sonnet 5.5 rejects thinking
 *                    disabled, and Fable, Mythos and Opus 5.5 cannot turn
 *                    it off at all)
 *   thinkingOn:      thinking stays on and shares max_tokens with the
 *                    answer, so small budgets are floored and effort is
 *                    pinned low unless the caller asks otherwise
 */
export function claudeModelTraits(model) {
  const id = String(model || '')
  const isClaude5 = /^claude-(fable|mythos|opus|sonnet|haiku)-5(-|$)/.test(id)
  const disableThinking = id === 'claude-sonnet-5'
  return { isClaude5, disableThinking, thinkingOn: isClaude5 && !disableThinking }
}

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

  // Per-user rate limit. A valid token otherwise lets one signed-in user
  // drain the shared Anthropic budget with an unbounded request loop. Key on
  // the authenticated user id (hashed) so the cap is per-account, not per-IP.
  const rlOk = await checkRateLimit(supabase, {
    scope: 'claude', identifier: hashIdentifier(authData.user.id), limit: 60,
  })
  if (!rlOk) {
    return json({ error: 'rate_limited', message: 'Too many requests. Please try again in a minute.' }, 429)
  }

  // Read the raw text first so an oversized body is refused before it is
  // parsed (see INPUT_LIMITS).
  let rawBody
  try {
    rawBody = await request.text()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  if (rawBody.length > INPUT_LIMITS.bodyChars) {
    return json({ error: 'payload_too_large', message: 'This request is too large for the assistant.' }, 413)
  }
  let body
  try {
    body = JSON.parse(rawBody)
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
  const inputSize = measureClaudeInput({ system, messages })
  if (inputSize.textChars > INPUT_LIMITS.textChars || inputSize.imageBlocks > INPUT_LIMITS.imageBlocks) {
    return json({ error: 'payload_too_large', message: 'This request is too large for the assistant.' }, 413)
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
  const traits = claudeModelTraits(safeModel)

  // Claude 5 models with thinking on (Fable 5 always thinks) spend
  // thinking tokens from the max_tokens budget. Our callers ask for small
  // caps (some as low as 120) sized for a no thinking model, which starves
  // the actual answer and truncates the JSON. Floor the budget so thinking
  // and output both have room. (Still bounded by MAX_TOKENS_CEILING.)
  const THINKING_MIN_TOKENS = 1200
  const requested = Math.max(1, Number(max_tokens) || 1024)
  const floored = traits.thinkingOn ? Math.max(requested, THINKING_MIN_TOKENS) : requested
  const cappedMaxTokens = Math.min(floored, MAX_TOKENS_CEILING)

  const payload = { model: safeModel, max_tokens: cappedMaxTokens, messages }
  if (system) payload.system = system

  // Claude 5 family API differences (vs the 4.x models this proxy was
  // written for), applied by family through claudeModelTraits:
  //   * Claude 5 models reject non default sampling params with a 400,
  //     so temperature is never forwarded to them.
  //   * Where thinking stays on, depth (and therefore latency and token
  //     spend) is controlled via output_config.effort. These are short,
  //     latency sensitive utility calls, so default to LOW effort unless
  //     the caller asks otherwise; low effort keeps us inside the client
  //     timeout.
  //   * claude-sonnet-5 (allowlisted fallback) runs adaptive thinking when
  //     `thinking` is omitted; disable it there for the same latency reason.
  if (typeof temperature === 'number' && !traits.isClaude5) payload.temperature = temperature
  if (traits.disableThinking) payload.thinking = { type: 'disabled' }
  const EFFORTS = new Set(['low', 'medium', 'high'])
  if (traits.thinkingOn) {
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
