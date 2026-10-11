import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// These checks read the local day. Pin Central time, where Jesse works,
// so the result is the same on every machine and in CI (UTC). Set it as
// the file loads too, because the fixtures build local dates before any
// hook runs.
const originalTz = process.env.TZ
process.env.TZ = 'America/Chicago'
beforeAll(() => { process.env.TZ = 'America/Chicago' })
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

import { deriveStatus, statusChip } from './quoteStatus.ts'

const NOW = new Date(2026, 9, 10, 9, 0, 0)
const DAY = 86400000

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

describe('deriveStatus', () => {
  it('reads a new quote as a draft', () => {
    expect(deriveStatus({})).toEqual({ label: 'Draft', tone: 'muted', sub: null })
  })

  it('says when a sent quote went out and when to follow up', () => {
    const status = deriveStatus({
      proposal_status: 'sent',
      quote_sent_at: new Date(NOW.getTime() - DAY).toISOString(),
      follow_up_on: '2026-10-12'
    })
    expect(status.label).toBe('Sent')
    expect(status.sub).toBe('Sent yesterday, follow up Oct 12')
  })

  it('keeps changes requested apart from the other states', () => {
    const status = deriveStatus({
      proposal_status: 'changes_requested',
      quote_change_requested_at: new Date(NOW.getTime() - 3600e3).toISOString()
    })
    expect(status).toMatchObject({ label: 'Changes requested', tone: 'danger', sub: 'Requested today' })
  })

  it('treats a job past the quote phase as approved', () => {
    expect(deriveStatus({ proposal_status: 'sent' }, true)).toMatchObject({ label: 'Approved', tone: 'good' })
  })

  it('marks an unanswered quote expired once its date passes', () => {
    const status = deriveStatus({
      proposal_status: 'sent',
      quote_expires_at: new Date(NOW.getTime() - 2 * DAY).toISOString()
    })
    expect(status.label).toBe('Expired')
  })
})

describe('statusChip', () => {
  it('gives each state a tone and keeps the word', () => {
    expect(statusChip({ label: 'Draft' })).toEqual({ label: 'Draft', tone: 'neutral' })
    expect(statusChip({ label: 'Sent' })).toEqual({ label: 'Sent', tone: 'neutral' })
    expect(statusChip({ label: 'Viewed' })).toEqual({ label: 'Viewed', tone: 'info' })
    expect(statusChip({ label: 'Changes requested' })).toEqual({ label: 'Changes requested', tone: 'info' })
    expect(statusChip({ label: 'Approved' })).toEqual({ label: 'Approved', tone: 'success' })
    expect(statusChip({ label: 'Expired' })).toEqual({ label: 'Expired', tone: 'neutral' })
  })

  it('never uses red for a quote', () => {
    for (const label of ['Draft', 'Sent', 'Viewed', 'Changes requested', 'Approved', 'Expired', 'Rejected']) {
      expect(statusChip({ label }).tone).not.toBe('danger')
    }
  })
})
