// src/components/documents/format.ts
//
// Small formatting helpers used across document templates. Keeping them
// here (not in lib/) so document concerns stay co-located.

import { parseDateOnly } from '../../lib/dates.ts'

export function money(n: number | string | null | undefined, { cents = false }: { cents?: boolean } = {}) {
  const v = Number(n || 0)
  return v.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0
  })
}

// Date-only columns (paid_on, due_at-as-date, warranty dates) must be
// parsed as LOCAL calendar dates, not UTC — otherwise a payment dated
// "2026-06-01" prints as "May 31" on the customer's invoice in every US
// timezone. parseDateOnly handles both bare dates and full timestamps.
export function longDate(iso: string | Date | null | undefined) {
  const d = parseDateOnly(iso)
  if (!d) return ''
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

export function shortDate(iso: string | Date | null | undefined) {
  const d = parseDateOnly(iso)
  if (!d) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
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
