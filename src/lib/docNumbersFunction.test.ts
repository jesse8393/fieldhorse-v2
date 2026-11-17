import { describe, expect, it } from 'vitest'
import { proposalNumber as serverProposalNumber } from '../../netlify/functions/lib/docNumbers.js'
import { proposalNumber } from '../components/documents/numbers.ts'

describe('server proposal numbers match the printed document', () => {
  const cases: Array<[string | null, string, string | null]> = [
    ['Parker Construction Company', '1c23aae1-3e08-4039-a716-473eac09ae3d', '2026-03-04T10:00:00Z'],
    ['The House of Tile & Stone', 'abcd-1234', '2025-12-15'],
    ['X', 'deadbeef', null],
    [null, 'c368bbb4-5ea1-4b51-89f0-4c91fdfd4de0', '2026-01-02T08:00:00Z'],
  ]
  for (const [name, seed, issued] of cases) {
    it(`agrees for ${name ?? 'no company'}`, () => {
      expect(serverProposalNumber(name, seed, issued)).toBe(proposalNumber(name, seed, issued))
    })
  }

  it('never prints the app name when the company is unknown', () => {
    expect(serverProposalNumber(null, 'abcd1234', '2026-05-01T12:00:00Z')).toBe('PROPOSAL-2026-1234')
  })
})

// FN-19: the approval record keeps the number printed on the proposal. The
// page and the PDF take the year from the created date first
// (proposalIssuedAt), so a quote written in December and sent in January
// is PC-2026-..., and the record must say the same.
describe('the approval snapshot numbers the proposal as it was printed', async () => {
  const { buildQuoteSnapshot } = await import('../../netlify/functions/lib/quoteApproval.js')
  const { proposalIssuedAt } = await import('./proposalDate.ts')
  const quote = { id: 'quote-0001-te-1', title: 'Driveway', created_at: '2026-12-20T16:00:00Z', sent_at: '2027-01-05T16:00:00Z' }

  it('uses the created date first, as the page and the PDF do', () => {
    const snapshot = buildQuoteSnapshot({
      quote, client: null, company: { name: 'Parker Concrete' },
      snap: { items: [], baseTotal: 0, optionalTotal: 0, excludedCount: 0 }, takenAt: '2027-01-06T00:00:00Z'
    })
    expect(snapshot.quote_number).toBe(proposalNumber('Parker Concrete', quote.id, proposalIssuedAt(quote)))
    expect(snapshot.quote_number).toBe('PC-2026-TE-1')
  })
})
