// src/lib/amount.ts
//
// Read a money or quantity value that a person or a model wrote down.
// Spreadsheet exports (Jobber, HubSpot, QuickBooks) format totals as
// "$4,500.00", and a model asked for JSON numbers sometimes answers
// "12,000". Number() turns both into NaN, which supabase-js then writes
// as null.

/**
 * Parse 4500, "4500", "$4,500.00", "USD 4,500", "-$50" or an accounting
 * negative "(1,200.00)". Returns null when the value holds no number.
 */
export function parseAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  // Common case: currency symbol, thousands separators and spaces only.
  const stripped = s.replace(/[$,\s]/g, '')
  const plain = stripped ? Number(stripped) : NaN
  if (Number.isFinite(plain)) return plain
  // Otherwise take the first number in the text ("USD 4,500", "2 sq ft").
  const m = /\d[\d,]*(?:\.\d+)?|\.\d+/.exec(s)
  if (!m) return null
  const n = Number(m[0].replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  const negative = s.slice(0, m.index).includes('-') || /^\(.*\)$/.test(s)
  return negative ? -n : n
}
