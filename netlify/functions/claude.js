// Netlify Function — Claude API proxy.
// Keeps the Anthropic API key server-side. Browser hits /api/claude
// which is redirected here via netlify.toml.
//
// ENV required: ANTHROPIC_API_KEY (set in Netlify dashboard)
// Optional: ANTHROPIC_MODEL (defaults to claude-sonnet-4-20250514)

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

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

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const {
    model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    system,
    messages,
    max_tokens = 1024,
    temperature
  } = body || {}

  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: 'messages_required' }, 400)
  }

  const payload = { model, max_tokens, messages }
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
    'Access-Control-Allow-Headers': 'Content-Type'
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  })
}

export const config = { path: '/api/claude' }
