import { describe, expect, it } from 'vitest'
import { proposalIssuedAt } from './proposalDate.ts'

describe('stable proposal issue date', () => {
  it('does not change when a draft is first sent or sent again', () => {
    const created = '2026-10-01T12:00:00Z'
    expect(proposalIssuedAt({ created_at: created })).toBe(created)
    expect(proposalIssuedAt({ created_at: created, sent_at: '2026-10-20T12:00:00Z' })).toBe(created)
    expect(proposalIssuedAt({ created_at: created, quote_sent_at: '2026-10-27T12:00:00Z' })).toBe(created)
  })
  it('supports legacy records and skips invalid dates', () => {
    expect(proposalIssuedAt({ quote_sent_at: '2026-10-20' })).toBe('2026-10-20')
    expect(proposalIssuedAt({ created_at: 'bad', sent_at: '2026-10-20' })).toBe('2026-10-20')
    expect(proposalIssuedAt({ created_at: 'bad' })).toBeNull()
  })
})
