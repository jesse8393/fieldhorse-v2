import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import handler, {
  fingerprintWebhookKey,
  getWebhookRateBucketStart,
  getWebhookRateLimitPerMinute
} from '../../netlify/functions/webhook-lead.js'

const OLD_ENV = { ...process.env }

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key'
})

afterEach(() => {
  process.env = { ...OLD_ENV }
})

describe('webhook-lead function guards', () => {
  it('normalizes webhook rate-limit configuration', () => {
    expect(getWebhookRateLimitPerMinute(undefined)).toBe(60)
    expect(getWebhookRateLimitPerMinute('15')).toBe(15)
    expect(getWebhookRateLimitPerMinute('-4')).toBe(60)
    expect(getWebhookRateLimitPerMinute('5000')).toBe(1000)
  })

  it('hashes webhook keys without exposing the raw secret', () => {
    const hash = fingerprintWebhookKey('super-secret-webhook-key')
    expect(hash).toHaveLength(64)
    expect(hash).not.toContain('super-secret')
    expect(hash).toBe(fingerprintWebhookKey('super-secret-webhook-key'))
  })

  it('rounds rate-limit buckets to the configured window', () => {
    const bucket = getWebhookRateBucketStart(new Date('2026-06-18T12:34:56.789Z'), 60)
    expect(bucket).toBe('2026-06-18T12:34:00.000Z')
  })

  it('rejects oversized lead payloads before parsing or inserting', async () => {
    const request = new Request(`https://fieldhorse.test/api/webhook-lead?key=${'a'.repeat(16)}`, {
      method: 'POST',
      body: JSON.stringify({ name: 'A'.repeat(70 * 1024) }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await handler(request)
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error).toBe('payload_too_large')
  })
})
