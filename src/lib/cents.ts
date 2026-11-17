// src/lib/cents.ts
//
// Money in whole cents. Dollar amounts are stored and passed around as
// floats, and float sums drift (500.04 + 400.03 + 100 is not 1000.07), so
// every comparison and every total that decides something (paid in full,
// close the job, what an invoice still owes) goes through these four
// helpers and is done on integers.

/**
 * Dollars to whole cents, rounding half away from zero. The product is
 * trimmed to 15 significant digits first, so 1.005 (held as
 * 1.00499999999999989) is 101 cents and 10.825 is 1083. Blank, missing and
 * non numeric input is zero.
 */
export function toCents(dollars: unknown): number {
  const v = Number(dollars || 0)
  if (!Number.isFinite(v)) return 0
  const scaled = Number((Math.abs(v) * 100).toPrecision(15))
  const cents = Math.round(scaled)
  return v < 0 && cents !== 0 ? -cents : cents
}

/** Whole cents back to dollars. */
export function fromCents(cents: number): number {
  return Math.round(Number(cents) || 0) / 100
}

/**
 * Less than zero when a is smaller than b, zero when they are the same
 * amount to the cent, more than zero when a is larger. Both are dollars.
 */
export function compareCents(a: unknown, b: unknown): number {
  return toCents(a) - toCents(b)
}

/**
 * The total of a list in whole cents. Pass dollar amounts, or rows with a
 * function that reads the dollar amount from each.
 */
export function sumCents<T>(rows: readonly T[] | null | undefined, amountOf?: (row: T) => unknown): number {
  let total = 0
  for (const row of rows || []) total += toCents(amountOf ? amountOf(row) : row)
  return total
}
