// src/lib/dates.ts
//
// Local-calendar date helpers for date-only columns.
//
// Supabase `date` columns (fh_payments.paid_on, fh_expenses.expense_date,
// fh_closeouts.warranty_start_date, fh_contacts.follow_up_on, etc.) store
// a bare "year month day" with no timezone. The bug this module exists to kill:
// `new Date("2026-06-01")` parses as UTC midnight, which is the PREVIOUS
// day in every US timezone, so a payment logged June 1 prints "May 31"
// on the customer's invoice, revenue mis-buckets on month boundaries, and
// "today" defaults computed via `toISOString().slice(0,10)` roll over to
// tomorrow after ~5-8pm local.
//
// Rule: treat a date-only value as a calendar date in the VIEWER's local
// timezone. Parse with the multi-arg Date constructor (local), and derive
// "today" from local getFullYear/Month/Date, never from toISOString().

/**
 * Parse a date-only string ("year month day") as local midnight. Passes
 * through Date objects and full ISO timestamps unchanged (those already
 * carry an instant). Returns null on empty/invalid input.
 */
export function parseDateOnly(value: string | Date | null | undefined): Date | null {
  if (value == null || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const s = String(value)
  // Bare date-only → construct in local time so the calendar day is
  // preserved regardless of the viewer's timezone.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Today's calendar date in the local timezone as "year month day". */
export function todayYmd(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** A Date's local calendar date as "year month day" (for <input type="date">). */
export function toYmd(value: string | Date | null | undefined): string {
  const d = parseDateOnly(value)
  if (!d) return ''
  return todayYmd(d)
}

/**
 * Add whole months to a date-only value, clamping to the last valid day
 * of the target month so Jan 31 + 1 month = Feb 28/29, not Mar 3.
 * Returns "year month day" or null.
 */
export function addMonthsYmd(value: string | Date | null | undefined, months: number): string | null {
  const start = parseDateOnly(value)
  if (!start) return null
  const y = start.getFullYear()
  const m = start.getMonth() + months
  const targetY = y + Math.floor(m / 12)
  const targetM = ((m % 12) + 12) % 12
  const lastDay = new Date(targetY, targetM + 1, 0).getDate()
  const day = Math.min(start.getDate(), lastDay)
  return todayYmd(new Date(targetY, targetM, day))
}

/** Add whole calendar days without crossing through UTC. */
export function addDaysYmd(value: string | Date | null | undefined, days: number): string | null {
  const start = parseDateOnly(value)
  if (!start || !Number.isFinite(days)) return null
  const next = new Date(start)
  next.setDate(next.getDate() + Math.trunc(days))
  return todayYmd(next)
}

/**
 * Format a date-only or timestamp value for display. `long` gives
 * "June 1, 2026", otherwise "Jun 1, 2026". Empty string on invalid.
 */
export function formatDate(value: string | Date | null | undefined, { long = false }: { long?: boolean } = {}): string {
  const d = parseDateOnly(value)
  if (!d) return ''
  return d.toLocaleDateString(undefined, {
    month: long ? 'long' : 'short',
    day: 'numeric',
    year: 'numeric'
  })
}
