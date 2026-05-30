// Shared formatters extracted from ~9 Snow*Build screens that inlined
// identical copies. Two flavours, both tolerant of null / undefined /
// non-numeric input so callers don't have to guard:
//
//   money(n)      Compact form with K / M abbreviations, for tight
//                 dashboard tiles and inline copy. Example: 84_000 →
//                 "$84K", 1_240_000 → "$1.24M". Sub-thousand values
//                 render with comma grouping, e.g. 742 → "$742".
//
//   moneyFull(n)  Full currency, no fractional digits. For invoices,
//                 payment confirmations, totals — anywhere the
//                 operator needs the exact dollar amount. Example:
//                 1_240_000 → "$1,240,000".
//
// Files with INTENTIONALLY different number-formatting rules (e.g.
// V3PaymentSheet uses Intl.NumberFormat full currency; KanbanBoard
// uses 1-decimal conditional K/M) keep their own helpers — this
// module is for the dominant canonical shape only.

export function money(n: number | null | undefined): string {
  const v = Number(n || 0)
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`
  return `$${Math.round(v).toLocaleString()}`
}

export function moneyFull(n: number | null | undefined): string {
  return `$${Math.round(Number(n || 0)).toLocaleString()}`
}
