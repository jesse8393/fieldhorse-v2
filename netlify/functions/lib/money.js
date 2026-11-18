// netlify/functions/lib/money.js
//
// Server copy of moneyCents() from src/lib/format.ts. Emails and alerts
// print a record's amount the way the app and the PDF do: always dollars
// and cents, "$6,400.00" and "$2,949.75". Pinned to en-US because the
// server's own locale is not the customer's.
// src/lib/functionMoneyFunction.test.ts keeps the two in step.

export function moneyCents(n) {
  const v = Number(n ?? 0)
  const value = Number.isFinite(v) ? v : 0
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}
