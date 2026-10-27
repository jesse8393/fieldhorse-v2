import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const getUser = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ auth: { getUser } })) }))
import handler from '../../netlify/functions/claude.js'

beforeEach(() => {
  for (const name of ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'ANTHROPIC_API_KEY']) vi.stubEnv(name, '')
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('AI configuration readiness', () => {
  it('requires a valid signed in caller', async () => {
    const result = await handler(new Request('https://app.example/api/claude'))
    expect(result.status).toBe(401)
    expect(getUser).not.toHaveBeenCalled()
  })
  it('reports unavailable provider setup without returning credentials', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'public-key')
    const response = await handler(new Request('https://app.example/api/claude', { headers: { authorization: 'Bearer jwt' } }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ configured: false })
  })
  it('checks configuration without invoking the AI provider', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('SUPABASE_SECRET_KEY', 'private-key')
    vi.stubEnv('ANTHROPIC_API_KEY', 'provider-key')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const response = await handler(new Request('https://app.example/api/claude', { headers: { authorization: 'Bearer jwt' } }))
    expect(await response.json()).toEqual({ configured: true })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it('rejects expired sessions', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'public-key')
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } })
    const response = await handler(new Request('https://app.example/api/claude', { headers: { authorization: 'Bearer expired' } }))
    expect(response.status).toBe(401)
  })
})
