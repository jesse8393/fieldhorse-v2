// Open reminders for the notifications screen and the bell (audit finding
// AUTO-09). fh_my_open_reminders (migration 20261117100000) returns the
// caller's queued follow ups with the client each one is for. The screen
// shows one row per client, led by the newest reminder, and the bell counts
// those rows plus the other unread notifications, so the two always agree.
//
// Until that migration is applied the function does not exist. PostgREST
// then answers PGRST202 (or Postgres 42883); fetchOpenReminders returns null
// and both callers keep the plain list and count they had before.

import { supabase } from './supabase.ts'
import type { Database } from './database.types.ts'

export type OpenReminder = Database['public']['Functions']['fh_my_open_reminders']['Returns'][number]

export type ReminderGroup = {
  key: string
  clientName: string
  /** The reminder the row leads with: the newest due. */
  newest: OpenReminder
  /** Every open reminder for this client, newest first. */
  reminders: OpenReminder[]
}

export const REMINDER_KINDS = ['follow_up_due', 'review_ask_due'] as const

export function isMissingFunction(error: { code?: string | null; message?: string } | null | undefined) {
  return !!error && (error.code === 'PGRST202' || error.code === '42883')
}

/** The caller's open reminders, or null while the database has no fh_my_open_reminders. */
export async function fetchOpenReminders(): Promise<OpenReminder[] | null> {
  const { data, error } = await supabase.rpc('fh_my_open_reminders')
  if (error) {
    if (isMissingFunction(error)) return null
    throw error
  }
  return data || []
}

const newestFirst = (a: OpenReminder, b: OpenReminder) =>
  (b.due_on || '').localeCompare(a.due_on || '') || b.created_at.localeCompare(a.created_at)

export function groupRemindersByClient(rows: OpenReminder[]): ReminderGroup[] {
  const groups = new Map<string, ReminderGroup>()
  for (const row of [...rows].sort(newestFirst)) {
    const key = row.client_id || `note:${row.notification_id}`
    const group = groups.get(key)
    if (group) group.reminders.push(row)
    else groups.set(key, { key, clientName: row.client_name || 'Your customer', newest: row, reminders: [row] })
  }
  return [...groups.values()]
}

const TIERS: Record<string, string> = {
  day3: 'Day 3 touch',
  day7: 'Day 7 call',
  day14: 'Day 14 close out ask',
  day30: 'Day 30 revival',
  review_ask: 'Review ask'
}
export function tierLabel(kind: string) {
  return TIERS[kind] || 'Reminder'
}

/** Call, Text or Email, as the reminder asks, with what is on file for the client. */
export function contactLinkFor(row: OpenReminder): { label: 'Call' | 'Text' | 'Email'; href: string } | null {
  const phone = (row.client_phone || '').replace(/[^\d+]/g, '')
  const email = (row.client_email || '').trim()
  if (row.channel === 'email' && email) return { label: 'Email', href: `mailto:${email}` }
  if (phone) return row.channel === 'call' || row.channel === 'email' ? { label: 'Call', href: `tel:${phone}` } : { label: 'Text', href: `sms:${phone}` }
  if (email) return { label: 'Email', href: `mailto:${email}` }
  return null
}

async function countUnread(userId: string, withoutReminders: boolean) {
  let query = supabase
    .from('fh_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null)
  if (withoutReminders) query = query.not('kind', 'in', `(${REMINDER_KINDS.join(',')})`)
  const { count, error } = await query
  if (error) return 0
  return count || 0
}

/**
 * What the bell shows: the clients with an open reminder plus the other
 * unread notifications, which is what the notifications screen lists. While
 * the reminder function is missing or fails, every unread notification, as
 * before. Never throws.
 */
export async function notificationBadgeCount(userId: string | undefined) {
  if (!userId) return 0
  let reminders: OpenReminder[] | null = null
  try { reminders = await fetchOpenReminders() } catch { reminders = null }
  if (reminders === null) return countUnread(userId, false)
  return groupRemindersByClient(reminders).length + await countUnread(userId, true)
}
