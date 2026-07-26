// src/components/documents/format.ts
//
// Small formatting helpers used across document templates. Keeping them
// here (not in lib/) so document concerns stay co-located.

import { parseDateOnly } from '../../lib/dates.ts'

export function money(n: number | string | null | undefined, { cents = false }: { cents?: boolean } = {}) {
  const v = Number(n || 0)
  // Whole-dollar display is a STYLE choice for heroes/summary chips,
  // but it must never change the number: a $12,499.50 total shown as
  // "$12,500" next to a cent-precise line-item table reads as two
  // different figures on one document. When the value carries cents,
  // show them regardless of the requested style.
  const hasCents = Math.abs(v - Math.round(v)) >= 0.005
  const showCents = cents || hasCents
  return v.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0
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
