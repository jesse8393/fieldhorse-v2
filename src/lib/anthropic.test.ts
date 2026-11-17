import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase.ts', () => ({ authHeaders: async () => ({ Authorization: 'Bearer test-session' }) }))
const { claudeMessage, claudeVision } = await import('./anthropic.ts')

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

describe('an answer with nothing in it', () => {
  it('throws a plain error when the model declines', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ stop_reason: 'refusal', content: [] }), { status: 200 })))
    await expect(claudeMessage({ messages: [] })).rejects.toMatchObject({ code: 'refusal', message: expect.stringMatching(/could not answer/) })
  })

  it('throws a plain error when no text came back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }] }), { status: 200 })))
    await expect(claudeMessage({ messages: [] })).rejects.toMatchObject({ code: 'empty_answer' })
  })

  it('does the same for a photo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ stop_reason: 'refusal', content: [] }), { status: 200 })))
    await expect(claudeVision({ prompt: 'Read this', imageData: 'data:image/jpeg;base64,AAAA' })).rejects.toMatchObject({ code: 'refusal' })
  })
})
