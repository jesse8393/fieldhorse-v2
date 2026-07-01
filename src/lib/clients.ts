// src/lib/clients.ts
//
// Find-or-create an fh_clients row for a lead/job, matching on
// phone → email → name (most-recent) before inserting. Shared by
// NewLeadSheet and Universal Capture so every path that creates a lead
// links a client — otherwise voice/scan leads were orphans with no
// client record (invisible on /clients, and no client email to invoice
// against later).

import { supabase } from './supabase.ts'

export async function findOrCreateClient(
  userId: string | undefined,
  fields: { name?: string | null; phone?: string | null; email?: string | null; address?: string | null; company?: string | null }
): Promise<string | null> {
  if (!userId) return null
  const name = (fields.name || '').trim()
  const phone = (fields.phone || '').trim()
  const email = (fields.email || '').trim().toLowerCase()
  try {
    let existing: { id: string } | null = null
    if (phone) {
      const { data } = await supabase.from('fh_clients').select('id').eq('user_id', userId).eq('phone', phone).maybeSingle()
      existing = data as any
    }
    if (!existing && email) {
      const { data } = await supabase.from('fh_clients').select('id').eq('user_id', userId).ilike('email', email).maybeSingle()
      existing = data as any
    }
    if (!existing && name) {
      const { data } = await supabase.from('fh_clients').select('id').eq('user_id', userId).ilike('name', name)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      existing = data as any
    }
    if (existing) return existing.id
    if (!name) return null // don't create a nameless client
    const company = (fields.company || '').trim()
    const { data: created } = await supabase.from('fh_clients').insert({
      user_id: userId,
      name,
      phone: phone || null,
      email: email || null,
      address: fields.address || null,
      company_name: company || null
    }).select('id').single()
    return created?.id || null
  } catch (e) {
    // Non-fatal — caller proceeds with a null client_id.
    console.warn('[clients] findOrCreateClient failed', e)
    return null
  }
}
