// The short place line under the company name in the sidebar ("Murfreesboro,
// TN"), taken from the free text company address. Returns null when the
// address has no recognizable city.

const ZIP = /\b\d{5}(?:-\d{4})?\b/

export function cityLine(address?: string | null): string | null {
  const parts = (address || '')
    .split(/[\n,]/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length < 2) return null
  const last = parts[parts.length - 1]
  // "TN 37130", "TN", "Tennessee 37130": a state with an optional ZIP.
  const state = last.replace(ZIP, '').trim()
  if (parts.length >= 3) {
    const city = parts[parts.length - 2]
    return state ? `${city}, ${state}` : city
  }
  // Two parts: "123 Main St, Murfreesboro" or "Murfreesboro, TN 37130".
  if (/\d/.test(parts[0])) return state || null
  return state ? `${parts[0]}, ${state}` : parts[0]
}
