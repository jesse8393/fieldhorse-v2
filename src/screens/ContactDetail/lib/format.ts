/**
 * Shared formatting helpers for the ContactDetail v3 module.
 *
 * Extracted from 5+ duplicate definitions across sections + parent shell.
 * Future financial sections that get added should import these instead of
 * redeclaring.
 */

export function money(n: number | string | null | undefined) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  })
}

export function fmtSize(n: number | null | undefined) {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
