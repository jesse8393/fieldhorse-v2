// Netlify Function — POST /api/docusign-webhook
//
// Receives DocuSign Connect events (configure a Connect webhook in the
// DocuSign admin pointing here, JSON SIM format). On each event we map
// the envelope status to our enum and update the matching
// fh_esign_envelopes row. When an envelope completes we also flip the
// job's proposal_status to 'approved' and notify the contractor.
//
// Security: DocuSign Connect sends an HMAC signature header
// (X-DocuSign-Signature-1) when an HMAC key is configured.
//
//   • If DOCUSIGN_CONNECT_HMAC_KEY is set we always verify — a
//     mismatch is 401 regardless of mode.
//   • Enforcement of the key itself (rejecting unsigned events when
//     the key is absent) is opt-in via DOCUSIGN_REQUIRE_HMAC=1. This
//     keeps the merge cost-free: the verification code ships now, and
//     you flip enforcement on later by setting two env vars
//     (DOCUSIGN_CONNECT_HMAC_KEY + DOCUSIGN_REQUIRE_HMAC=1) after
//     configuring DocuSign Connect HMAC signing.
//   • Default (REQUIRE_HMAC unset) accepts unsigned events but logs
//     loudly so the warning shows up in monitoring — you'll notice if
//     it gets noisy.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//      DOCUSIGN_CONNECT_HMAC_KEY (optional; required iff REQUIRE_HMAC=1),
//      DOCUSIGN_REQUIRE_HMAC (optional opt-in to enforce)

import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const STATUS_MAP = {
  sent: 'sent',
  delivered: 'delivered',
  completed: 'completed',
  declined: 'declined',
  voided: 'voided'
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
  } else {
    // Default mode: accept but warn. Forged-event risk remains until
    // the operator configures DocuSign Connect HMAC + sets both env
    // vars (DOCUSIGN_CONNECT_HMAC_KEY + DOCUSIGN_REQUIRE_HMAC=1).
    console.warn('[docusign-webhook] accepting UNSIGNED payload (HMAC enforcement disabled)', {
      context: process.env.CONTEXT || 'unknown'
    })
  }

  let payload
  try { payload = JSON.parse(raw) } catch { return new Response('invalid_json', { status: 400 }) }

  // DocuSign JSON SIM payload shape: { event, data: { envelopeId, envelopeSummary: { status } } }
  const envelopeId = payload?.data?.envelopeId || payload?.envelopeId
  const rawStatus = (payload?.data?.envelopeSummary?.status || payload?.status || '').toLowerCase()
  if (!envelopeId) return new Response('no_envelope_id', { status: 400 })

  const status = STATUS_MAP[rawStatus] || 'sent'

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: env } = await supabase
    .from('fh_esign_envelopes')
    .select('id, user_id, contact_id, recipient_name, status')
    .eq('envelope_id', envelopeId)
    .maybeSingle()
  if (!env) {
    // Ack so DocuSign stops retrying, but log: if envelopes routinely
    // arrive for IDs we don't have on file, docusign-send.js audit
    // inserts are failing and we wouldn't otherwise notice.
    console.warn('[docusign-webhook] envelope_id not found in fh_esign_envelopes', { envelopeId })
    return new Response('ok', { status: 200 })
  }

  const patch = { status }
  if (status === 'completed') patch.completed_at = new Date().toISOString()
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
    // Lock the proposal as approved + notify the contractor.
    const { error: contactUpdErr } = await supabase
      .from('fh_contacts')
      .update({ proposal_status: 'approved' })
      .eq('id', env.contact_id)
      .eq('user_id', env.user_id)
    if (contactUpdErr) {
      console.error('[docusign-webhook] fh_contacts proposal_status update failed', {
        contact_id: env.contact_id, error: contactUpdErr
      })
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
