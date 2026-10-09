// src/lib/activityTime.ts
//
// When a payment happened, for timeline surfaces like the Activity feed.
// fh_payments.paid_on is a date-only column: it must be read as a LOCAL
// calendar day (a UTC parse files an Oct 9 payment under Oct 8 at
// 7:00 PM in US timezones) and it carries no time of day. created_at
// supplies a real time only when the payment was logged that same day.

import { parseDateOnly } from './dates.ts'

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
