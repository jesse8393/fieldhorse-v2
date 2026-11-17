import { describe, expect, it, vi } from 'vitest'
const readResult = vi.hoisted(() => ({ value: { data: [] as unknown[], error: null as null | { code?: string; message?: string } }, reads: 0 }))
vi.mock('./supabase.ts', () => {
  const query: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'lt', 'or', 'order']) query[method] = () => query
  query.range = async () => { readResult.reads += 1; return readResult.value }
  return { supabase: { from: () => query } }
})
import { CrewAssignmentUnavailableError, fetchAllocationEvents, allocationConflicts, allocationWriteError, canAllocateCrew, eventAssignees, forgetMissingCrewColumns } from './scheduleAllocation.ts'

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
  it('tells a database without the crew columns apart from a read that failed', async () => {
    forgetMissingCrewColumns()
    readResult.value = { data: [], error: { code: '42703', message: 'column fh_schedule.assigned_user_ids does not exist' } }
    await expect(fetchAllocationEvents('org-1', [visit])).rejects.toBeInstanceOf(CrewAssignmentUnavailableError)
    forgetMissingCrewColumns()
    readResult.value = { data: [], error: { code: '57014', message: 'upstream request timeout' } }
    const failed = await fetchAllocationEvents('org-1', [visit]).catch((error) => error)
    expect(failed).toBeInstanceOf(Error)
    expect(failed).not.toBeInstanceOf(CrewAssignmentUnavailableError)
  })
  // Production lacks the crew columns until 20261027170430 is applied.
  // Every date or time change on a visit read again and logged a 400
  // (vibe audit console-3); one answer is enough for the session.
  for (const [what, error] of [
    ['42703', { code: '42703', message: 'column fh_schedule.assigned_user_ids does not exist' }],
    ['PGRST204', { code: 'PGRST204', message: "Could not find the 'assigned_user_ids' column of 'fh_schedule' in the schema cache" }],
    ['a 400 that names the column', { message: 'column fh_schedule.assigned_user_ids does not exist' }]
  ] as const) {
    it(`asks a database without the crew columns once per session (${what})`, async () => {
      forgetMissingCrewColumns()
      readResult.reads = 0
      readResult.value = { data: [], error }
      for (const day of ['2026-12-01', '2026-12-02', '2026-12-03']) {
        await expect(fetchAllocationEvents('org-1', [{ start_at: `${day}T14:00:00Z`, end_at: `${day}T15:00:00Z` }])).rejects.toBeInstanceOf(CrewAssignmentUnavailableError)
      }
      expect(readResult.reads).toBe(1)
    })
  }
  it('keeps reading availability when the crew columns exist', async () => {
    forgetMissingCrewColumns()
    readResult.reads = 0
    readResult.value = { data: [event], error: null }
    expect(await fetchAllocationEvents('org-1', [visit])).toEqual([event])
    expect(await fetchAllocationEvents('org-1', [visit])).toEqual([event])
    expect(readResult.reads).toBe(2)
  })
  it('asks again after a read that failed for another reason', async () => {
    forgetMissingCrewColumns()
    readResult.reads = 0
    readResult.value = { data: [], error: { code: '57014', message: 'upstream request timeout' } }
    await expect(fetchAllocationEvents('org-1', [visit])).rejects.not.toBeInstanceOf(CrewAssignmentUnavailableError)
    await expect(fetchAllocationEvents('org-1', [visit])).rejects.not.toBeInstanceOf(CrewAssignmentUnavailableError)
    expect(readResult.reads).toBe(2)
  })
})
