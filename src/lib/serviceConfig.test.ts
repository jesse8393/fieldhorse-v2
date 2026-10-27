import { describe, expect, it } from 'vitest'
import { serviceReadiness, supabaseServiceConfig } from '../../netlify/functions/lib/serviceConfig.js'

describe('server service configuration', () => {
  it('accepts current server and public key names without exporting secrets', () => {
    const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'public-value', SUPABASE_SECRET_KEY: 'private-value', ANTHROPIC_API_KEY: 'ai-value' }
    expect(supabaseServiceConfig(env)).toEqual({ url: env.SUPABASE_URL, publicKey: 'public-value', secretKey: 'private-value' })
    const summary = serviceReadiness(env)
    expect(summary.teamReady).toBe(true)
    expect(summary.aiReady).toBe(true)
    expect(JSON.stringify(summary)).not.toMatch(/private-value|ai-value|public-value/)
  })
  it('keeps legacy environments working', () => {
    expect(supabaseServiceConfig({ VITE_SUPABASE_URL: 'url', VITE_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' })).toEqual({ url: 'url', publicKey: 'anon', secretKey: 'service' })
  })
  it('never accepts a browser-prefixed secret', () => {
    expect(supabaseServiceConfig({ VITE_SUPABASE_SECRET_KEY: 'leaked', VITE_SUPABASE_SERVICE_ROLE_KEY: 'leaked' }).secretKey).toBe('')
  })
  it('treats whitespace as missing and checks each service independently', () => {
    expect(serviceReadiness({ SUPABASE_URL: 'url', SUPABASE_SECRET_KEY: 'key', ANTHROPIC_API_KEY: ' ' })).toMatchObject({ teamReady: false, aiReady: false, serverAccess: true, authentication: false })
  })
})
