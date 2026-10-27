import { describe, expect, it } from 'vitest'
import { partnerHasStatus, summarizePartnerShares } from './partnerView.ts'
import type { PartnerEntry, PartnerJob } from './partners.ts'

const partner = (email: string, statuses: string[]): PartnerEntry => ({
  email, name: '', role: '', status: statuses[0], lastInvitedAt: null,
  jobs: statuses.map((status, index) => ({ id: `job-${index}`, partnerId: `${email}-${index}`, status } as PartnerJob))
})

describe('partner and share counts', () => {
  it('counts an accepted partner with pending jobs in the pending filter exactly once', () => {
    const mixed = partner('one@example.com', ['accepted', 'pending', 'pending'])
    expect(partnerHasStatus(mixed, 'pending')).toBe(true)
    expect(summarizePartnerShares([mixed])).toMatchObject({ all: 1, accepted: 1, pending: 1, pendingShares: 2, acceptedShares: 1 })
  })

  it('keeps revoked shares separate from accepted access and explains overlapping partner filters', () => {
    const rows = [partner('one@example.com', ['accepted', 'revoked']), partner('two@example.com', ['revoked'])]
    expect(summarizePartnerShares(rows)).toEqual({ all: 2, accepted: 1, pending: 0, revoked: 2, pendingShares: 0, acceptedShares: 1, revokedShares: 2, totalShares: 3 })
  })
})

import { partnerAccessSummary } from './partnerView.ts'

describe('partner permission explanations', () => {
  it('shows client and money access honestly instead of claiming it is hidden', () => {
    const access = partnerAccessSummary('accepted', 'Foreman')
    expect(access.included).toContain('linked customer details')
    expect(access.included).toContain('pricing, invoices, payments')
    expect(access.role).toContain('same sharing permissions')
  })
  it('does not imply pending, revoked, declined or removed shares grant access', () => {
    expect(partnerAccessSummary('pending').status).toContain('No access until')
    expect(partnerAccessSummary('revoked').status).toContain('no longer grants')
    expect(partnerAccessSummary('declined').status).toContain('no job access')
    expect(partnerAccessSummary('left').status).toContain('no longer grants')
  })
})
