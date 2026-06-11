// mobile/lib/anthropic.ts — Claude API client for the native app.
//
// Mirrors the web src/lib/anthropic.ts, but native has no same-origin
// "/api/claude", so we post to the deployed Netlify function over an
// absolute URL. The function keeps the Anthropic key server-side and
// sets CORS, so the anon mobile client can call it directly.
//
// Base URL is configurable via EXPO_PUBLIC_API_BASE_URL (defaults to the
// production site). The model matches the web default.
import { supabase } from './supabase'

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL as string) || 'https://fieldhorse.io'
const MODEL = (process.env.EXPO_PUBLIC_ANTHROPIC_MODEL as string) || 'claude-sonnet-4-6'
const REQUEST_TIMEOUT_MS = 20000

type ClaudeMessage = { role: string; content: unknown }

// /api/claude requires the signed-in user's Supabase access token.
async function authHeaders(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

export async function claudeMessage({ system, messages, maxTokens = 1024 }: { system?: string; messages: ClaudeMessage[]; maxTokens?: number }) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${API_BASE}/api/claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ model: MODEL, system, messages, max_tokens: maxTokens }),
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`Claude request failed: ${res.status}`)
    return await res.json()
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new Error('Claude request timed out')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

// Pull the first text block out of a Claude messages response.
export function claudeText(res: any): string {
  return res?.content?.[0]?.text || ''
}

// Vision call: send one base64 image + a prompt. Accepts a data-URL or raw
// base64; strips the data-URL header and infers the media type.
export async function claudeVision({ system, prompt, imageData, mediaType, maxTokens = 1024 }: {
  system?: string; prompt: string; imageData: string; mediaType?: string; maxTokens?: number
}) {
  let base64 = imageData
  let type = mediaType
  if (imageData.startsWith('data:')) {
    const [header, payload] = imageData.split(',', 2)
    base64 = payload
    if (!type) {
      const m = header.match(/^data:([^;]+);/)
      type = m ? m[1] : 'image/jpeg'
    }
  }
  if (!type) type = 'image/jpeg'
  return claudeMessage({
    system,
    maxTokens,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: type, data: base64 } },
        { type: 'text', text: prompt }
      ]
    }]
  })
}
