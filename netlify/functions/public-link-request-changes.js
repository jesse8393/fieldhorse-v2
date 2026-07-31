// POST /api/public-link-request-changes
//
// Customer-side quote revision request through a secure proposal link.
// The public token identifies the tenant and quote. The endpoint updates
// the quote lifecycle, preserves the request in job activity, and alerts
// the contractor through the inbox and web push.

import { createClient } from '@supabase/supabase-js'
import { clientIp, hashIdentifier, checkRateLimit } from './lib/rateLimit.js'
import { sendPushToUser } from './lib/push.js'

const MAX_TOKEN_LENGTH = 256
const MAX_NAME_LENGTH = 200
const MAX_REQUEST_LENGTH = 2000

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders()
    }
  })
}

export function parseQuoteChangeRequest(body) {
  const token = String(body?.token || '').trim()
  const requesterName = String(body?.requester_name || '').trim()
  const requestText = String(body?.request_text || '').trim()

  if (!token) return { error: 'missing_token' }
  if (token.length > MAX_TOKEN_LENGTH) return { error: 'invalid_token' }
  if (!requesterName) return { error: 'missing_requester_name' }
  if (requesterName.length > MAX_NAME_LENGTH) return { error: 'name_too_long' }
  if (requestText.length < 3) return { error: 'request_too_short' }
  if (requestText.length > MAX_REQUEST_LENGTH) return { error: 'request_too_long' }

  return {
    value: {
      token,
      requesterName,
      requestText
    }
  }
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const parsed = parseQuoteChangeRequest(body)
  if (parsed.error) return json({ error: parsed.error }, 400)
  const { token, requesterName, requestText } = parsed.value

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'server_misconfigured' }, 500)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  const allowed = await checkRateLimit(supabase, {
    scope: 'public-link-request-changes',
    identifier: hashIdentifier(clientIp(request)),
    limit: 20
  })
  if (!allowed) {
    return json({
      error: 'rate_limited',
      message: 'Too many requests. Please try again in a minute.'
    }, 429)
  }

  const { data: link, error: linkError } = await supabase
    .from('fh_public_links')
    .select('id, user_id, org_id, contact_id, kind, revoked_at, expires_at')
    .eq('token', token)
    .maybeSingle()
  if (linkError) return json({ error: 'link_lookup_failed' }, 500)
  if (!link || link.kind !== 'proposal' || !link.contact_id) {
    return json({ error: 'not_found' }, 404)
  }
  if (link.revoked_at) return json({ error: 'revoked' }, 404)
  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return json({ error: 'expired' }, 404)
  }

  const { data: contact, error: contactError } = await supabase
    .from('fh_contacts')
    .select('id, user_id, org_id, name, job_title, stage, proposal_status, follow_up_on, quote_change_request_note, quote_change_requested_at')
    .eq('id', link.contact_id)
    .eq('user_id', link.user_id)
    .maybeSingle()
  if (contactError) return json({ error: 'contact_lookup_failed' }, 500)
  if (!contact) return json({ error: 'gone' }, 410)

  const status = String(contact.proposal_status || 'draft').toLowerCase()
  if (status === 'approved') return json({ error: 'already_approved' }, 409)
  if (status === 'rejected' || status === 'expired') {
    return json({ error: 'gone' }, 410)
  }
  if (['job', 'invoice', 'closed', 'lost'].includes(String(contact.stage || '').toLowerCase())) {
    return json({ error: 'gone' }, 410)
  }

  const requestedAt = new Date().toISOString()
  const { data: updatedRows, error: updateError } = await supabase
    .from('fh_contacts')
    .update({
      proposal_status: 'changes_requested',
      quote_change_request_note: requestText,
      quote_change_requested_at: requestedAt
    })
    .eq('id', contact.id)
    .eq('user_id', link.user_id)
    .or('proposal_status.is.null,proposal_status.in.(draft,sent,viewed,changes_requested)')
    .select('id')
  if (updateError) return json({ error: 'request_failed' }, 500)
  if (!updatedRows?.length) return json({ error: 'gone' }, 410)

  const activityText = `Quote changes requested by ${requesterName}: ${requestText}`
  const { error: noteError } = await supabase.from('fh_notes').insert({
    user_id: link.user_id,
    org_id: contact.org_id || link.org_id || null,
    contact_id: contact.id,
    text: activityText,
    category: 'activity'
  })
  if (noteError) {
    await supabase
      .from('fh_contacts')
      .update({
        proposal_status: contact.proposal_status || 'sent',
        follow_up_on: contact.follow_up_on || null,
        quote_change_request_note: contact.quote_change_request_note || null,
        quote_change_requested_at: contact.quote_change_requested_at || null
      })
      .eq('id', contact.id)
      .eq('user_id', link.user_id)
      .eq('proposal_status', 'changes_requested')
      .eq('quote_change_requested_at', requestedAt)
    return json({ error: 'activity_write_failed' }, 500)
  }

  const project = contact.job_title || contact.name || 'Quote'
  try {
    await supabase.from('fh_notifications').insert({
      user_id: link.user_id,
      org_id: contact.org_id || link.org_id || null,
      kind: 'quote_changes_requested',
      title: 'Quote changes requested',
      body: `${requesterName} requested changes for ${project}: ${requestText}`,
      link: `/quotes/${contact.id}?tab=quote`
    })
  } catch {
    // Notification delivery is best effort. The status and activity row
    // remain the durable workflow record.
  }

  await sendPushToUser(supabase, link.user_id, {
    title: 'Quote changes requested',
    body: `${requesterName} left feedback for ${project}.`,
    link: `/quotes/${contact.id}?tab=quote`,
    tag: `quote-changes-${contact.id}`
  })

  return json({
    ok: true,
    requested_by: requesterName,
    requested_at: requestedAt
  })
}

export const config = { path: '/api/public-link-request-changes' }
