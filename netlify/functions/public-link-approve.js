// Netlify Function — POST /api/public-link-approve
//
// Customer-side proposal approval through the /p/:token public link.
// Mirrors the operator-side fn_approve_quote_version RPC, but runs with
// the service-role key so the unauthenticated customer can complete it.
// The RPC itself is gated on auth.uid() === p_user_id; from a public
// surface there is no auth.uid(), so we do the inline writes here.
//
// Auth model:
//   - The token IS the auth. We resolve fh_public_links by token, reject
//     revoked / expired / non-proposal links, and use the link.user_id
//     for every downstream write so the customer can't cross tenants.
//
// Side effects:
//   1. INSERT fh_quote_versions { status='approved', client_ip,
//      client_user_agent, approval_method='esign_link', signature_kind,
//      signature_data, snapshot }
//   2. UPDATE prior 'approved' rows for the same contact → 'superseded'
//   3. UPDATE fh_contacts SET approved_quote_version_id, proposal_status='approved'
//   4. INSERT fh_notifications { kind='quote_approved' } for the
//      contractor's bell.
//
// Idempotency: if proposal_status is already 'approved', returns 409
// so a customer double-tap doesn't double-write a version row.

import { createClient } from '@supabase/supabase-js'
import { hashIdentifier, checkRateLimit } from './lib/rateLimit.js'
import { sendPushToUser } from './lib/push.js'

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  })
}

function clientIp(req) {
  return (
    req.headers.get('x-nf-client-connection-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    null
  )
}

function moneyFmt(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  })
}

function quoteNumberFor(id) {
  if (!id) return null
  return `Q-${String(id).slice(0, 8).toUpperCase()}`
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  let body = {}
  try { body = await req.json() } catch { /* tolerate empty body */ }

  const token = String(body?.token || '').trim()
  const signatureName = String(body?.signature_name || '').trim()
  const approvalNote = String(body?.note || '').trim() || null
  if (!token) return json({ error: 'missing_token' }, 400)
  if (!signatureName) return json({ error: 'missing_signature_name' }, 400)
  if (signatureName.length > 200) return json({ error: 'name_too_long' }, 400)

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'server_misconfigured' }, 500)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  // Per-IP rate limit — this is a binding write (records an approval /
  // signature), so keep it tight to slow signature-spraying.
  const allowed = await checkRateLimit(supabase, {
    scope: 'public-link-approve', identifier: hashIdentifier(clientIp(req)), limit: 20,
  })
  if (!allowed) {
    return json({ error: 'rate_limited', message: 'Too many requests. Please try again in a minute.' }, 429)
  }

  // 1. Resolve token → link → contact
  const { data: link } = await supabase
    .from('fh_public_links')
    .select('*')
    .eq('token', token)
    .maybeSingle()
  if (!link) return json({ error: 'not_found' }, 404)
  if (link.revoked_at) return json({ error: 'revoked' }, 410)
  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return json({ error: 'expired' }, 410)
  }
  if (link.kind !== 'proposal') {
    return json({ error: 'not_approvable', message: 'Only proposals can be approved via this link.' }, 400)
  }

  const { data: contact } = await supabase
    .from('fh_contacts')
    .select('*')
    .eq('id', link.contact_id)
    .eq('user_id', link.user_id)
    .maybeSingle()
  if (!contact) return json({ error: 'gone' }, 404)
  if ((contact.proposal_status || 'draft').toLowerCase() === 'approved') {
    return json({ error: 'already_approved', message: 'This proposal has already been approved.' }, 409)
  }

  // 2. Snapshot the live items + the profile branding so the approved
  //    version is independent of future edits.
  const [{ data: items }, { data: profile }] = await Promise.all([
    supabase
      .from('fh_quote_items')
      .select('*')
      .eq('contact_id', contact.id)
      .order('sort_order', { ascending: true }),
    supabase
      .from('profiles')
      .select('*')
      .eq('user_id', link.user_id)
      .maybeSingle()
  ])
  const itemRows = items || []
  if (itemRows.length === 0) {
    return json({ error: 'empty_proposal', message: 'This proposal has no line items to approve.' }, 400)
  }

  const company = profile ? {
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

  let baseTotal = 0
  let optionalTotal = 0
  let excludedCount = 0
  const snapItems = itemRows.map((i) => {
    const amt = Number(i.amount || 0)
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

  const snapshot = {
    quote_number: quoteNumberFor(contact.id),
    snapshot_taken_at: new Date().toISOString(),
    company,
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
    items: snapItems,
    totals: { base: baseTotal, optional: optionalTotal, excluded_count: excludedCount },
    approval_origin: 'public_link'
  }

  // 3. Compute next version_number per contact.
  const { data: maxRow } = await supabase
    .from('fh_quote_versions')
    .select('version_number')
    .eq('contact_id', contact.id)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextVersion = (maxRow?.version_number || 0) + 1

  const ip = clientIp(req)
  const ua = req.headers.get('user-agent') || null

  // 4. Insert the approved version row.
  const { data: newRow, error: insErr } = await supabase
    .from('fh_quote_versions')
    .insert({
      user_id: link.user_id,
      contact_id: contact.id,
      version_number: nextVersion,
      status: 'approved',
      snapshot,
      base_total: baseTotal,
      optional_total: optionalTotal,
      excluded_count: excludedCount,
      approval_method: 'esign_link',
      approved_by_name: signatureName,
      approved_by_email: contact.email || null,
      approval_note: approvalNote,
      signature_kind: 'typed',
      signature_data: signatureName,
      client_ip: ip,
      client_user_agent: ua
    })
    .select('id, version_number, created_at')
    .single()
  if (insErr) {
    console.error('[public-link-approve] insert failed', insErr)
    return json({ error: 'db_insert_failed', detail: insErr.message }, 500)
  }

  // 5. Supersede prior approved rows (best effort, never blocks).
  await supabase
    .from('fh_quote_versions')
    .update({ status: 'superseded', superseded_at: new Date().toISOString(), superseded_by: newRow.id })
    .eq('contact_id', contact.id)
    .neq('id', newRow.id)
    .eq('status', 'approved')

  // 6. Point contact + flip proposal_status.
  const { error: upErr } = await supabase
    .from('fh_contacts')
    .update({
      approved_quote_version_id: newRow.id,
      proposal_status: 'approved'
    })
    .eq('id', contact.id)
  if (upErr) {
    console.error('[public-link-approve] contact update failed', upErr)
  }

  // 7. Notification to the contractor's bell + lock screen.
  try {
    await supabase.from('fh_notifications').insert({
      user_id: link.user_id,
      kind: 'quote_approved',
      title: `Quote approved · ${moneyFmt(baseTotal)}`,
      body: `${signatureName} signed${contact.name ? ` for ${contact.name}` : ''}`,
      link: `/jobs/${contact.id}`
    })
  } catch (e) {
    console.warn('[public-link-approve] notification insert failed', e)
  }
  await sendPushToUser(supabase, link.user_id, {
    title: `Quote approved · ${moneyFmt(baseTotal)} 🎉`,
    body: `${signatureName} signed${contact.name ? ` for ${contact.name}` : ''}`,
    link: `/jobs/${contact.id}`,
    tag: `quote-approved-${contact.id}`
  })

  return json({
    ok: true,
    version_number: newRow.version_number,
    approved_at: newRow.created_at,
    signed_by: signatureName
  })
}

export const config = { path: '/api/public-link-approve' }
