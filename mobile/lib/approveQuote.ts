// mobile/lib/approveQuote.ts
//
// Operator-side quote approval. Mirrors the web ApproveQuoteSheet: builds
// an immutable snapshot of the current quote and calls the
// fn_approve_quote_version RPC (migration 013), which inserts a versioned
// fh_quote_versions row (status='approved'), supersedes any prior version,
// flips the contact to approved, and points approved_quote_version_id at it.

import { supabase } from './supabase'
import type { QuoteItem } from './queries'

export type ApprovalMethod = 'verbal' | 'email' | 'in_person' | 'signature_typed' | 'signature_drawn'

export type ApproveInput = {
  userId: string
  contact: {
    id: string
    name?: string | null
    address?: string | null
    phone?: string | null
    email?: string | null
    job_title?: string | null
    scope_text?: string | null
    terms_text?: string | null
    exclusions_text?: string | null
    quote_expires_at?: string | null
  }
  items: QuoteItem[]
  method: ApprovalMethod
  approvedByName: string
  approvedByEmail?: string | null
  note?: string | null
  signatureKind?: 'typed' | 'drawn' | null
  signatureData?: string | null
}

export async function approveQuoteVersion(input: ApproveInput): Promise<{ id: string }> {
  const { contact, items } = input
  let base = 0, optional = 0, excludedCount = 0
  for (const i of items) {
    const amt = Number(i.amount || 0)
    if (i.is_excluded) excludedCount += 1
    else if (i.is_optional) optional += amt
    else base += amt
  }

  const snapshot = {
    snapshot_taken_at: new Date().toISOString(),
    contact: {
      id: contact.id,
      name: contact.name || null,
      address: contact.address || null,
      phone: contact.phone || null,
      email: contact.email || null,
      job_title: contact.job_title || null
    },
    scope_text: contact.scope_text || null,
    terms_text: contact.terms_text || null,
    exclusions_text: contact.exclusions_text || null,
    quote_expires_at: contact.quote_expires_at || null,
    items: items.map((i) => ({
      section: i.section || null,
      description: i.description,
      qty: Number(i.qty || 0),
      unit: i.unit || null,
      rate: Number(i.rate || 0),
      amount: Number(i.amount || 0),
      is_optional: !!i.is_optional,
      is_excluded: !!i.is_excluded,
      sort_order: Number(i.sort_order || 0)
    })),
    totals: { base, optional, excluded_count: excludedCount }
  }

  const isSig = input.method === 'signature_typed' || input.method === 'signature_drawn'
  const sigData = isSig && input.signatureData && String(input.signatureData).trim().length > 0 ? input.signatureData : null

  const { data, error } = await supabase.rpc('fn_approve_quote_version', {
    p_user_id: input.userId,
    p_contact_id: contact.id,
    p_snapshot: snapshot as any,
    p_base_total: base,
    p_optional_total: optional,
    p_excluded_count: excludedCount,
    p_approval_method: input.method,
    p_approved_by_name: input.approvedByName.trim(),
    p_approved_by_email: (input.approvedByEmail || '').trim() || null,
    p_approval_note: (input.note || '').trim() || null,
    p_signature_kind: isSig ? (input.signatureKind || (input.method === 'signature_typed' ? 'typed' : 'drawn')) : null,
    p_signature_data: sigData
  } as any)
  if (error) throw new Error('Approval could not be saved. Please try again.')
  const row: any = Array.isArray(data) ? data[0] : data
  if (!row?.id) throw new Error('Approval did not return a version id.')
  return { id: row.id }
}
