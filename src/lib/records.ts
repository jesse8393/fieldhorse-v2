// Routes for the five record kinds (SPEC D53, D65). Every screen that
// links to a record goes through these two helpers so the paths live in
// one place.

export type RecordKind = 'lead' | 'quote' | 'job' | 'invoice' | 'client'

const BASE: Record<RecordKind, string> = {
  lead: '/leads',
  quote: '/quotes',
  job: '/jobs',
  invoice: '/invoices',
  client: '/clients',
}

export function recordRoute(kind: RecordKind, id: string): string {
  return `${BASE[kind]}/${id}`
}

// The create screen for a kind, with optional prefill params carried in
// the query string (keys and values are URL encoded).
export function newRecordRoute(kind: RecordKind, params?: Record<string, string>): string {
  const base = `${BASE[kind]}/new`
  if (!params) return base
  const qs = new URLSearchParams(params).toString()
  return qs ? `${base}?${qs}` : base
}
