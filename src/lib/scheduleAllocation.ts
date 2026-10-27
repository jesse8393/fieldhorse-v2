import { supabase } from './supabase.ts'

export type AllocationEvent = {
  id: string; title?: string | null; start_at: string | null; end_at: string | null
  assigned_to?: string | null; assigned_user_ids?: string[] | null
}
export type VisitWindow = { start_at: string; end_at: string }
export type AllocationConflict = { userId: string; eventId: string; title: string; start_at: string; end_at: string; occurrence: number }

export function eventAssignees(event: Pick<AllocationEvent, 'assigned_to' | 'assigned_user_ids'> | null): string[] {
  return [...new Set([...(event?.assigned_user_ids || []), ...(event?.assigned_to ? [event.assigned_to] : [])])]
}

export function canAllocateCrew(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager'
}

export function allocationConflicts(visits: VisitWindow[], userIds: string[], events: AllocationEvent[], editingId?: string): AllocationConflict[] {
  const result: AllocationConflict[] = []
  visits.forEach((visit, occurrence) => {
    const from = Date.parse(visit.start_at)
    const to = Date.parse(visit.end_at)
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return
    for (const event of events) {
      if (event.id === editingId || !event.start_at) continue
      const start = Date.parse(event.start_at)
      const end = event.end_at ? Date.parse(event.end_at) : start + 60 * 60_000
      if (!(from < end && to > start)) continue
      for (const userId of eventAssignees(event).filter((id) => userIds.includes(id))) {
        result.push({ userId, eventId: event.id, title: event.title || 'Scheduled event', start_at: event.start_at, end_at: new Date(end).toISOString(), occurrence })
      }
    }
    // Catch overlapping occurrences in the proposed series before writing any row.
    visits.slice(0, occurrence).forEach((other, index) => {
      if (from < Date.parse(other.end_at) && to > Date.parse(other.start_at)) {
        userIds.forEach((userId) => result.push({ userId, eventId: '', title: `Visit ${index + 1} in this series`, ...other, occurrence }))
      }
    })
  })
  return result
}

/** Read every relevant event, including long visits that start before this range. */
export async function fetchAllocationEvents(orgId: string, visits: VisitWindow[]): Promise<AllocationEvent[]> {
  if (!visits.length) return []
  const from = visits.reduce((a, v) => a < v.start_at ? a : v.start_at, visits[0].start_at)
  const to = visits.reduce((a, v) => a > v.end_at ? a : v.end_at, visits[0].end_at)
  const rows: AllocationEvent[] = []
  const pageSize = 500
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('fh_schedule')
      .select('id,title,start_at,end_at,assigned_to,assigned_user_ids')
      .eq('org_id', orgId).lt('start_at', to)
      .or(`end_at.gt.${from},end_at.is.null`)
      .order('start_at', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error('Crew availability could not be checked. Try again before assigning anyone.')
    const page = (data ?? []) as AllocationEvent[]
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

export function allocationWriteError(error: { code?: string; message?: string }): string {
  if (error.code === '40P01' || error.code === '40001') return 'Another schedule change happened at the same time. Refresh availability and try again.'
  if (error.code === '23P01' || error.message?.includes('schedule_allocation_conflict')) return 'Someone was booked during this visit. Refresh availability and choose another time or crew.'
  if (error.message?.includes('schedule_allocation_permission')) return 'Only an owner, admin or manager can change crew assignments or move an assigned visit.'
  if (error.message?.includes('schedule_allocation_member')) return 'A selected crew member no longer belongs to this company. Refresh the roster.'
  return 'The event could not be saved. Refresh the schedule and try again.'
}
