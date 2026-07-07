// Claude API client. Calls route through serverless function in production
// so the key never ships to the browser. Local dev can hit the edge route too.
// /api/claude requires a signed-in Supabase session (Bearer token).

import { authHeaders } from './supabase.ts'

const MODEL = (import.meta as any).env?.VITE_ANTHROPIC_MODEL || 'claude-fable-5'

// Hard ceiling so a stuck /api/claude call never leaves the UI in an
// indefinite "parsing…" or "drafting…" state. Fable 5 runs adaptive
// thinking on every turn (it can't be disabled), so a turn takes longer
// than the old Sonnet path — 30s gives it room without letting a truly
// stuck call hang the UI. The proxy pins these utility calls to LOW
// effort so they stay well inside this budget.
const REQUEST_TIMEOUT_MS = 30000

type ClaudeMessage = { role: string; content: unknown }

// Claude 5 responses can lead with thinking blocks before the text block,
// so `content[0].text` — the read every consumer does — comes back
// undefined. Normalize here (drop non-text blocks) so consumers keep
// their simple `content[0].text` reads and heal in one place.
function normalizeResponse(data: any) {
  if (Array.isArray(data?.content)) {
    data.content = data.content.filter((b: any) => b?.type === 'text')
  }
  return data
}

export async function claudeMessage({ system, messages, maxTokens = 1024, model, effort }: { system?: string; messages: ClaudeMessage[]; maxTokens?: number; model?: string; effort?: 'low' | 'medium' | 'high' }) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ model: model || MODEL, system, messages, max_tokens: maxTokens, effort }),
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`Claude request failed: ${res.status}`)
    return normalizeResponse(await res.json())
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new Error('Claude request timed out (15s)')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * claudeVision — multimodal call. Sends one image + a text prompt.
 *
 *   imageData: data URL (data:image/jpeg;base64,...) OR raw base64 string
 *              with an explicit mediaType.
 *   mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
 *              (defaults to image/jpeg if data URL doesn't carry one)
 *
 * Returns the same shape as claudeMessage — { content: [{ text }, ...], ... }
 */
export async function claudeVision({ system, prompt, imageData, mediaType, maxTokens = 1024 }: { system?: string; prompt: string; imageData: string; mediaType?: string; maxTokens?: number }) {
  // Accept data-URL or raw base64. Strip the data-URL header if present
  // and pull the media type from it when not provided explicitly.
  let base64 = imageData
  let type = mediaType
  if (typeof imageData === 'string' && imageData.startsWith('data:')) {
    const [header, payload] = imageData.split(',', 2)
    base64 = payload
    if (!type) {
      const m = header.match(/^data:([^;]+);/)
      type = m ? m[1] : 'image/jpeg'
    }
  }
  if (!type) type = 'image/jpeg'

  const messages = [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: type, data: base64 } },
      { type: 'text', text: prompt }
    ]
  }]

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ model: MODEL, system, messages, max_tokens: maxTokens }),
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`Claude vision request failed: ${res.status}`)
    return normalizeResponse(await res.json())
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new Error('Claude vision request timed out (15s)')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

// Pull the first JSON object out of a Claude response body. Vision responses
// often include preamble; this finds the first {...} balanced block.
export function extractJson(text: string | null | undefined) {
  if (!text) return null
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try { return JSON.parse(match[0]) } catch { return null }
}
