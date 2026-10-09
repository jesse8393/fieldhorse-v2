import { describe, expect, it, vi } from 'vitest'
import { checkRateLimit, hashIdentifier, isLimiterMissing } from '../../netlify/functions/lib/rateLimit.js'

function clientReturning(result: { data?: unknown; error?: unknown }) {
  return { rpc: vi.fn(async () => result) } as any
}

describe('rate limiter failure policy', () => {
  it('recognises a missing RPC or table as a configuration failure', () => {
    expect(isLimiterMissing({ code: 'PGRST202', message: 'Could not find the function public.fh_increment_rate_limit' })).toBe(true)
    expect(isLimiterMissing({ code: '42883', message: 'function does not exist' })).toBe(true)
    expect(isLimiterMissing({ code: '42P01', message: 'relation "fh_rate_limits" does not exist' })).toBe(true)
    expect(isLimiterMissing({ message: 'Could not find the function public.fh_increment_rate_limit(p_scope) in the schema cache' })).toBe(true)
    expect(isLimiterMissing({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(false)
    expect(isLimiterMissing(null)).toBe(false)
  })

  it('fails closed when the limiter is not installed', async () => {
    const supabase = clientReturning({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ok = await checkRateLimit(supabase, { scope: 'public-link', identifier: 'x', limit: 10 })
    expect(ok).toBe(false)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('fails open on a transient RPC error', async () => {
    const supabase = clientReturning({ data: null, error: { code: '57014', message: 'statement timeout' } })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ok = await checkRateLimit(supabase, { scope: 'public-link', identifier: 'x', limit: 10 })
    expect(ok).toBe(true)
    warnSpy.mockRestore()
  })

  it('honours the allowed flag returned by the RPC', async () => {
    const allowed = clientReturning({ data: [{ request_count: 3, allowed: true }], error: null })
    const blocked = clientReturning({ data: [{ request_count: 11, allowed: false }], error: null })
    expect(await checkRateLimit(allowed, { scope: 's', identifier: 'i', limit: 10 })).toBe(true)
    expect(await checkRateLimit(blocked, { scope: 's', identifier: 'i', limit: 10 })).toBe(false)
  })

  it('passes a minute aligned bucket and the configured window to the RPC', async () => {
    const supabase = clientReturning({ data: [{ request_count: 1, allowed: true }], error: null })
    await checkRateLimit(supabase, { scope: 'claude', identifier: 'u', limit: 60, windowSeconds: 60 })
    const [fn, params] = supabase.rpc.mock.calls[0]
    expect(fn).toBe('fh_increment_rate_limit')
    expect(params.p_scope).toBe('claude')
    expect(params.p_limit).toBe(60)
    expect(params.p_window_seconds).toBe(60)
    expect(new Date(params.p_bucket_start).getSeconds()).toBe(0)
  })

  it('hashes identifiers to a fixed length without exposing the input', () => {
    const h = hashIdentifier('203.0.113.9', 'test-salt')
    expect(h).toHaveLength(40)
    expect(h).not.toContain('203.0.113')
    expect(hashIdentifier('203.0.113.9', 'test-salt')).toBe(h)
  })
})
