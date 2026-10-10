import { describe, expect, it } from 'vitest'
import { RAIL_SEGMENTS, railStage, segmentStatus } from './stageRail.ts'

// One case per row of the stage rule table in spec section 7.
describe('railStage', () => {
  it('lead is the Lead segment', () => {
    expect(railStage({ stage: 'lead', completed_at: null })).toEqual({ current: 'lead', currentIndex: 0, lost: false })
  })

  it('quote is the Quote segment', () => {
    expect(railStage({ stage: 'quote', completed_at: null })).toEqual({ current: 'quote', currentIndex: 1, lost: false })
  })

  it('job with no completed_at is the Job segment', () => {
    expect(railStage({ stage: 'job', completed_at: null })).toEqual({ current: 'job', currentIndex: 2, lost: false })
    expect(railStage({ stage: 'job' })).toEqual({ current: 'job', currentIndex: 2, lost: false })
    expect(railStage({ stage: 'job', completed_at: '' })).toEqual({ current: 'job', currentIndex: 2, lost: false })
  })

  it('invoice is a legacy alias of job: no completed_at is the Job segment', () => {
    expect(railStage({ stage: 'invoice', completed_at: null })).toEqual({ current: 'job', currentIndex: 2, lost: false })
    expect(railStage({ stage: 'invoice' })).toEqual({ current: 'job', currentIndex: 2, lost: false })
  })

  it('job with completed_at set (work done, money out) is the Invoice segment', () => {
    expect(railStage({ stage: 'job', completed_at: '2026-10-08T17:20:00Z' })).toEqual({ current: 'invoice', currentIndex: 3, lost: false })
    expect(railStage({ stage: 'job', completed_at: new Date('2026-10-08T17:20:00Z') })).toEqual({ current: 'invoice', currentIndex: 3, lost: false })
  })

  it('invoice with completed_at set is the Invoice segment', () => {
    expect(railStage({ stage: 'invoice', completed_at: '2026-10-08' })).toEqual({ current: 'invoice', currentIndex: 3, lost: false })
  })

  it('closed is the Closed segment', () => {
    expect(railStage({ stage: 'closed', completed_at: '2026-10-08' })).toEqual({ current: 'closed', currentIndex: 4, lost: false })
    expect(railStage({ stage: 'closed', completed_at: null })).toEqual({ current: 'closed', currentIndex: 4, lost: false })
  })

  it('lost has no current segment and asks for the Lost chip', () => {
    expect(railStage({ stage: 'lost', completed_at: null })).toEqual({ current: null, currentIndex: -1, lost: true })
    expect(railStage({ stage: 'lost', completed_at: '2026-10-08' })).toEqual({ current: null, currentIndex: -1, lost: true })
  })

  it('completed_at only matters for job and invoice', () => {
    expect(railStage({ stage: 'lead', completed_at: '2026-10-08' }).current).toBe('lead')
    expect(railStage({ stage: 'quote', completed_at: '2026-10-08' }).current).toBe('quote')
  })

  it('reads the stage without regard to case or stray spaces', () => {
    expect(railStage({ stage: ' Job ', completed_at: null }).current).toBe('job')
    expect(railStage({ stage: 'LOST' }).lost).toBe(true)
  })

  it('an unknown or missing stage claims no segment and no chip', () => {
    for (const stage of [null, undefined, '', 'archived']) {
      expect(railStage({ stage, completed_at: null })).toEqual({ current: null, currentIndex: -1, lost: false })
    }
  })

  it('an invalid date does not count as completed', () => {
    expect(railStage({ stage: 'job', completed_at: new Date('not a date') }).current).toBe('job')
  })
})

describe('segmentStatus', () => {
  it('marks segments before the current one done and after it future', () => {
    const state = railStage({ stage: 'job', completed_at: null })
    expect(RAIL_SEGMENTS.map((_, i) => segmentStatus(state, i))).toEqual(['done', 'done', 'current', 'future', 'future'])
  })

  it('marks every segment done but Closed when the record is closed', () => {
    const state = railStage({ stage: 'closed' })
    expect(RAIL_SEGMENTS.map((_, i) => segmentStatus(state, i))).toEqual(['done', 'done', 'done', 'done', 'current'])
  })

  it('draws a lost record with every segment in the future', () => {
    const state = railStage({ stage: 'lost' })
    expect(RAIL_SEGMENTS.map((_, i) => segmentStatus(state, i))).toEqual(['future', 'future', 'future', 'future', 'future'])
  })
})
