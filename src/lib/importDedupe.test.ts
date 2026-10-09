import { describe, it, expect } from 'vitest'
import { leadKeys, markRepeats } from './importDedupe.ts'

function keysOf(rows: Parameters<typeof leadKeys>[0][]) {
  return new Set(rows.flatMap(leadKeys))
}

describe('markRepeats', () => {
  const existing = keysOf([
    { name: 'Jane Doe', phone: '(615) 555-0101', email: 'Jane@Example.com', job_title: 'Kitchen remodel' },
    { name: 'Bob Smith', phone: null, email: null, job_title: null }
  ])

  it('flags the same lead from a second run of the same export', () => {
    expect(markRepeats([
      { name: 'Jane Doe', phone: '615.555.0101', email: 'jane@example.com', job_title: 'Kitchen remodel' }
    ], existing)).toEqual([true])
  })

  it('matches on email or phone even when the name is written differently', () => {
    expect(markRepeats([
      { name: 'Doe, Jane', email: ' JANE@example.com ', job_title: 'kitchen  remodel' },
      { name: 'J. Doe', phone: '+1 615 555 0101', job_title: 'Kitchen remodel' }
    ], existing)).toEqual([true, true])
  })

  it('lets a second job for the same client through', () => {
    expect(markRepeats([
      { name: 'Jane Doe', phone: '6155550101', email: 'jane@example.com', job_title: 'Deck build' }
    ], existing)).toEqual([false])
  })

  it('matches name only rows on name and title', () => {
    expect(markRepeats([
      { name: 'bob smith' },
      { name: 'Bob Smith', job_title: 'Fence' },
      { name: 'Carol King' }
    ], existing)).toEqual([true, false, false])
  })

  it('flags nothing when nothing is on file', () => {
    expect(markRepeats([{ name: 'Jane Doe' }], new Set())).toEqual([false])
  })
})

describe('leadKeys', () => {
  it('ignores phone numbers too short to identify anyone', () => {
    expect(leadKeys({ name: 'A', phone: '123' })).toEqual(['n:a|'])
  })
})
