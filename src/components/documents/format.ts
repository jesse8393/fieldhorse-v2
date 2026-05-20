// src/components/documents/format.ts
//
// Small formatting helpers used across document templates. Keeping them
// here (not in lib/) so document concerns stay co-located.

export function money(n: number | string | null | undefined, { cents = false }: { cents?: boolean } = {}) {
  const v = Number(n || 0)
  return v.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0
  })
}

export function longDate(iso: string | Date | null | undefined) {
  if (!iso) return ''
  const d = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

export function shortDate(iso: string | Date | null | undefined) {
  if (!iso) return ''
  const d = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
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
