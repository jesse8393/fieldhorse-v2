import { describe, expect, it } from 'vitest'
import {
  buildQuoteTrackingPatch,
  normalizeFollowUpOn,
} from '../../netlify/functions/send-quote.js'

describe('send quote follow up validation', () => {
  const now = new Date('2026-07-31T12:00:00.000Z')

  it('accepts a nearby real calendar date', () => {
    expect(normalizeFollowUpOn('2026-08-03', now)).toBe('2026-08-03')
  })

  it('rejects malformed and impossible dates', () => {
    expect(normalizeFollowUpOn('08/03/2026', now)).toBeNull()
    expect(normalizeFollowUpOn('2026-02-30', now)).toBeNull()
  })

  it('rejects dates outside the reminder window', () => {
    expect(normalizeFollowUpOn('2027-01-01', now)).toBeNull()
    expect(normalizeFollowUpOn('2026-07-20', now)).toBeNull()
  })

  it('clears a prior reminder when the sender explicitly disables it', () => {
    expect(buildQuoteTrackingPatch({
      stage: 'quote',
      proposalStatus: 'sent',
      sentAtIso: now.toISOString(),
      followUpProvided: true,
      followUpOn: null,
    })).toMatchObject({
      contactPatch: { proposal_status: 'sent', follow_up_on: null },
      scheduledFollowUpOn: null,
    })
  })

  it('keeps old clients backward compatible and does not alter job reminders', () => {
    const legacy = buildQuoteTrackingPatch({
      stage: 'quote',
      proposalStatus: 'sent',
      sentAtIso: now.toISOString(),
      followUpProvided: false,
      followUpOn: null,
    })
    expect(legacy.contactPatch).not.toHaveProperty('follow_up_on')

    const locked = buildQuoteTrackingPatch({
      stage: 'job',
      proposalStatus: 'approved',
      sentAtIso: now.toISOString(),
      followUpProvided: true,
      followUpOn: '2026-08-03',
    })
    expect(locked.contactPatch).not.toHaveProperty('follow_up_on')
  })
})
