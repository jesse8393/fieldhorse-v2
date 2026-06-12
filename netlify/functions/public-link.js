// Netlify Function — GET /api/public-link?token=XYZ
//
// Public, unauthenticated endpoint. Resolves a fh_public_links token
// to the underlying contact + all the data the public ProposalTemplate
// / InvoiceTemplate need to render. Uses the Supabase service-role
// key so the table itself stays opaque to direct PostgREST (the only
// policy on fh_public_links is owner-only).
//
// Behavior:
//   - token not found / revoked / expired → 404 with a friendly body
//   - on success: returns { kind, contact, company, payments, items,
//                            changeOrders, insurance, paymentSchedule,
//                            stage }
//   - side effect: bumps view_count + last_viewed_at on the token row
//     (best-effort; the response goes out either way)
//
// The contractor's `company` block is built from their profile so the
// rendered doc carries their branding (logo, accent color, license,
// insured text, warranty default).
//
// Customer sees no FieldHorse branding — matches the white-label
// policy enforced across send-quote / send-invoice / send-message.

import { createClient } from '@supabase/supabase-js'
import { sendPushToUser } from './lib/push.js'

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  })
}

export default async function handler(req) {
  if (req.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  const url = new URL(req.url)
  const token = url.searchParams.get('token')?.trim()
  if (!token) {
    return json({ error: 'missing_token', message: 'Token is required.' }, 400)
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'server_misconfigured' }, 500)
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  // 1. Resolve token
  const { data: link, error: linkErr } = await supabase
    .from('fh_public_links')
    .select('*')
    .eq('token', token)
    .maybeSingle()
  if (linkErr || !link) {
    return json({ error: 'not_found', message: 'This link is no longer available.' }, 404)
  }
  if (link.revoked_at) {
    return json({ error: 'revoked', message: 'This link has been revoked by the sender.' }, 404)
  }
  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return json({ error: 'expired', message: 'This link has expired.' }, 404)
  }

  // 2. Load the contact + related data in parallel
  const [
    { data: contact },
    { data: profile },
    { data: items },
    { data: payments },
    { data: changeOrders },
    { data: insurance },
    { data: invoices },
    { data: photoRows }
  ] = await Promise.all([
    supabase.from('fh_contacts').select('*').eq('id', link.contact_id).maybeSingle(),
    supabase.from('profiles').select('*').eq('user_id', link.user_id).maybeSingle(),
    supabase.from('fh_quote_items').select('*').eq('contact_id', link.contact_id).order('sort_order', { ascending: true }),
    supabase.from('fh_payments').select('*').eq('contact_id', link.contact_id).order('paid_on', { ascending: false }),
    supabase.from('fh_change_orders').select('*').eq('contact_id', link.contact_id).order('sequence_number', { ascending: true }),
    supabase.from('fh_insurance_claims').select('*').eq('contact_id', link.contact_id).maybeSingle(),
    supabase.from('fh_invoices').select('*').eq('contact_id', link.contact_id).order('sequence_number', { ascending: true }),
    supabase
      .from('fh_job_files')
      .select('id, storage_path, caption, section_tag, uploaded_at')
      .eq('job_id', link.contact_id)
      .eq('kind', 'photo')
      .order('uploaded_at', { ascending: true })
      .limit(12)
  ])

  // Sign photo URLs server-side so the public viewer can render them
  // directly without a second round-trip. 24h TTL — generous enough
  // that an emailed link can be reopened the next day but not so long
  // that revoked photos linger indefinitely. Failures filter out so a
  // single bad row doesn't kill the response.
  let photos = []
  if (Array.isArray(photoRows) && photoRows.length > 0) {
    const paths = photoRows.map((r) => r.storage_path).filter(Boolean)
    if (paths.length > 0) {
      const { data: signedRes } = await supabase.storage
        .from('job-photos')
        .createSignedUrls(paths, 60 * 60 * 24)
      const signedByPath = new Map((signedRes || []).map((s) => [s.path, s.signedUrl]))
      photos = photoRows
        .map((r) => {
          const url = signedByPath.get(r.storage_path)
          if (!url) return null
          return {
            url,
            section_tag: (r.section_tag || '').trim() || (r.caption || '').trim() || null,
            caption: r.caption || null
          }
        })
        .filter(Boolean)
    }
  }

  if (!contact) {
    return json({ error: 'gone', message: 'This document is no longer available.' }, 404)
  }

  // 3. Build the company branding payload (matches what the in-app
  //    surfaces pass to ProposalTemplate / InvoiceTemplate).
  const company = profile ? {
    name: profile.company_name || profile.full_name || 'My Company',
    address: profile.company_address || '',
    phone: profile.company_phone || '',
    email: profile.company_email || profile.email || '',
    website: profile.company_website || '',
    logo_url: profile.logo_url || null,
    brand_accent_hex: profile.brand_accent_hex || null,
    estimate_template: profile.estimate_template || 'classic',
    license_number: profile.license_number || '',
    insured_text: profile.insured_text || '',
    warranty_default: profile.warranty_default || ''
  } : { name: 'My Company' }

  // 4. Bump view counter + maybe write a contractor notification —
  //    both best-effort, neither blocks the response.
  //
  //    Notification debounce: only insert a fresh "viewed" row when
  //    the link hasn't been viewed in the last hour. Otherwise a
  //    customer refreshing the page would spam the contractor's
  //    inbox. Read-only refreshes still bump view_count + last_viewed_at.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const shouldNotify = !link.last_viewed_at || new Date(link.last_viewed_at) < oneHourAgo

  supabase
    .from('fh_public_links')
    .update({
      view_count: (link.view_count || 0) + 1,
      last_viewed_at: new Date().toISOString()
    })
    .eq('id', link.id)
    .then(() => {}, () => {})

  if (shouldNotify) {
    const kindLabel = link.kind === 'invoice' ? 'invoice' : 'proposal'
    supabase.from('fh_notifications').insert({
      user_id: link.user_id,
      kind: 'public_link_viewed',
      title: `Customer viewed your ${kindLabel}`,
      body: contact.name ? `${contact.name}${contact.job_title ? ` · ${contact.job_title}` : ''}` : null,
      link: `/jobs/${link.contact_id}`
    }).then(() => {}, () => {})
    // Lock screen too — "they're looking at it right now" is the best
    // possible moment to call. Same debounce as the bell row.
    sendPushToUser(supabase, link.user_id, {
      title: `Customer is viewing your ${kindLabel} 👀`,
      body: contact.name ? `${contact.name}${contact.job_title ? ` · ${contact.job_title}` : ''}` : 'Tap to open the job',
      link: `/jobs/${link.contact_id}`,
      tag: `link-viewed-${link.id}`
    })
  }

  return json({
    ok: true,
    kind: link.kind,
    contact: {
      id: contact.id,
      name: contact.name,
      address: contact.address,
      phone: contact.phone,
      email: contact.email,
      job_title: contact.job_title,
      job_type: contact.job_type,
      stage: contact.stage,
      proposal_status: contact.proposal_status,
      quote_sent_at: contact.quote_sent_at,
      quote_expires_at: contact.quote_expires_at,
      created_at: contact.created_at,
      terms_text: contact.terms_text,
      scope_text: contact.scope_text,
      exclusions_text: contact.exclusions_text,
      amount: contact.amount
    },
    company,
    items: items || [],
    payments: payments || [],
    changeOrders: changeOrders || [],
    insurance: insurance || null,
    invoices: invoices || [],
    photos
  })
}

export const config = { path: '/api/public-link' }
