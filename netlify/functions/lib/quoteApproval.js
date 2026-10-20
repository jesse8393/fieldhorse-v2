// netlify/functions/lib/quoteApproval.js
//
// What the customer facing functions share once a link points at a quote
// record (fh_quotes, PHASE9_PLAN Task 11) instead of a job: loading the
// quote and its client inside the link's company, the snapshot of its
// lines, and recording an approved fh_quote_versions row by quote id.
// public-link.js, public-link-approve.js and docusign-webhook.js all use
// these so the three paths record the same thing.

import { linkScope } from './linkScope.js'
import { proposalNumber } from './docNumbers.js'

/** Quote statuses that take no approval from an old link. */
export const CLOSED_QUOTE_STATUSES = new Set(['lost', 'rejected'])

/**
 * The quote a link points at, with its client, scoped to the link's
 * company so a mis-minted token never reaches another tenant's quote.
 * Returns { quote, client } with either null when it is not there.
 */
export async function loadQuoteForLink(supabase, link) {
  if (!link?.quote_id) return { quote: null, client: null }
  const { data: quote } = await supabase
    .from('fh_quotes')
    .select('*')
    .eq('id', link.quote_id)
    .match(linkScope(link))
    .maybeSingle()
  if (!quote) return { quote: null, client: null }
  const { data: client } = await supabase
    .from('fh_clients')
    .select('id, name, company_name, phone, email, address, org_id')
    .eq('id', quote.client_id)
    .maybeSingle()
  return { quote, client: client || null }
}

/**
 * The lines as the approved version stores them, with the totals the
 * document printed. Same qty x rate fallback every renderer applies, so an
 * item stored with a null amount counts what the customer saw.
 */
export function snapshotItems(itemRows) {
  let baseTotal = 0
  let optionalTotal = 0
  let excludedCount = 0
  const items = (itemRows || []).map((i) => {
    const amt = i.amount != null
      ? Number(i.amount || 0)
      : Number(i.qty || 0) * Number(i.rate || 0)
    if (i.is_excluded) excludedCount += 1
    else if (i.is_optional) optionalTotal += amt
    else baseTotal += amt
    return {
      section: i.section || null,
      description: i.description,
      qty: Number(i.qty || 0),
      unit: i.unit || null,
      rate: Number(i.rate || 0),
      amount: amt,
      notes: i.notes || null,
      is_optional: !!i.is_optional,
      is_excluded: !!i.is_excluded,
      sort_order: Number(i.sort_order || 0)
    }
  })
  return { items, baseTotal, optionalTotal, excludedCount }
}

/** The company block an approval snapshot keeps. */
export function snapshotCompany(profile) {
  return profile ? {
    name: profile.company_name || profile.full_name || 'My Company',
    address: profile.company_address || '',
    phone: profile.company_phone || '',
    email: profile.company_email || profile.email || '',
    website: profile.company_website || '',
    logo_url: profile.logo_url || null,
    brand_accent_hex: profile.brand_accent_hex || null,
    license_number: profile.license_number || '',
    insured_text: profile.insured_text || '',
    warranty_default: profile.warranty_default || ''
  } : { name: 'My Company' }
}

/**
 * The snapshot of a quote at approval: the number printed on the document
 * (seeded by the quote id), the company, the client the quote is for, its
 * scope and terms, the lines and totals. `extra` adds the origin specific
 * fields (approval_origin, docusign).
 */
export function buildQuoteSnapshot({ quote, client, company, snap, takenAt, extra = {} }) {
  return {
    quote_number: proposalNumber(company.name, quote.id, quote.sent_at || quote.created_at),
    snapshot_taken_at: takenAt,
    company,
    quote: {
      id: quote.id,
      title: quote.title || null,
      job_type: quote.job_type || null
    },
    contact: {
      id: quote.id,
      name: client?.name || null,
      address: client?.address || null,
      phone: client?.phone || null,
      email: client?.email || null,
      job_title: quote.title || null
    },
    scope_text: quote.scope_text || null,
    terms_text: quote.terms_text || null,
    exclusions_text: quote.exclusions_text || null,
    quote_expires_at: quote.expires_at || null,
    items: snap.items,
    totals: { base: snap.baseTotal, optional: snap.optionalTotal, excluded_count: snap.excludedCount },
    ...extra
  }
}

/**
 * Claim the approval atomically: only the request that flips
 * fh_quotes.status to approved proceeds, so a double tap or a DocuSign
 * completion racing the link records one version and one notification.
 * Returns { claimed: true }, { claimed: false } when already approved, or
 * { error }.
 */
export async function claimQuoteApproval(supabase, quote) {
  const { data: claimed, error } = await supabase
    .from('fh_quotes')
    .update({ status: 'approved' })
    .eq('id', quote.id)
    .neq('status', 'approved')
    .select('id')
  if (error) return { error }
  return { claimed: Boolean(claimed && claimed.length > 0) }
}

export async function releaseQuoteClaim(supabase, quote) {
  const { error } = await supabase
    .from('fh_quotes')
    .update({ status: quote.status || 'sent' })
    .eq('id', quote.id)
    .eq('status', 'approved')
  if (error) console.error('[quoteApproval] claim release failed', error)
}

/**
 * Insert the approved version for a quote (numbered per quote), supersede
 * the quote's earlier approved versions and point fh_quotes at the new row.
 * `fields` holds the approval columns (approval_method, approved_by_name,
 * approved_by_email, approval_note, signature_kind, signature_data,
 * client_ip, client_user_agent, approved_at). Returns { row } or { error }.
 */
export async function recordQuoteVersion(supabase, { quote, userId, snapshot, snap, fields }) {
  const { data: maxRow } = await supabase
    .from('fh_quote_versions')
    .select('version_number')
    .eq('quote_id', quote.id)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextVersion = (maxRow?.version_number || 0) + 1

  const { data: row, error } = await supabase
    .from('fh_quote_versions')
    .insert({
      user_id: userId,
      org_id: quote.org_id || null,
      quote_id: quote.id,
      // A quote has no job until Make this a job; the version hangs off
      // the quote alone.
      contact_id: null,
      version_number: nextVersion,
      status: 'approved',
      snapshot,
      base_total: snap.baseTotal,
      optional_total: snap.optionalTotal,
      excluded_count: snap.excludedCount,
      ...fields
    })
    .select('id, version_number, created_at')
    .single()
  if (error || !row) return { error: error || new Error('no row') }

  const supersededAt = new Date().toISOString()
  const { error: supersedeErr } = await supabase
    .from('fh_quote_versions')
    .update({ status: 'superseded', superseded_at: supersededAt, superseded_by: row.id })
    .eq('quote_id', quote.id)
    .neq('id', row.id)
    .eq('status', 'approved')
  if (supersedeErr) console.error('[quoteApproval] supersede of earlier versions failed', { quote_id: quote.id, error: supersedeErr })

  const { error: pointErr } = await supabase
    .from('fh_quotes')
    .update({ approved_version_id: row.id })
    .eq('id', quote.id)
  if (pointErr) console.error('[quoteApproval] approved_version_id update failed', { quote_id: quote.id, error: pointErr })

  return { row }
}
