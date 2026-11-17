// Shared formatters extracted from ~9 Snow*Build screens that inlined
// identical copies. All of them are tolerant of null / undefined /
// non-numeric input so callers don't have to guard:
//
//   money(n)      Compact form with K / M abbreviations, for tight
//                 dashboard tiles and inline copy. Example: 84_000 →
//                 "$84K", 1_240_000 → "$1.24M". Sub-thousand values
//                 render with comma grouping, e.g. 742 → "$742".
//
//   moneyFull(n)  Full currency, no fractional digits. For invoices,
//                 payment confirmations, totals, anywhere the
//                 operator needs the exact dollar amount. Example:
//                 1_240_000 → "$1,240,000".
//
//   moneyExact(n) The same as moneyCents: always dollars and cents, the
//                 way the PDF prints money. For a single payment or bill.
//                 Example: 1_234.5 → "$1,234.50", 6_400 → "$6,400.00".
//
// Negative values keep the sign in front of the currency symbol
// ("-$1,200", never "$-1,200"), and the compact forms pick their unit
// AFTER rounding so 999_999 reads "$1.00M", not "$1000K".
//
// Files with INTENTIONALLY different number-formatting rules (e.g.
// the payment screens use Intl.NumberFormat full currency) keep their own
// helpers, this module is for the dominant canonical shape only.

function toNumber(n: unknown): number {
  const v = Number(n || 0)
  return Number.isFinite(v) ? v : 0
}

export function money(n: number | null | undefined): string {
  const v = toNumber(n)
  const sign = v < 0 ? '-' : ''
  const a = Math.abs(v)
  if (Math.round(a / 1_000) >= 1_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`
  if (Math.round(a) >= 1_000) return `${sign}$${Math.round(a / 1_000)}K`
  const whole = Math.round(a)
  return `${whole ? sign : ''}$${whole.toLocaleString()}`
}

export function moneyFull(n: number | null | undefined): string {
  return `$${Math.round(Number(n || 0)).toLocaleString()}`
}

// One record's amount prints the way the PDF and the customer documents
// print it, so a whole amount reads "$6,400.00" here too (formats-6).
export function moneyExact(n: number | string | null | undefined): string {
  return moneyCents(n)
}

// Compact K-notation for list cards ($24.4K / $135K / $840). Extracted
// from Work + DetailListRail (audit: third hand-rolled copy). Millions
// read "$1.2M" instead of running on as "$1200K".
// Money with cents, as the redesign always shows it (spec 5.6):
// "$12,375.00", never "$12,375" or "$12.4k". Same locale and sign handling
// as moneyExact ("-$1,200.00", never "$-1,200.00").
export function moneyCents(n: number | string | null | undefined): string {
  const v = Number(n ?? 0)
  const value = Number.isFinite(v) ? v : 0
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

export function moneyK(n: number | string | null | undefined): string | null {
  const v = toNumber(n)
  if (!v) return null
  const sign = v < 0 ? '-' : ''
  const a = Math.abs(v)
  if (Math.round(a) < 1_000) return `${sign}$${Math.round(a).toLocaleString()}`
  const tenthsK = (a / 1_000).toFixed(1)
  if (Number(tenthsK) < 10) return `${sign}$${tenthsK}K`
  const wholeK = (a / 1_000).toFixed(0)
  if (Number(wholeK) < 1_000) return `${sign}$${wholeK}K`
  return `${sign}$${(a / 1_000_000).toFixed(1)}M`
}

export function countNoun(
  count: number,
  singular: string,
  plural = `${singular}s`
): string {
  return Number(count) === 1 ? singular : plural
}
