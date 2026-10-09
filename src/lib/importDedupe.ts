// src/lib/importDedupe.ts
//
// Spot import rows that are already in the pipeline, so running the same
// export twice does not double every lead. fh_contacts holds deals, not
// people: one client with two jobs is two rows. So a row only counts as
// a repeat when the same person (by email, phone or name) already has a
// lead with the same job title.

import { normalizePhoneKey } from './subIdentity.ts'

export type LeadIdentity = {
  name?: string | null
  phone?: string | null
  email?: string | null
  job_title?: string | null
}

function clean(v: unknown): string {
  return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Every way to recognize this lead: each identity paired with its job title. */
export function leadKeys(row: LeadIdentity): string[] {
  const title = clean(row.job_title)
  const keys: string[] = []
  const email = clean(row.email)
  if (email) keys.push(`e:${email}|${title}`)
  const phone = normalizePhoneKey(row.phone)
  if (phone) keys.push(`p:${phone}|${title}`)
  const name = clean(row.name)
  if (name) keys.push(`n:${name}|${title}`)
  return keys
}

/** For each row, whether it matches a lead already on file. */
export function markRepeats(rows: LeadIdentity[], existingKeys: Set<string>): boolean[] {
  return rows.map((r) => leadKeys(r).some((k) => existingKeys.has(k)))
}
