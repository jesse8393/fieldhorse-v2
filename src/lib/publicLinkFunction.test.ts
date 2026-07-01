import { describe, expect, it } from 'vitest'
import {
  buildPublicLinkViewEvent,
  getPublicLinkClientIp,
  hashPublicLinkIp
} from '../../netlify/functions/public-link.js'

describe('public-link function audit helpers', () => {
  it('prefers the first forwarded client IP', () => {
    const req = new Request('https://fieldhorse.test/api/public-link?token=abc', {
      headers: {
        'x-forwarded-for': '203.0.113.10, 198.51.100.2',
        'x-real-ip': '198.51.100.3'
      }
    })

    expect(getPublicLinkClientIp(req)).toBe('203.0.113.10')
  })

  it('hashes IP addresses with a salt', () => {
    const hash = hashPublicLinkIp('203.0.113.10', 'test-salt')

    expect(hash).toHaveLength(64)
    expect(hash).toBe(hashPublicLinkIp('203.0.113.10', 'test-salt'))
    expect(hash).not.toBe(hashPublicLinkIp('203.0.113.10', 'other-salt'))
  })

  it('builds an RPC payload without raw IP addresses', () => {
    const req = new Request('https://fieldhorse.test/api/public-link?token=abc', {
      headers: {
        'user-agent': 'Mozilla/'.padEnd(700, 'x'),
        referer: 'https://client.example/proposal',
        'x-forwarded-for': '203.0.113.10',
        'x-nf-request-id': 'req_123'
      }
    })

    const event = buildPublicLinkViewEvent(
      req,
      {
        id: 'link-id',
        org_id: null,
        user_id: 'user-id',
        contact_id: 'contact-id',
        kind: 'proposal',
        change_order_id: null
      },
      { org_id: 'org-id' },
      'test-salt'
    )

    expect(event.p_public_link_id).toBe('link-id')
    expect(event.p_org_id).toBe('org-id')
    expect(event.p_user_agent).toHaveLength(500)
    expect(event.p_referer).toBe('https://client.example/proposal')
    expect(event.p_ip_hash).toHaveLength(64)
    expect(event.p_ip_hash).not.toContain('203.0.113.10')
    expect(event.p_metadata.request_id).toBe('req_123')
  })
})
