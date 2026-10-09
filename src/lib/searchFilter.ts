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
  return columns.map((column) => `${column}.ilike.${quoted}`).join(',')
}
