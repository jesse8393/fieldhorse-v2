import { parseDateOnly } from './dates.ts'

// Official business rates, by drive date rather than the date of a report.
// Source: https://www.irs.gov/tax-professionals/standard-mileage-rates
// Verified October 27, 2026. Never carry the last known rate into a new year.
const BUSINESS_RATES = [
  { from: '2024-01-01', through: '2024-12-31', rate: 0.67 },
  { from: '2025-01-01', through: '2025-12-31', rate: 0.70 },
  { from: '2026-01-01', through: '2026-06-30', rate: 0.725 },
  { from: '2026-07-01', through: '2026-12-31', rate: 0.76 }
] as const

export function businessMileageRate(date: string | null | undefined): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const parsed = parseDateOnly(date)
  const [year, month, day] = date.split('-').map(Number)
  if (!parsed || parsed.getFullYear() !== year || parsed.getMonth() + 1 !== month || parsed.getDate() !== day) return null
  return BUSINESS_RATES.find((r) => date >= r.from && date <= r.through)?.rate ?? null
}

export function mileageYearSummary(
  trips: { drove_on?: string | null; miles?: number | string | null }[],
  now = new Date()
) {
  const start = new Date(now.getFullYear(), 0, 1)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let miles = 0
  let deduction = 0
  let missingRates = 0
  for (const trip of trips) {
    const when = parseDateOnly(trip.drove_on)
    const distance = Number(trip.miles)
    if (!when || when < start || when > today || !Number.isFinite(distance) || distance <= 0) continue
    miles += distance
    const rate = businessMileageRate(trip.drove_on)
    if (rate == null) missingRates++
    else deduction += distance * rate
  }
  return { miles, deduction: missingRates ? null : Math.round(deduction * 100) / 100, missingRates }
}

export function mileageRateNote(year: number): string {
  const rates = BUSINESS_RATES.filter((r) => r.from.startsWith(`${year}-`))
  if (!rates.length) return `IRS business rate for ${year} needs verification`
  if (rates.length === 1) return `IRS ${year} business rate · $${rates[0].rate.toFixed(2)} per mile`
  return `IRS ${year} · Jan to Jun $0.725 · Jul to Dec $0.76 per mile`
}
