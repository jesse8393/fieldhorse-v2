// Manual follow up dates on a lead, quote or job (fh_contacts.follow_up_on,
// a yyyy-mm-dd date). The same rules Work.tsx applies to its deal cards,
// shared so the phone Job page offers the same choices: tomorrow, in 3
// days, next week, a picked date, or clear.

import type { QueryClient } from '@tanstack/react-query'
import { supabase } from './supabase.ts'
import { jobsKey } from './queries.ts'
import { toastError, toastSuccess } from './toast.ts'

export type FollowUpWhen = number | Date | null

export type FollowUpMeta = { label: string; tone: 'danger' | 'warn' | 'muted' }

/** The preset choices, as days from today. */
export const FOLLOW_UP_PRESETS: readonly { days: number; label: string }[] = [
  { days: 1, label: 'Tomorrow' },
  { days: 3, label: 'In 3 days' },
  { days: 7, label: 'Next week' }
]

// A LOCAL year month day. toISOString would write the UTC day, which
// moved "tomorrow" two days out for evening US users.
export function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * The stored value for a choice: a preset offset counts calendar days
 * from today's local midnight, a Date is taken as that local day, and
 * null clears.
 */
export function followUpOnFor(when: FollowUpWhen, today: Date = new Date()): string | null {
  if (when === null) return null
  if (when instanceof Date) return localYmd(when)
  const d = new Date(today)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + when)
  return localYmd(d)
}

/** "Follow up today", "Follow up tomorrow", "Follow up Oct 12", "Follow up 3d overdue". */
export function followUpMeta(followUpOn: string | null | undefined, today: Date = new Date()): FollowUpMeta | null {
  if (!followUpOn) return null
  const due = new Date(followUpOn + 'T00:00:00')
  if (Number.isNaN(due.getTime())) return null
  const start = new Date(today)
  start.setHours(0, 0, 0, 0)
  const diffDays = Math.round((due.getTime() - start.getTime()) / 86400000)
  if (diffDays < 0) return { label: `Follow up ${-diffDays}d overdue`, tone: 'danger' }
  if (diffDays === 0) return { label: 'Follow up today', tone: 'warn' }
  if (diffDays === 1) return { label: 'Follow up tomorrow', tone: 'muted' }
  return { label: `Follow up ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`, tone: 'muted' }
}

type CachedJob = { id: string; follow_up_on?: string | null }

function patchCaches(queryClient: QueryClient, jobId: string, userId: string | undefined, value: string | null) {
  queryClient.setQueryData(['jobDetail', jobId], (prev: any) =>
    prev?.contact ? { ...prev, contact: { ...prev.contact, follow_up_on: value } } : prev
  )
  queryClient.setQueryData(jobsKey(userId), (prev: unknown) =>
    Array.isArray(prev) ? prev.map((r: CachedJob) => (r?.id === jobId ? { ...r, follow_up_on: value } : r)) : prev
  )
}

/**
 * Set or clear a follow up: writes fh_contacts.follow_up_on, updates the
 * job detail and jobs list caches right away, says so in a toast, and
 * puts the old date back if the write fails.
 */
export async function saveFollowUp(
  queryClient: QueryClient,
  job: { id: string; name?: string | null; follow_up_on?: string | null },
  userId: string | undefined,
  when: FollowUpWhen
): Promise<{ error: { message: string } | null }> {
  const value = followUpOnFor(when)
  const before = job.follow_up_on ?? null
  patchCaches(queryClient, job.id, userId, value)
  toastSuccess(
    value ? 'Follow up set' : 'Follow up cleared',
    value ? `${job.name || 'This job'}, ${followUpMeta(value)?.label || value}` : ''
  )
  // By id only: teammates set follow ups on shared jobs and RLS scopes
  // the org. .select() so a zero row update counts as a failure.
  const { data, error } = await supabase
    .from('fh_contacts')
    .update({ follow_up_on: value })
    .eq('id', job.id)
    .select('id')
  const failure = error || (!data || data.length === 0 ? { message: 'This job may have been removed, or you no longer have access to edit it.' } : null)
  if (failure) {
    patchCaches(queryClient, job.id, userId, before)
    toastError("Couldn't set follow up", failure.message || 'Try again')
  }
  void queryClient.invalidateQueries({ queryKey: ['jobDetail', job.id] })
  void queryClient.invalidateQueries({ queryKey: ['jobs'] })
  return { error: failure }
}
