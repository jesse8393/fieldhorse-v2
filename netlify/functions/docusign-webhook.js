// Netlify Function — POST /api/docusign-webhook
//
// Receives DocuSign Connect events (configure a Connect webhook in the
// DocuSign admin pointing here, JSON SIM format). On each event we map
// the envelope status to our enum and update the matching
// fh_esign_envelopes row. When an envelope completes we also record the
// approval (proposal_status 'approved' plus an fh_quote_versions snapshot,
// see recordDocusignApproval) and notify the contractor.
//
// Security: DocuSign Connect sends an HMAC signature header
// (X-DocuSign-Signature-1) when an HMAC key is configured.
//
//   * DOCUSIGN_CONNECT_HMAC_KEY set: every event is verified, and a
//     missing or wrong signature gets 401 bad_signature.
//   * Key not set: events are rejected by default with 401
//     hmac_not_configured. Without a signature, anyone who knows an
//     envelope id could post a forged "completed" event.
//   * DOCUSIGN_ALLOW_UNSIGNED=1 opts out while Connect HMAC is not set up
//     yet: unsigned events are accepted and a warning is logged. Events
//     can then be forged, so set the key as soon as possible.
//   * DOCUSIGN_REQUIRE_HMAC=1 turns a missing key into 500
//     hmac_key_missing, even when DOCUSIGN_ALLOW_UNSIGNED=1 is set.
//
// Env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
//      DOCUSIGN_CONNECT_HMAC_KEY (needed to accept events),
//      DOCUSIGN_ALLOW_UNSIGNED (optional, not recommended),
//      DOCUSIGN_REQUIRE_HMAC (optional)

import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { brandingUserIdFor } from './lib/orgAccess.js'
import { proposalNumber } from './lib/docNumbers.js'

const STATUS_MAP = {
  sent: 'sent',
  delivered: 'delivered',
  completed: 'completed',
  declined: 'declined',
  voided: 'voided'
}

// Envelope status only moves forward. DocuSign Connect retries and can
// deliver events out of order, and it sends event types this function does
// not map; the old code wrote 'sent' for anything unknown, so a late or
// retried event could regress a completed envelope back to 'sent'.
const STATUS_RANK = { sent: 1, delivered: 2, completed: 3, declined: 3, voided: 3 }

/** Returns the status to store, or null when the event must not change it. */
export function nextEnvelopeStatus(currentStatus, rawStatus) {
  const incoming = STATUS_MAP[String(rawStatus || '').toLowerCase()]
  if (!incoming) return null
  const current = String(currentStatus || '').toLowerCase()
  const currentRank = STATUS_RANK[current] || 0
  if (currentRank >= 3) return null          // terminal: completed, declined, voided
  if (STATUS_RANK[incoming] <= currentRank) return null
  return incoming
}

/**
 * The customer signed the envelope: record the approval the way
 * public-link-approve.js and the operator's fn_approve_quote_version do, so
 * the job keeps an immutable snapshot of the approved items and totals in
 * fh_quote_versions and points at it through approved_quote_version_id.
 * Before this only proposal_status flipped, which left no in-app record of
 * what was signed, an empty approval history and blank signature lines on
 * the approved document, while later line item edits kept changing the
 * job's amount.
 *
 * `env` is the fh_esign_envelopes row. Returns { ok, versionId } or
 * { ok, skipped } and never throws on a database error (it logs instead),
 * so the webhook still acknowledges the event.
 */
export async function recordDocusignApproval(supabase, env, envelopeId, now = new Date()) {
  const { data: contact, error: contactErr } = await supabase
    .from('fh_contacts')
    .select('*')
    .eq('id', env.contact_id)
    .maybeSingle()
  if (contactErr || !contact) {
    console.error('[docusign-webhook] contact lookup failed', { contact_id: env.contact_id, error: contactErr })
    return { ok: false, skipped: 'contact_not_found' }
  }

  // Claim the approval before writing anything else, like
  // public-link-approve.js: of two overlapping deliveries, or a DocuSign
  // completion racing an approval through the secure link, exactly one
  // proceeds. The update is keyed on the job alone. docusign-send checked
  // the sender's access to this job when it created the envelope row, and
  // the old filter on the sender's user id silently skipped every job a
  // teammate had created.
  const { data: claimed, error: claimErr } = await supabase
    .from('fh_contacts')
    .update({ proposal_status: 'approved' })
    .eq('id', contact.id)
    .or('proposal_status.is.null,proposal_status.neq.approved')
    .select('id')
  if (claimErr) {
    console.error('[docusign-webhook] fh_contacts proposal_status update failed', { contact_id: contact.id, error: claimErr })
    return { ok: false, skipped: 'claim_failed' }
  }
  if (!claimed || claimed.length === 0) {
    // Already approved through another path; keep that approval record.
    return { ok: true, skipped: 'already_approved' }
  }

  // Snapshot the live items and the company branding so the approved
  // version does not change with later edits.
  const brandingUserId = (await brandingUserIdFor(supabase, contact)) || env.user_id
  const [{ data: items, error: itemsErr }, { data: profile }] = await Promise.all([
    supabase
      .from('fh_quote_items')
      .select('*')
      .eq('contact_id', contact.id)
      .order('sort_order', { ascending: true }),
    supabase
      .from('profiles')
      .select('*')
      .eq('user_id', brandingUserId)
      .maybeSingle()
  ])
  if (itemsErr) console.error('[docusign-webhook] fh_quote_items lookup failed', { contact_id: contact.id, error: itemsErr })

  let baseTotal = 0
  let optionalTotal = 0
  let excludedCount = 0
  const snapItems = (items || []).map((i) => {
    // Same qty x rate fallback every renderer applies.
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

  const approvedAt = now.toISOString()
  const signerName = String(env.recipient_name || '').trim() || String(contact.name || '').trim() || 'Customer'
  const snapshot = {
    // The number printed on the proposal (src/components/documents/numbers.ts).
    quote_number: proposalNumber(
      profile ? (profile.company_name || profile.full_name || 'My Company') : 'My Company',
      contact.id,
      contact.quote_sent_at || contact.created_at
    ),
    snapshot_taken_at: approvedAt,
    company: profile ? {
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
    } : { name: 'My Company' },
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
    approval_origin: 'docusign',
    docusign: { envelope_id: envelopeId, sent_at: env.sent_at || null, completed_at: approvedAt }
  }

  const { data: maxRow } = await supabase
    .from('fh_quote_versions')
    .select('version_number')
    .eq('contact_id', contact.id)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextVersion = (maxRow?.version_number || 0) + 1

  const { data: newRow, error: insErr } = await supabase
    .from('fh_quote_versions')
    .insert({
      user_id: env.user_id,
      contact_id: contact.id,
      version_number: nextVersion,
      status: 'approved',
      snapshot,
      base_total: baseTotal,
      optional_total: optionalTotal,
      excluded_count: excludedCount,
      // fh_quote_versions_approval_method_check has no DocuSign value yet;
      // 'esign_link' (the customer signing electronically through a link
      // sent to them) is the closest allowed method, and the snapshot's
      // approval_origin plus the note name DocuSign and the envelope.
      approval_method: 'esign_link',
      approved_by_name: signerName,
      approved_by_email: env.recipient_email || contact.email || null,
      approval_note: `Signed through DocuSign, envelope ${envelopeId}`,
      signature_kind: null,
      signature_data: null,
      approved_at: approvedAt
    })
    .select('id')
    .single()
  if (insErr || !newRow) {
    // The customer did sign, so the job stays approved; the signed
    // envelope at DocuSign remains the record.
    console.error('[docusign-webhook] fh_quote_versions insert failed', { contact_id: contact.id, envelope_id: envelopeId, error: insErr })
    return { ok: false, skipped: 'version_insert_failed' }
  }

  const { error: supersedeErr } = await supabase
    .from('fh_quote_versions')
    .update({ status: 'superseded', superseded_at: approvedAt, superseded_by: newRow.id })
    .eq('contact_id', contact.id)
    .neq('id', newRow.id)
    .eq('status', 'approved')
  if (supersedeErr) console.error('[docusign-webhook] supersede of earlier versions failed', { contact_id: contact.id, error: supersedeErr })

  const { error: pointErr } = await supabase
    .from('fh_contacts')
    .update({ approved_quote_version_id: newRow.id })
    .eq('id', contact.id)
  if (pointErr) console.error('[docusign-webhook] approved_quote_version_id update failed', { contact_id: contact.id, error: pointErr })

  return { ok: true, versionId: newRow.id }
}

export default async (request) => {
  if (request.method !== 'POST') return new Response('method_not_allowed', { status: 405 })

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) return new Response('server_misconfigured', { status: 500 })

  const raw = await request.text()

  // HMAC verification.
  const hmacKey = process.env.DOCUSIGN_CONNECT_HMAC_KEY
  const requireHmac = process.env.DOCUSIGN_REQUIRE_HMAC === '1'

  if (hmacKey) {
    const sig = request.headers.get('x-docusign-signature-1') || ''
    const computed = crypto.createHmac('sha256', hmacKey).update(raw, 'utf8').digest('base64')
    if (!safeEqual(sig, computed)) {
      console.error('[docusign-webhook] HMAC signature mismatch', {
        sig_present: Boolean(sig),
        sig_len: sig.length
      })
      return new Response('bad_signature', { status: 401 })
    }
  } else if (requireHmac) {
    // Enforcement explicitly turned on but the key is missing — refuse
    // to silently accept forged events. Operator needs to set
    // DOCUSIGN_CONNECT_HMAC_KEY too.
    console.error('[docusign-webhook] DOCUSIGN_REQUIRE_HMAC=1 but DOCUSIGN_CONNECT_HMAC_KEY is missing — rejecting')
    return new Response('hmac_key_missing', { status: 500 })
  } else if (process.env.DOCUSIGN_ALLOW_UNSIGNED === '1') {
    // Explicit opt-out for deployments that haven't provisioned DocuSign
    // Connect HMAC yet. Forged-event risk remains — set
    // DOCUSIGN_CONNECT_HMAC_KEY as soon as possible.
    console.warn('[docusign-webhook] accepting UNSIGNED payload (DOCUSIGN_ALLOW_UNSIGNED=1)', {
      context: process.env.CONTEXT || 'unknown'
    })
  } else {
    // Fail-closed default: without a configured HMAC key, an attacker who
    // knows an envelopeId could POST a forged "completed" event and flip a
    // proposal to approved. Reject until Connect HMAC is configured (or the
    // operator explicitly sets DOCUSIGN_ALLOW_UNSIGNED=1).
    console.error('[docusign-webhook] rejecting UNSIGNED payload — set DOCUSIGN_CONNECT_HMAC_KEY (or DOCUSIGN_ALLOW_UNSIGNED=1 to opt out)')
    return new Response('hmac_not_configured', { status: 401 })
  }

  let payload
  try { payload = JSON.parse(raw) } catch { return new Response('invalid_json', { status: 400 }) }

  // DocuSign JSON SIM payload shape: { event, data: { envelopeId, envelopeSummary: { status } } }
  const envelopeId = payload?.data?.envelopeId || payload?.envelopeId
  const rawStatus = (payload?.data?.envelopeSummary?.status || payload?.status || '').toLowerCase()
  if (!envelopeId) return new Response('no_envelope_id', { status: 400 })

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: env } = await supabase
    .from('fh_esign_envelopes')
    .select('id, user_id, contact_id, recipient_name, recipient_email, status, sent_at')
    .eq('envelope_id', envelopeId)
    .maybeSingle()
  if (!env) {
    // Ack so DocuSign stops retrying, but log: if envelopes routinely
    // arrive for IDs we don't have on file, docusign-send.js audit
    // inserts are failing and we wouldn't otherwise notice.
    console.warn('[docusign-webhook] envelope_id not found in fh_esign_envelopes', { envelopeId })
    return new Response('ok', { status: 200 })
  }

  const status = nextEnvelopeStatus(env.status, rawStatus)
  if (!status) {
    // Unknown, stale or duplicate event: acknowledge so DocuSign stops
    // retrying, change nothing.
    return new Response('ok', { status: 200 })
  }

  const completedAt = new Date()
  const patch = { status }
  if (status === 'completed') patch.completed_at = completedAt.toISOString()
  const { error: envUpdErr } = await supabase
    .from('fh_esign_envelopes')
    .update(patch)
    .eq('id', env.id)
  if (envUpdErr) {
    console.error('[docusign-webhook] fh_esign_envelopes update failed', {
      envelope_row: env.id, status, error: envUpdErr
    })
  }

  if (status === 'completed' && env.status !== 'completed') {
    // Record the approval (proposal status + version snapshot) and notify
    // the contractor. The envelope row is already 'completed', so a retry
    // of this event would be ignored: never let a failure here skip the
    // notification or turn the acknowledgement into a 500.
    try {
      await recordDocusignApproval(supabase, env, envelopeId, completedAt)
    } catch (e) {
      console.error('[docusign-webhook] recording the approval failed', { envelope_id: envelopeId, error: e?.message || e })
    }

    const { error: notifErr } = await supabase.from('fh_notifications').insert({
      user_id: env.user_id,
      kind: 'quote_approved',
      title: 'Proposal signed',
      body: `${env.recipient_name || 'The customer'} signed via DocuSign`,
      link: `/jobs/${env.contact_id}`
    })
    if (notifErr) {
      console.error('[docusign-webhook] notification insert failed', {
        user_id: env.user_id, error: notifErr
      })
    }
  }

  return new Response('ok', { status: 200 })
}

function safeEqual(a, b) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

export const config = { path: '/api/docusign-webhook' }
