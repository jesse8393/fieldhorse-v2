// Claude API client. Calls route through serverless function in production
// so the key never ships to the browser. Local dev can hit the edge route too.

const MODEL = import.meta.env.VITE_ANTHROPIC_MODEL || 'claude-sonnet-4-20250514'

export async function claudeMessage({ system, messages, maxTokens = 1024 }) {
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, system, messages, max_tokens: maxTokens })
  })
  if (!res.ok) throw new Error(`Claude request failed: ${res.status}`)
  return res.json()
}
