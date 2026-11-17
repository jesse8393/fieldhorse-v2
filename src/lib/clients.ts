// src/lib/clients.ts
//
// Find-or-create an fh_clients row for a lead/job, matching on
// phone → email → name (most-recent) before inserting. Shared by
// the create screens and Universal Capture so every path that creates a lead
// links a client, otherwise voice/scan leads were orphans with no
// client record (invisible on /clients, and no client email to invoice
// against later).
//
// Each lookup tolerates existing duplicates (newest match wins instead
// of maybeSingle() reading "two rows" as "no match" and inserting a
// third), compares phones by digits (shared normalizePhoneKey), and
// matches typed values literally (LIKE wildcards escaped, then confirmed
// in JS). A failed lookup aborts instead of creating a duplicate.

import { supabase } from './supabase.ts'
import { normalizePhoneKey } from './subIdentity.ts'
import { queryClient } from './queryClient.ts'

// Candidates fetched per lookup before the exact compare in JS.
const CANDIDATES = 25

/** Escape LIKE wildcards so a typed value matches itself only. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * ilike pattern for a phone key that tolerates any formatting between
 * the digits: '6155550101' matches '(615) 555-0101', '615.555.0101' and
 * '+1 615 555 0101'. Candidates are confirmed with normalizePhoneKey.
 */
export function phoneLikePattern(phoneKey: string): string {
  return `%${phoneKey.split('').join('%')}%`
}

function sameText(a: string | null | undefined, b: string): boolean {
  return (a || '').trim().toLowerCase() === b.toLowerCase()
}

type ClientFields = { name?: string | null; phone?: string | null; email?: string | null; address?: string | null; company?: string | null }
export type ClientMatch = { id: string; name: string; phone: string | null; email: string | null }

/**
 * The existing clients what was typed points at: `byContact` shares the
 * typed phone (or, with no phone match, the typed email); `byName` has the
 * typed name exactly. `contactTyped` says whether a phone or email was
 * typed at all. Throws when a lookup fails, so nothing is created blind.
 * With `stopAtContact`, the name is not looked up once a phone or email
 * was typed (findOrCreateClient files by contact details first and never
 * by name alone over a typed phone or email).
 */
export async function lookupClientMatches(
  userId: string,
  fields: ClientFields,
  orgId?: string | null,
  { stopAtContact = false }: { stopAtContact?: boolean } = {}
): Promise<{ byContact: ClientMatch | null; byName: ClientMatch | null; contactTyped: boolean }> {
  const name = (fields.name || '').trim()
  const phone = (fields.phone || '').trim()
  const email = (fields.email || '').trim().toLowerCase()
  const phoneKey = normalizePhoneKey(phone)
  const clients = () => {
    const q = supabase.from('fh_clients').select('id, name, phone, email')
    return orgId ? q.eq('org_id', orgId) : q.eq('user_id', userId)
  }
  let byContact: ClientMatch | null = null
  let byName: ClientMatch | null = null
  if (phoneKey) {
    const { data, error } = await clients()
      .ilike('phone', phoneLikePattern(phoneKey))
      .order('created_at', { ascending: false })
      .limit(CANDIDATES)
    if (error) throw error
    byContact = (data ?? []).find((c) => normalizePhoneKey(c.phone) === phoneKey) ?? null
  }
  if (!byContact && email) {
    const { data, error } = await clients()
      .ilike('email', escapeLike(email))
      .order('created_at', { ascending: false })
      .limit(CANDIDATES)
    if (error) throw error
    byContact = (data ?? []).find((c) => sameText(c.email, email)) ?? null
  }
  if (name && !(stopAtContact && (phoneKey || email))) {
    const { data, error } = await clients()
      .ilike('name', escapeLike(name))
      .order('created_at', { ascending: false })
      .limit(CANDIDATES)
    if (error) throw error
    byName = (data ?? []).find((c) => sameText(c.name, name)) ?? null
  }
  return { byContact, byName, contactTyped: !!(phoneKey || email) }
}

/**
 * The sentence a create screen shows for a failed save: its own sentences
 * pass through, while transport and database errors ("TypeError: Failed to
 * fetch", constraint names) become `fallback` (DATA-22).
 */
export function saveErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.constructor === Error && !('code' in e) && e.message) return e.message
  return fallback
}

/**
 * Inserts a client from what was typed. Null when there is no name. Pass
 * `id` (minted once per form) so a retry after a lost answer finds the
 * row the first try made instead of making a second client (DATA-12).
 */
export async function createClientRow(userId: string, fields: ClientFields, orgId?: string | null, id?: string): Promise<string | null> {
  const name = (fields.name || '').trim()
  if (!name) return null // don't create a nameless client
  const company = (fields.company || '').trim()
  const { data: created, error } = await supabase.from('fh_clients').insert({
    ...(id ? { id } : {}),
    user_id: userId,
    ...(orgId ? { org_id: orgId } : {}),
    name,
    phone: (fields.phone || '').trim() || null,
    email: (fields.email || '').trim().toLowerCase() || null,
    address: (fields.address || '').trim() || null,
    company_name: company || null
  }).select('id').single()
  if (error?.code === '23505' && id) {
    const existing = await supabase.from('fh_clients').select('id').eq('id', id).maybeSingle()
    if (!existing.error && existing.data?.id) return existing.data.id
  }
  if (error) throw error
  // Every caller (new lead, capture, picker) should see the new client in
  // the Clients list without a reload. Prefix match covers every scope.
  if (created?.id) void queryClient.invalidateQueries({ queryKey: ['clients'] })
  return created?.id || null
}

/**
 * Pass the viewer's org id to match against the whole org's clients (a
 * teammate's client is the same customer); without it the lookup stays
 * on the user's own rows as before.
 *
 * A typed phone or email that matches nobody means a new caller: the name
 * alone is not enough to file them under an existing client (two people
 * called Mike are two clients).
 */
export async function findOrCreateClient(
  userId: string | undefined,
  fields: ClientFields,
  orgId?: string | null
): Promise<string | null> {
  if (!userId) return null
  try {
    const m = await lookupClientMatches(userId, fields, orgId, { stopAtContact: true })
    if (m.byContact) return m.byContact.id
    if (m.byName && !m.contactTyped) return m.byName.id
    return await createClientRow(userId, fields, orgId)
  } catch (e) {
    // Non-fatal, caller proceeds with a null client_id.
    console.warn('[clients] findOrCreateClient failed', e)
    return null
  }
}

/**
 * Writes the phone, email and address typed on a create screen to the
 * client they were saved against, when they differ from what the client
 * has. A value it replaces is kept in the client's notes ("Other phone:"),
 * as a merge does, so nothing typed before is lost. Throws a sentence the
 * screen can show when the write fails.
 */
export async function syncClientContact(
  clientId: string,
  typed: { phone?: string | null; email?: string | null; address?: string | null }
): Promise<void> {
  const { data: row, error } = await supabase
    .from('fh_clients')
    .select('id, phone, email, address, notes')
    .eq('id', clientId)
    .maybeSingle()
  if (error || !row) throw new Error("Couldn't save the phone and address to this client. Check your connection and try again.")
  const patch: { phone?: string; email?: string; address?: string; notes?: string } = {}
  const kept: string[] = []
  const same = {
    phone: (a: string, b: string) => normalizePhoneKey(a) === normalizePhoneKey(b),
    email: (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase(),
    address: (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()
  }
  for (const key of ['phone', 'email', 'address'] as const) {
    const next = (typed[key] || '').trim()
    if (!next) continue
    const current = (row[key] || '').trim()
    if (current && same[key](current, next)) continue
    patch[key] = key === 'email' ? next.toLowerCase() : next
    if (current) kept.push(`Other ${key}: ${current}`)
  }
  if (Object.keys(patch).length === 0) return
  const notes = (row.notes || '').trim()
  const added = kept.filter((line) => !notes.includes(line))
  if (added.length) patch.notes = [notes, added.join('\n')].filter(Boolean).join('\n\n')
  const { data: updated, error: upErr } = await supabase.from('fh_clients').update(patch).eq('id', clientId).select('id')
  if (upErr || !updated?.length) throw new Error("Couldn't save the phone and address to this client. Check your connection and try again.")
  void queryClient.invalidateQueries({ queryKey: ['clients'] })
}

/**
 * What would be lost with this client. Leads and quotes are deleted with
 * their client (with their lines, versions and customer links) and
 * invoices lose it, so a client that has any of them is not deleted.
 * Throws when the counts cannot be read, so nothing is deleted unchecked.
 */
export async function clientDeleteBlockers(clientId: string): Promise<{ leads: number; quotes: number; invoices: number }> {
  const count = async (table: 'fh_leads' | 'fh_quotes' | 'fh_invoices') => {
    const { count: n, error } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq('client_id', clientId)
    if (error || n === null) throw new Error("Couldn't check this client's records. Check your connection and try again.")
    return n
  }
  const [leads, quotes, invoices] = await Promise.all([count('fh_leads'), count('fh_quotes'), count('fh_invoices')])
  return { leads, quotes, invoices }
}

/** "1 lead, 2 quotes and 3 invoices" for the counts that are not zero. */
export function describeDeleteBlockers(b: { leads: number; quotes: number; invoices: number }): string {
  const parts = ([[b.leads, 'lead'], [b.quotes, 'quote'], [b.invoices, 'invoice']] as const)
    .filter(([n]) => n > 0)
    .map(([n, noun]) => `${n} ${noun}${n === 1 ? '' : 's'}`)
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** True for something shaped like an email address (one @, a dot after it, no spaces). */
export function isEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim())
}
