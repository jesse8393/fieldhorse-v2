import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QUOTE_FOLLOW_UP_DAYS,
  mergeQuoteFollowUpPreferences,
  quoteFollowUpDate,
  readQuoteFollowUpPreferences,
} from './quoteFollowUp.ts'

describe('quote follow up preferences', () => {
  it('defaults new accounts to a reminder three calendar days later', () => {
    expect(readQuoteFollowUpPreferences(null)).toEqual({
      enabled: true,
      days: DEFAULT_QUOTE_FOLLOW_UP_DAYS,
    })
    expect(quoteFollowUpDate(null, new Date(2026, 6, 30, 23, 45))).toBe('2026-08-02')
  })

  it('preserves unrelated preferences when settings change', () => {
    expect(mergeQuoteFollowUpPreferences(
      { compact_mode: true, quote_follow_up: { channel: 'manual' } },
      { enabled: false, days: 7 },
    )).toEqual({
      compact_mode: true,
      quote_follow_up: { channel: 'manual', enabled: false, days: 7 },
    })
  })

  it('returns no reminder when the setting is off', () => {
    const preferences = { quote_follow_up: { enabled: false, days: 5 } }
    expect(quoteFollowUpDate(preferences, new Date(2026, 0, 10))).toBeNull()
  })

  it('rejects invalid saved delays and uses the safe default', () => {
    expect(readQuoteFollowUpPreferences({ quote_follow_up: { enabled: true, days: 365 } })).toEqual({
      enabled: true,
      days: DEFAULT_QUOTE_FOLLOW_UP_DAYS,
    })
    expect(readQuoteFollowUpPreferences({ quote_follow_up: { enabled: true, days: 4 } }).days)
      .toBe(DEFAULT_QUOTE_FOLLOW_UP_DAYS)
  })
})
