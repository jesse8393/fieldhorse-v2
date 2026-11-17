// src/lib/importMapping.ts
//
// Turns the columns of an exported CSV into import records. Shared by the
// Importer screen and its tests.
//
// A person's name can come from one full name column, or from first and
// last name columns joined. A company column is used as the name only
// when a row has no person name. Each field takes the first matching
// column in its synonym order and is never overwritten by a later column.

import { parseAmount } from './amount.ts'
import { leadKeys } from './importDedupe.ts'

export type ImportField =
  | 'name' | 'first_name' | 'last_name' | 'company'
  | 'phone' | 'email' | 'address' | 'job_title' | 'job_type' | 'amount'

export type HeaderMap = Partial<Record<ImportField, string>>

export type ImportRecord = {
  name: string
  phone: string | null
  email: string | null
  address: string | null
  job_title: string | null
  job_type: string | null
  amount: number
}

// Importable target fields, in display order. Used by the mapping review
// and the AI mapper prompt.
export const TARGET_FIELDS: { key: ImportField; label: string; required?: boolean }[] = [
  { key: 'name',       label: 'Name', required: true },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name',  label: 'Last name' },
  { key: 'company',    label: 'Company' },
  { key: 'phone',      label: 'Phone' },
  { key: 'email',      label: 'Email' },
  { key: 'address',    label: 'Address' },
  { key: 'job_title',  label: 'Job title' },
  { key: 'job_type',   label: 'Job type' },
  { key: 'amount',     label: 'Amount' }
]

export const PRESETS: Record<string, { label: string }> = {
  jobber:  { label: 'Jobber' },
  hubspot: { label: 'HubSpot' },
  generic: { label: 'Generic CSV' }
}

// Normalize a column header so "First Name", "first_name" and "firstname" all match.
function norm(s: unknown) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '') }

// Exact synonyms per field, best first. Matching is on normalized headers.
const FIELD_SYNONYMS: Record<ImportField, string[]> = {
  name:       ['name', 'fullname', 'displayname', 'clientname', 'customername', 'contactname', 'contact'],
  first_name: ['firstname', 'first', 'givenname'],
  last_name:  ['lastname', 'last', 'surname', 'familyname'],
  company:    ['company', 'companyname', 'businessname', 'organization', 'organisation'],
  phone:      ['phone', 'phonenumber', 'mobile', 'mobilephone', 'primaryphone', 'mainphone', 'mainphones', 'cell', 'cellphone', 'workphone', 'telephone', 'tel'],
  email:      ['email', 'emails', 'emailaddress', 'primaryemail', 'workemail', 'contactemail', 'mail'],
  address:    ['address', 'street', 'streetaddress', 'street1', 'addressline1', 'propertyaddress', 'serviceaddress', 'billingstreet1', 'propertystreet1', 'location', 'address1'],
  job_title:  ['jobname', 'jobtitle', 'title', 'dealname', 'opportunity', 'opportunityname', 'project', 'projectname'],
  job_type:   ['service', 'category', 'servicetype', 'jobtype', 'dealstage', 'stage', 'type', 'trade'],
  amount:     ['total', 'amount', 'quotetotal', 'dealamount', 'value', 'price', 'revenue', 'estimate', 'bidamount']
}

// Synonyms a preset does not accept. Jobber's Title column is an
// honorific (Mr., Mrs.), not a job title.
const PRESET_EXCLUDE: Record<string, Partial<Record<ImportField, string[]>>> = {
  jobber: { job_title: ['title'] }
}

// Loose (contains) matching is a fallback for odd headers. Name parts and
// company are never matched loosely: "Last Name" and "Company Name" both
// contain "name".
const LOOSE_FIELDS: ImportField[] = ['phone', 'email', 'address', 'job_title', 'job_type', 'amount']

/** For each field, the CSV column that feeds it. */
export function buildHeaderMap(headers: string[], preset = 'generic'): HeaderMap {
  const out: HeaderMap = {}
  const used = new Set<string>()
  const normed = headers.map((h) => ({ h, n: norm(h) }))
  const exclude = PRESET_EXCLUDE[preset] || {}
  for (const field of Object.keys(FIELD_SYNONYMS) as ImportField[]) {
    const skip = exclude[field] || []
    for (const syn of FIELD_SYNONYMS[field]) {
      if (skip.includes(syn)) continue
      const hit = normed.find((c) => c.n === syn && !used.has(c.h))
      if (hit) { out[field] = hit.h; used.add(hit.h); break }
    }
  }
  for (const field of LOOSE_FIELDS) {
    if (out[field]) continue
    const skip = exclude[field] || []
    const syns = FIELD_SYNONYMS[field].filter((s) => !skip.includes(s) && s.length > 3)
    const hit = normed.find((c) => !used.has(c.h) && syns.some((s) => c.n.includes(s)))
    if (hit) { out[field] = hit.h; used.add(hit.h) }
  }
  return out
}

function pick(row: Record<string, unknown>, header: string | undefined): string | null {
  if (!header) return null
  const v = String(row[header] ?? '').trim()
  return v ? v : null
}

/** Whether the map gives every row a way to have a name. */
export function hasNameSource(hm: HeaderMap): boolean {
  return Boolean(hm.name || hm.first_name || hm.last_name || hm.company)
}

/** Records ready to import, and how many rows had no name and were left out. */
export function mapRows(data: Record<string, unknown>[], hm: HeaderMap): { records: ImportRecord[]; skipped: number } {
  const records: ImportRecord[] = []
  let skipped = 0
  for (const r of data) {
    const joined = [pick(r, hm.first_name), pick(r, hm.last_name)].filter(Boolean).join(' ')
    const name = pick(r, hm.name) || joined || pick(r, hm.company)
    if (!name) { skipped += 1; continue }
    records.push({
      name: name.replace(/\s+/g, ' '),
      phone: pick(r, hm.phone),
      email: pick(r, hm.email),
      address: pick(r, hm.address),
      job_title: pick(r, hm.job_title),
      job_type: pick(r, hm.job_type),
      // Exports format totals as "$4,500.00"; parseAmount reads that.
      amount: parseAmount(pick(r, hm.amount)) ?? 0
    })
  }
  return { records, skipped }
}

/** For each row, whether an earlier row in the same file is the same lead. */
export function markFileRepeats(rows: Parameters<typeof leadKeys>[0][]): boolean[] {
  const seen = new Set<string>()
  return rows.map((r) => {
    const keys = leadKeys(r)
    const repeat = keys.some((k) => seen.has(k))
    for (const k of keys) seen.add(k)
    return repeat
  })
}

/** Whether a picked or dropped file is plain text we can read as CSV. */
export function looksLikeCsv(file: { name: string; type: string }): boolean {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.txt')) return true
  return /^text\/(csv|plain)$/.test(file.type)
}
