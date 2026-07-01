// Netlify Function — POST /api/public-co-approve
//
// Customer-side change-order sign-off through the /p/:token link
// (kind='change_order'). Same auth model as public-link-approve: the
// token IS the auth; every write keys off the link row's user_id /
// change_order_id so a customer can't cross tenants or sign a
// different CO.
//
// Side effects on success:
//   1. UPDATE fh_change_orders → status='approved',
//      approval_method='signature_typed', approved_by_name, approved_at
//   2. INSERT fh_notifications (bell) + web push to the contractor
//
// The approved CO folds into the job's contract total automatically
// (contractTotals() in src/lib/invoices.ts counts approved COs), so
// the next invoice picks it up with no further action.

import { createClient } from '@supabase/supabase-js'
import { sendPushToUser } from './lib/push.js'

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
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders() }
  })
}

function moneyFmt(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  })
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body = {}
  try { body = await req.json() } catch { /* tolerate empty body */ }
  const token = String(body?.token || '').trim()
  const signatureName = String(body?.signature_name || '').trim()
  const customerNote = String(body?.note || '').trim().slice(0, 1000)
  if (!token) return json({ error: 'missing_token' }, 400)
  if (!signatureName) return json({ error: 'missing_signature_name' }, 400)
  if (signatureName.length > 200) return json({ error: 'name_too_long' }, 400)

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'server_misconfigured' }, 500)

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  // 1. Resolve + validate the link.
  const { data: link } = await supabase
    .from('fh_public_links')
    .select('id, user_id, contact_id, change_order_id, kind, revoked_at, expires_at')
    .eq('token', token)
    .maybeSingle()
  if (!link || link.kind !== 'change_order' || !link.change_order_id) {
    return json({ error: 'not_found' }, 404)
  }
  if (link.revoked_at) return json({ error: 'revoked' }, 404)
  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return json({ error: 'expired' }, 404)
  }

  // 2. Load the CO; idempotency guard against double-taps.
  const { data: co } = await supabase
    .from('fh_change_orders')
    .select('id, contact_id, user_id, sequence_number, title, amount, status')
    .eq('id', link.change_order_id)
    .eq('user_id', link.user_id)
    .maybeSingle()
  if (!co) return json({ error: 'gone' }, 404)
  if (co.status === 'approved') return json({ error: 'already_approved' }, 409)
  if (co.status === 'void' || co.status === 'rejected') return json({ error: 'gone' }, 410)

  const approvedAt = new Date().toISOString()
  // The UPDATE itself is the idempotency guard: `.neq('status','approved')`
  // means a concurrent double-tap / retried POST that already flipped the
  // row updates 0 rows here, so we never double-notify or let a stale
  // signature overwrite a recorded one (the read-based 409 above is just
  // a fast path; this is the race-safe gate).
  const { data: updatedRows, error: upErr } = await supabase
    .from('fh_change_orders')
    .update({
      status: 'approved',
      approval_method: 'signature_typed',
      approved_by_name: signatureName,
      approved_at: approvedAt
    })
    .eq('id', co.id)
    .eq('user_id', link.user_id)
    .neq('status', 'approved')
    .select('id')
  if (upErr) return json({ error: 'approve_failed', message: upErr.message }, 500)
  if (!updatedRows || updatedRows.length === 0) return json({ error: 'already_approved' }, 409)

  // 3. Tell the contractor — bell + lock screen. Best effort.
  const { data: contact } = await supabase
    .from('fh_contacts')
    .select('name, job_title')
    .eq('id', co.contact_id)
    .maybeSingle()
  const who = contact?.name || 'Customer'
  const sign = Number(co.amount) >= 0 ? '+' : '−'
  const title = `Change order signed · ${sign}${moneyFmt(Math.abs(Number(co.amount) || 0))}`
  try {
    await supabase.from('fh_notifications').insert({
      user_id: link.user_id,
      kind: 'change_order_signed',
      title,
      body: `${who} signed CO #${co.sequence_number}${co.title ? ` — ${co.title}` : ''}${customerNote ? ` · "${customerNote}"` : ''}`,
      link: `/jobs/${co.contact_id}?tab=quote`
    })
  } catch { /* bell is best-effort */ }
  // Persist the customer's note as an activity row on the job so it
  // isn't lost (it's shown on the Activity/Messages log).
  if (customerNote) {
    try {
      await supabase.from('fh_notes').insert({
        user_id: link.user_id,
        contact_id: co.contact_id,
        text: `CO #${co.sequence_number} signed by ${signatureName} — note: ${customerNote}`,
        category: 'activity'
      })
    } catch { /* best-effort */ }
  }
  await sendPushToUser(supabase, link.user_id, {
    title: `${title} ✍️`,
    body: `${who} signed CO #${co.sequence_number}. It's on the next invoice automatically.`,
    link: `/jobs/${co.contact_id}?tab=quote`,
    tag: `co-signed-${co.id}`
  })

  return json({ ok: true, signed_by: signatureName, approved_at: approvedAt })
}

export const config = { path: '/api/public-co-approve' }
