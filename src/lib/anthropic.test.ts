import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase.ts', () => ({ authHeaders: async () => ({ Authorization: 'Bearer test-session' }) }))
const { claudeMessage } = await import('./anthropic.ts')

afterEach(() => vi.unstubAllGlobals())

describe('AI client error contract', () => {
  it('preserves status and machine code without exposing server instructions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'missing_api_key', message: 'private deployment instructions' }), { status: 500 })))
    await expect(claudeMessage({ messages: [] })).rejects.toMatchObject({ status: 500, code: 'missing_api_key', message: 'AI request failed: 500' })
  })

  it('keeps text output after nontext response blocks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'thinking', thinking: 'internal' }, { type: 'text', text: 'See you tomorrow.' }] }), { status: 200 })))
    await expect(claudeMessage({ messages: [] })).resolves.toMatchObject({ content: [{ type: 'text', text: 'See you tomorrow.' }] })
  })
})
