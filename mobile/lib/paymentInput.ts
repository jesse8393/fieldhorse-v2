export function paymentAmount(value: string): number | null {
  const clean = value.trim().replace(/[$,\s]/g, '')
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(clean)) return null
  const amount = Number(clean)
  return Number.isFinite(amount) && amount > 0 && Number.isSafeInteger(Math.round(amount * 100)) ? amount : null
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
