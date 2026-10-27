// src/lib/activityTime.ts
//
// When a payment happened, for timeline surfaces like the Activity feed.
// fh_payments.paid_on is a date-only column: it must be read as a LOCAL
// calendar day (a UTC parse files an Oct 9 payment under Oct 8 at
// 7:00 PM in US timezones) and it carries no time of day. created_at
// supplies a real time only when the payment was logged that same day.

import { parseDateOnly } from './dates.ts'

/** Calendar periods, shared by both activity layouts. Local dates handle DST. */
export function activityBucketLabel(date: Date | null | undefined, now = new Date()): string {
  if (!date || !Number.isFinite(date.getTime())) return 'Earlier'
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const eventDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  if (eventDay.getTime() === today.getTime()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (eventDay.getTime() === yesterday.getTime()) return 'Yesterday'
  if (eventDay > today) return 'Upcoming'
  const weekStart = new Date(today)
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  if (eventDay >= weekStart) return 'This week'
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  if (eventDay >= monthStart) return 'This month'
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function paymentEventTime(
  paidOn: string | null | undefined,
  createdAt: string | null | undefined
): { when: Date | null; dateOnly: boolean } {
  const day = parseDateOnly(paidOn)
  const logged = parseDateOnly(createdAt)
  if (day && logged && logged.toDateString() === day.toDateString()) return { when: logged, dateOnly: false }
  if (day) return { when: day, dateOnly: true }
  return { when: logged, dateOnly: false }
}
