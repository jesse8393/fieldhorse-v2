// src/components/documents/format.ts
//
// Small formatting helpers used across document templates. Keeping them
// here (not in lib/) so document concerns stay co-located.

import { parseDateOnly } from '../../lib/dates.ts'
import { moneyCents } from '../../lib/format.ts'

// Every amount on a customer document prints dollars and cents, the way
// the PDF prints it: "$6,400.00 of $12,800.00 collected", never "$6,400"
// under "AMOUNT DUE $6,400.00" (formats-6). The cents option is kept so
// callers need no change; it no longer alters the output.
export function money(n: number | string | null | undefined, _options: { cents?: boolean } = {}) {
  return moneyCents(n)
}

// Date-only columns (paid_on, due_at-as-date, warranty dates) must be
// parsed as LOCAL calendar dates, not UTC, otherwise a payment dated
// "2026-06-01" prints as "May 31" on the customer's invoice in every US
// timezone. parseDateOnly handles both bare dates and full timestamps.
//
// A timestamp (an issue date, a due date stored at the end of the company's
// day) prints in the company's time zone when the document knows it, so a
// customer on Eastern time reads the day the company set, the day the PDF
// and the app print, not the next one (formats-2). A bare date keeps its
// calendar day in any zone.
function documentDate(iso: string | Date | null | undefined, month: 'long' | 'short', timeZone?: string | null) {
  const d = parseDateOnly(iso)
  if (!d) return ''
  const options: Intl.DateTimeFormatOptions = { month, day: 'numeric', year: 'numeric' }
  const bareDate = typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)
  if (timeZone && !bareDate) {
    try {
      return d.toLocaleDateString(undefined, { ...options, timeZone })
    } catch {
      // An unknown zone name: print in the viewer's zone as before.
    }
  }
  return d.toLocaleDateString(undefined, options)
}

export function longDate(iso: string | Date | null | undefined, timeZone?: string | null) {
  return documentDate(iso, 'long', timeZone)
}

export function shortDate(iso: string | Date | null | undefined, timeZone?: string | null) {
  return documentDate(iso, 'short', timeZone)
}

/**
 * Format the city/state pair out of a free-form US address. Falls back
 * to the full address when only a single line is present.
 */
export function cityState(address: string | null | undefined) {
  const a = (address || '').trim()
  if (!a) return ''
  const parts = a.split(',').map((s) => s.trim()).filter(Boolean)
  return parts.length >= 2 ? parts.slice(-2).join(', ') : a
}
