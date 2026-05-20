// Netlify Function — POST /api/docusign-webhook
//
// Receives DocuSign Connect events (configure a Connect webhook in the
// DocuSign admin pointing here, JSON SIM format). On each event we map
// the envelope status to our enum and update the matching
// fh_esign_envelopes row. When an envelope completes we also flip the
// job's proposal_status to 'approved' and notify the contractor.
//
// Security: DocuSign Connect can send an HMAC signature header
// (X-DocuSign-Signature-1) when an HMAC key is configured. If
// DOCUSIGN_CONNECT_HMAC_KEY is set we verify it; otherwise we accept
// the payload (the envelope_id is an unguessable GUID, but configuring
// HMAC is strongly recommended for production).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DOCUSIGN_CONNECT_HMAC_KEY (optional)

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

  // Optional HMAC verification.
  const hmacKey = process.env.DOCUSIGN_CONNECT_HMAC_KEY
  if (hmacKey) {
    const sig = request.headers.get('x-docusign-signature-1') || ''
    const computed = crypto.createHmac('sha256', hmacKey).update(raw, 'utf8').digest('base64')
    if (!safeEqual(sig, computed)) {
      return new Response('bad_signature', { status: 401 })
    }
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
  if (!env) return new Response('ok', { status: 200 }) // unknown envelope — ack so DocuSign stops retrying

  const patch = { status }
  if (status === 'completed') patch.completed_at = new Date().toISOString()
  await supabase.from('fh_esign_envelopes').update(patch).eq('id', env.id)

  if (status === 'completed' && env.status !== 'completed') {
    // Lock the proposal as approved + notify the contractor.
    await supabase
      .from('fh_contacts')
      .update({ proposal_status: 'approved' })
      .eq('id', env.contact_id)
      .eq('user_id', env.user_id)
    try {
      await supabase.from('fh_notifications').insert({
        user_id: env.user_id,
        kind: 'quote_approved',
        title: 'Proposal signed',
        body: `${env.recipient_name || 'The customer'} signed via DocuSign`,
        link: `/jobs/${env.contact_id}`
      })
    } catch (e) {
      console.warn('[docusign-webhook] notification insert failed', e)
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
