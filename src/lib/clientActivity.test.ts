import { describe, expect, it } from 'vitest'
import { clientActivity } from './clientActivity.ts'

const now = Date.parse('2026-10-30T17:00:00Z')
const day = 24 * 60 * 60 * 1000

describe('customer activity evidence', () => {
  it.each([undefined, null, '', ' ', 'invalid', 0, '1970-01-01T00:00:00Z', '2026-11-01T17:00:00Z'])(
    'does not invent recency or follow up needs from %s', value => {
      expect(clientActivity(value, now)).toEqual({ state: 'unknown', lastTouch: null })
    })

  it('keeps an activity exactly 30 days old inside the recent window', () => {
    const lastTouch = now - 30 * day
    expect(clientActivity(new Date(lastTouch).toISOString(), now)).toEqual({ state: 'recent', lastTouch })
  })

  it('identifies recorded activity older than 30 days', () => {
    const lastTouch = now - 30 * day - 1
    expect(clientActivity(new Date(lastTouch).toISOString(), now)).toEqual({ state: 'stale', lastTouch })
  })

  it('compares equivalent timezone representations consistently', () => {
    expect(clientActivity('2026-10-30T12:00:00-05:00', now)).toEqual({ state: 'recent', lastTouch: now })
  })
})
