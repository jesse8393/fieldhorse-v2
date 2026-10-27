import { describe, expect, it, vi } from 'vitest'
vi.mock('./supabase.ts', () => ({ supabase: {} }))
import { allocationConflicts, allocationWriteError, canAllocateCrew, eventAssignees } from './scheduleAllocation.ts'

const visit = { start_at: '2026-10-28T13:00:00Z', end_at: '2026-10-28T14:00:00Z' }
const event = { id: 'event-1', title: 'Foundation', ...visit, assigned_to: 'alice' }

describe('crew allocation', () => {
  it('combines legacy and multiple assignees without duplicates', () => {
    expect(eventAssignees({ assigned_to: 'alice', assigned_user_ids: ['bob', 'alice'] })).toEqual(['bob', 'alice'])
    expect(eventAssignees(null)).toEqual([])
  })
  it('limits crew planning to management roles', () => {
    for (const role of ['owner', 'admin', 'manager']) expect(canAllocateCrew(role)).toBe(true)
    for (const role of ['crew', 'foreman', 'sub', '', null, undefined]) expect(canAllocateCrew(role)).toBe(false)
  })
  it('finds each overlapping assigned member and excludes unrelated crew', () => {
    const result = allocationConflicts([visit], ['alice', 'bob'], [{ ...event, assigned_user_ids: ['bob'] }, { ...event, id: 'other', assigned_to: 'charlie' }])
    expect(result.map((conflict) => conflict.userId)).toEqual(['bob', 'alice'])
    expect(result.every((conflict) => conflict.eventId === 'event-1')).toBe(true)
  })
  it('permits adjacent visits and editing the same event', () => {
    expect(allocationConflicts([{ start_at: visit.end_at, end_at: '2026-10-28T15:00:00Z' }], ['alice'], [event])).toEqual([])
    expect(allocationConflicts([visit], ['alice'], [event], 'event-1')).toEqual([])
  })
  it('detects a long visit spanning the selected date and missing legacy end times', () => {
    expect(allocationConflicts([visit], ['alice'], [{ ...event, start_at: '2026-10-27T13:00:00Z', end_at: '2026-10-29T14:00:00Z' }])).toHaveLength(1)
    expect(allocationConflicts([visit], ['alice'], [{ ...event, end_at: null }])).toHaveLength(1)
  })
  it('checks later recurring dates and conflicts within a proposed series', () => {
    const second = { start_at: '2026-11-04T14:00:00Z', end_at: '2026-11-04T15:00:00Z' }
    expect(allocationConflicts([visit, second], ['alice'], [{ ...event, ...second }])[0].occurrence).toBe(1)
    const overlapping = allocationConflicts([visit, { ...visit, start_at: '2026-10-28T13:30:00Z' }], ['alice', 'bob'], [])
    expect(overlapping).toHaveLength(2)
    expect(overlapping[0]).toMatchObject({ title: 'Visit 1 in this series', occurrence: 1, eventId: '' })
  })
  it('turns the database concurrent booking rejection into recovery guidance', () => {
    expect(allocationWriteError({ code: '23P01', message: 'private constraint details' })).toContain('Refresh availability')
    expect(allocationWriteError({ message: 'schedule_allocation_permission' })).toContain('owner, admin or manager')
    expect(allocationWriteError({ message: 'schedule_allocation_member' })).toContain('no longer belongs')
  })
})
