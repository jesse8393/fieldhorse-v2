/**
 * Shared formatting helpers for the ContactDetail v3 module.
 *
 * Extracted from 5+ duplicate definitions across sections + parent shell.
 * Future financial sections that get added should import these instead of
 * redeclaring.
 */

import { moneyExact } from '../../../lib/format.ts'

// Exact to the cent (M-20): the Overview's contract card read "$5,001
// collected" and "$5,000 remaining" on a $10,000 job paid $5,000.50.
export function money(n: number | string | null | undefined) {
  return moneyExact(n)
}

export function fmtSize(n: number | null | undefined) {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
