// src/lib/clients.ts
//
// Find-or-create an fh_clients row for a lead/job, matching on
// phone → email → name (most-recent) before inserting. Shared by
// NewLeadSheet and Universal Capture so every path that creates a lead
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

/**
 * Pass the viewer's org id to match against the whole org's clients (a
 * teammate's client is the same customer); without it the lookup stays
 * on the user's own rows as before.
 */
export async function findOrCreateClient(
  userId: string | undefined,
  fields: { name?: string | null; phone?: string | null; email?: string | null; address?: string | null; company?: string | null },
  orgId?: string | null
): Promise<string | null> {
  if (!userId) return null
  const name = (fields.name || '').trim()
  const phone = (fields.phone || '').trim()
  const email = (fields.email || '').trim().toLowerCase()
  const phoneKey = normalizePhoneKey(phone)
  const clients = () => {
    const q = supabase.from('fh_clients').select('id, name, phone, email')
    return orgId ? q.eq('org_id', orgId) : q.eq('user_id', userId)
  }
  try {
    let existing: string | null = null
    if (phoneKey) {
      const { data, error } = await clients()
        .ilike('phone', phoneLikePattern(phoneKey))
        .order('created_at', { ascending: false })
        .limit(CANDIDATES)
      if (error) throw error
      existing = (data ?? []).find((c) => normalizePhoneKey(c.phone) === phoneKey)?.id ?? null
    }
    if (!existing && email) {
      const { data, error } = await clients()
        .ilike('email', escapeLike(email))
        .order('created_at', { ascending: false })
        .limit(CANDIDATES)
      if (error) throw error
      existing = (data ?? []).find((c) => sameText(c.email, email))?.id ?? null
    }
    if (!existing && name) {
      const { data, error } = await clients()
        .ilike('name', escapeLike(name))
        .order('created_at', { ascending: false })
        .limit(CANDIDATES)
      if (error) throw error
      existing = (data ?? []).find((c) => sameText(c.name, name))?.id ?? null
    }
    if (existing) return existing
    if (!name) return null // don't create a nameless client
    const company = (fields.company || '').trim()
    const { data: created } = await supabase.from('fh_clients').insert({
      user_id: userId,
      ...(orgId ? { org_id: orgId } : {}),
      name,
      phone: phone || null,
      email: email || null,
      address: fields.address || null,
      company_name: company || null
    }).select('id').single()
    // Every caller (new lead, capture, picker) should see the new client in
    // the Clients list without a reload. Prefix match covers every scope.
    if (created?.id) void queryClient.invalidateQueries({ queryKey: ['clients'] })
    return created?.id || null
  } catch (e) {
    // Non-fatal, caller proceeds with a null client_id.
    console.warn('[clients] findOrCreateClient failed', e)
    return null
  }
}
