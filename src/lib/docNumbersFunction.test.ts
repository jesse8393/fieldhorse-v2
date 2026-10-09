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
