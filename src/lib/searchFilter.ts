// src/lib/searchFilter.ts
//
// Server side text search filters built from what a person typed. Pure,
// so the escaping rules are unit tested (searchFilter.test.ts).

/** Escape LIKE wildcards so typed text matches itself: % and _ are literal. */
export function escapeLikeText(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&')
}

/**
 * PostgREST or() expression that matches `text` anywhere in any of
 * `columns`, ignoring case. The value is double quoted, with backslashes
 * and quotes escaped, because or() reads commas and parentheses as its
 * own syntax: unquoted, "Smith, John", "123 Main St, Apt 4" or
 * "(615) 555-0101" broke the filter and the search came back empty.
 */
export function ilikeAnyOf(columns: readonly string[], text: string): string {
  const pattern = `%${escapeLikeText(text)}%`
  const quoted = `"${pattern.replace(/[\\"]/g, '\\$&')}"`
  const terms = columns.map((column) => `${column}.ilike.${quoted}`)
  // Phones are stored as typed ("615.555.0199"), so a typed number also
  // matches its digits in order, whatever sits between them (S14).
  const digits = phoneDigits(text)
  if (digits && columns.includes('phone')) terms.push(`phone.ilike."%${digits.split('').join('%')}%"`)
  return terms.join(',')
}

/**
 * The digits of `text` when it reads as a phone number (digits and phone
 * punctuation only, at least three digits), without a leading US 1 on an
 * eleven digit number. Null otherwise.
 */
export function phoneDigits(text: string): string | null {
  const t = text.trim()
  if (!/^[\d\s().+-]+$/.test(t)) return null
  const digits = t.replace(/\D/g, '')
  if (digits.length < 3) return null
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

/** True when a stored phone contains the typed number, compared digit to digit. */
export function phoneMatches(stored: string | null | undefined, typed: string): boolean {
  const want = phoneDigits(typed)
  if (!want || !stored) return false
  return stored.replace(/\D/g, '').includes(want)
}
