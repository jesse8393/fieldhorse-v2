export function moneyAmount(value: string, options: { allowZero?: boolean; allowNegative?: boolean } = {}): number | null {
  const formatted = value.trim()
  if (!/^-?\$?(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?|\.\d{1,2})$/.test(formatted)) return null
  const clean = formatted.replace(/[$,]/g, '')
  const amount = Number(clean)
  if (!Number.isFinite(amount) || !Number.isSafeInteger(Math.round(amount * 100))) return null
  if (amount < 0 && !options.allowNegative) return null
  if (amount === 0 && !options.allowZero) return null
  return amount
}

export function paymentAmount(value: string): number | null {
  return moneyAmount(value)
}

export function localDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(0)
  date.setFullYear(year, month - 1, day)
  return year > 0 && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}
