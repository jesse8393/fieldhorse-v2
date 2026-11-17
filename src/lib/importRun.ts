// src/lib/importRun.ts
//
// Writes CSV import records as clients and leads (SPEC D53: each lead
// points at a client). The company's clients are read once and matched
// in memory by phone, then email, then name, newest first, the same order
// findOrCreateClient uses. Rows in one file that name the same person
// share one new client. Records are written in chunks: for each chunk the
// new clients go in with one request and its leads with a second, so a
// closed tab or a failed chunk never leaves clients without their leads.

import { supabase } from './supabase.ts'
import { fetchAllRows } from './fetchAllRows.ts'
import { queryClient } from './queryClient.ts'
import { normalizePhoneKey } from './subIdentity.ts'
import { createUuid } from './uuid.ts'
import type { ImportRecord } from './importMapping.ts'
import type { LeadInsert } from './leads.ts'
import type { Database } from './database.types.ts'

type ClientInsert = Database['public']['Tables']['fh_clients']['Insert']

// Rows per insert. One giant insert for a big export can hit request size
// or statement time limits and fails as a whole.
export const IMPORT_CHUNK = 200

type ClientRow = { id: string; name: string | null; phone: string | null; email: string | null }

function textKey(v: string | null | undefined): string {
  return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** The note a lead carries for the amount in the export (fh_leads has no amount column). */
export function amountNote(amount: number): string | null {
  return amount ? `Estimated amount $${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : null
}

export async function runImport(opts: {
  userId: string
  orgId: string | null | undefined
  records: ImportRecord[]
  chunk?: number
  onProgress?: (pct: number) => void
  newId?: () => string
}): Promise<{ landed: number; count: number; error: { message: string } | null }> {
  const { userId, orgId, records, onProgress } = opts
  const chunk = opts.chunk ?? IMPORT_CHUNK
  const newId = opts.newId ?? createUuid

  let existing: ClientRow[]
  try {
    existing = await fetchAllRows<ClientRow>((from, to) => {
      const q = supabase.from('fh_clients').select('id, name, phone, email')
      return (orgId ? q.eq('org_id', orgId) : q.eq('user_id', userId))
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to)
    })
  } catch (e) {
    // Without the list we cannot tell a new customer from a known one, so
    // stop rather than create duplicates.
    const message = (e as { message?: string })?.message || 'unknown error'
    return { landed: 0, count: 0, error: { message: `Could not read your customers: ${message}` } }
  }

  const byPhone = new Map<string, string>()
  const byEmail = new Map<string, string>()
  const byName = new Map<string, string>()
  const remember = (id: string, c: { name?: string | null; phone?: string | null; email?: string | null }) => {
    const phone = normalizePhoneKey(c.phone)
    if (phone && !byPhone.has(phone)) byPhone.set(phone, id)
    const email = textKey(c.email)
    if (email && !byEmail.has(email)) byEmail.set(email, id)
    const name = textKey(c.name)
    if (name && !byName.has(name)) byName.set(name, id)
  }
  // Newest first, so the first one remembered for a key wins.
  for (const c of existing) remember(c.id, c)

  const match = (r: ImportRecord): string | null => {
    const phone = normalizePhoneKey(r.phone)
    if (phone && byPhone.has(phone)) return byPhone.get(phone)!
    const email = textKey(r.email)
    if (email && byEmail.has(email)) return byEmail.get(email)!
    const name = textKey(r.name)
    if (name && byName.has(name)) return byName.get(name)!
    return null
  }

  let landed = 0
  let count = 0
  let madeClients = false
  let error: { message: string } | null = null
  onProgress?.(5)
  for (let i = 0; i < records.length; i += chunk) {
    const batch = records.slice(i, i + chunk)
    const newClients: ClientInsert[] = []
    const leads: LeadInsert[] = batch.map((r) => {
      let clientId = match(r)
      if (!clientId) {
        clientId = newId()
        newClients.push({
          id: clientId,
          user_id: userId,
          ...(orgId ? { org_id: orgId } : {}),
          name: r.name,
          phone: r.phone || null,
          email: r.email ? r.email.toLowerCase() : null,
          address: r.address || null
        })
        remember(clientId, r)
      }
      return {
        user_id: userId,
        org_id: orgId ?? null,
        client_id: clientId,
        title: r.job_title || null,
        job_type: r.job_type || null,
        notes: amountNote(r.amount),
        source: 'import',
        status: 'open'
      }
    })
    if (newClients.length) {
      const res = await supabase.from('fh_clients').insert(newClients)
      if (res.error) { error = res.error; break }
      madeClients = true
    }
    const res = await supabase.from('fh_leads').insert(leads, { count: 'exact' })
    if (res.error) { error = res.error; break }
    landed += batch.length
    count += res.count ?? batch.length
    onProgress?.(5 + Math.round((95 * landed) / records.length))
  }
  // The Clients list should show the new customers without a reload.
  if (madeClients) void queryClient.invalidateQueries({ queryKey: ['clients'] })
  return { landed, count, error }
}
