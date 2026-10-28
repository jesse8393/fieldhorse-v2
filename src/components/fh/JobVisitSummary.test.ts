import { describe, expect, it } from 'vitest'
import { nextJobVisit } from './JobVisitSummary.tsx'
const now = Date.parse('2026-10-28T12:00:00Z')
describe('job visit summary', () => {
  it('keeps an ongoing visit before later visits and ignores completed or invalid dates', () => {
    const visits = [
      { id: 'later', start_at: '2026-10-29T12:00:00Z' },
      { id: 'finished', start_at: '2026-10-28T08:00:00Z', end_at: '2026-10-28T10:00:00Z' },
      { id: 'invalid', start_at: 'unknown' },
      { id: 'ongoing', start_at: '2026-10-28T11:00:00Z', end_at: '2026-10-28T13:00:00Z' }
    ]
    expect(nextJobVisit(visits, now)?.id).toBe('ongoing')
    expect(visits[0].id).toBe('later')
  })
  it('shows the empty state after all scheduled visits end', () => {
    expect(nextJobVisit([{ start_at: '2026-10-28T08:00:00Z' }], now)).toBeUndefined()
  })
})
