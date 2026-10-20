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
import { createHash } from 'node:crypto'
import { sendPushToUser } from './lib/push.js'
import { clientIp, hashIdentifier, checkRateLimit } from './lib/rateLimit.js'
import { linkScope } from './lib/linkScope.js'
import { brandingUserIdFor } from './lib/orgAccess.js'
import { loadQuoteForLink } from './lib/quoteApproval.js'

function trimHeader(value, max = 500) {
  const text = String(value || '').trim()
  return text ? text.slice(0, max) : null
}

export function getPublicLinkClientIp(req) {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (
    req.headers.get('x-nf-client-connection-ip') ||
    forwarded ||
    req.headers.get('client-ip') ||
    req.headers.get('x-real-ip') ||
    ''
  ).trim()
}

export function hashPublicLinkIp(ip, salt = process.env.PUBLIC_LINK_AUDIT_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || 'fieldhorse-public-link') {
  const clean = String(ip || '').trim()
  if (!clean) return null
  return createHash('sha256').update(`${salt}:${clean}`).digest('hex')
}

export function buildPublicLinkViewEvent(req, link, contact, salt) {
  return {
    p_public_link_id: link.id,
    p_org_id: link.org_id || contact?.org_id || null,
    p_user_id: link.user_id,
    p_contact_id: link.contact_id,
    p_kind: link.kind,
    p_user_agent: trimHeader(req.headers.get('user-agent')),
    p_referer: trimHeader(req.headers.get('referer')),
    p_ip_hash: hashPublicLinkIp(getPublicLinkClientIp(req), salt),
    p_metadata: {
      change_order_id: link.change_order_id || null,
      quote_id: link.quote_id || null,
      request_id: trimHeader(req.headers.get('x-nf-request-id'), 120)
    }
  }
}

// Columns a customer may see. Internal fields (user_id, org_id, created_by,
// internal notes on change orders) stay server side.
const PUBLIC_PAYMENT_COLUMNS = 'id, contact_id, invoice_id, amount, paid_on, created_at, method, reference, kind'
const PUBLIC_CHANGE_ORDER_COLUMNS = 'id, contact_id, sequence_number, title, description, amount, status, approved_at, approved_by_name, created_at'

// Human label + in-app deep link for a "customer viewed" notification.
export function viewedLabelFor(link) {
  if (link.kind === 'invoice') {
    return { kindLabel: 'invoice', detailLink: `/jobs/${link.contact_id}?tab=financials` }
  }
  if (link.kind === 'change_order') {
    return { kindLabel: 'change order', detailLink: `/jobs/${link.contact_id}?tab=quote` }
  }
  if (link.quote_id) {
    return { kindLabel: 'proposal', detailLink: `/quotes/${link.quote_id}` }
  }
  return { kindLabel: 'proposal', detailLink: `/quotes/${link.contact_id}?tab=quote` }
}

// The stage the portal reads (portalView.ts CLOSED_STAGES and jobFinished)
// for a link that points at a quote record: a lost or rejected quote is
// closed to approval; an approved quote whose job exists reads the job's
// stage so a closed out job promises nothing more; anything else is an
// open quote.
export function quoteStage(quote, job) {
  const status = String(quote?.status || '').toLowerCase()
  if (status === 'lost' || status === 'rejected') return 'lost'
  if (status === 'approved' && quote?.job_id && job?.stage) return String(job.stage)
  return 'quote'
}

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

  // Per-IP rate limit before any service-role work — an unauthenticated
  // link view triggers several queries + signed-URL generation, so this
  // caps the amplification of a refresh flood / token spray.
  const allowed = await checkRateLimit(supabase, {
    scope: 'public-link', identifier: hashIdentifier(clientIp(req)), limit: 90,
  })
  if (!allowed) {
    return json({ error: 'rate_limited', message: 'Too many requests. Please try again in a minute.' }, 429)
  }

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

  // Statement links are client-scoped (every open job for one client)
  // rather than job-scoped, so they take a wholly separate load path.
  if (link.kind === 'statement') {
    return handleStatement(supabase, req, link)
  }
  // A proposal link minted for a quote record (fh_quotes) resolves the
  // quote first; contact_id links keep the job path below.
  if (link.quote_id) {
    return handleQuote(supabase, req, link)
  }

  // 2. Load the contact + related data in parallel. Branding comes from the
  // company owner's profile so every teammate's links look the same.
  const brandUserId = await brandingUserIdFor(supabase, link)
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
    supabase.from('fh_contacts').select('*').eq('id', link.contact_id).match(linkScope(link)).maybeSingle(),
    supabase.from('profiles').select('*').eq('user_id', brandUserId).maybeSingle(),
    supabase.from('fh_quote_items').select('*').eq('contact_id', link.contact_id).order('sort_order', { ascending: true }),
    // Projected to what the customer documents render (PaymentHistoryBlock).
    supabase
      .from('fh_payments')
      .select(PUBLIC_PAYMENT_COLUMNS)
      .eq('contact_id', link.contact_id)
      .order('paid_on', { ascending: false }),
    // Customer-visible change orders only: sent and approved ones, plus the
    // one a change order link points at. `*` used to ship drafts, rejected
    // and voided change orders with their amounts to anyone with the link.
    link.change_order_id
      ? supabase
          .from('fh_change_orders')
          .select(PUBLIC_CHANGE_ORDER_COLUMNS)
          .eq('contact_id', link.contact_id)
          .or(`status.in.(sent,approved),id.eq.${link.change_order_id}`)
          .order('sequence_number', { ascending: true })
      : supabase
          .from('fh_change_orders')
          .select(PUBLIC_CHANGE_ORDER_COLUMNS)
          .eq('contact_id', link.contact_id)
          .in('status', ['sent', 'approved'])
          .order('sequence_number', { ascending: true }),
    supabase.from('fh_insurance_claims').select('*').eq('contact_id', link.contact_id).maybeSingle(),
    // Customer-visible draws only, projected columns only. `*` shipped
    // draft/void rows (amounts for bills that were never issued) and
    // internal notes to anyone with the link — the UI filtered them,
    // but the JSON payload is one View-Source away.
    supabase
      .from('fh_invoices')
      .select('id, contact_id, sequence_number, title, amount, status, issued_at, due_at, description')
      .eq('contact_id', link.contact_id)
      .in('status', ['sent', 'paid', 'overdue'])
      .order('sequence_number', { ascending: true }),
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
    // Either the contact was deleted, or the link's contact_id doesn't
    // belong to the link's owner (scoped by user_id above) — never leak
    // another tenant's job across a mis-minted token.
    return json({ error: 'gone', message: 'This document is no longer available.' }, 404)
  }

  // 3. Build the company branding payload (matches what the in-app
  //    surfaces pass to ProposalTemplate / InvoiceTemplate).
  const company = buildCompany(profile)

  // 4. Bump view counter + maybe write a contractor notification —
  //    both best-effort, neither blocks the response.
  //
  //    Notification debounce: only insert a fresh "viewed" row when
  //    the link hasn't been viewed in the last hour. Otherwise a
  //    customer refreshing the page would spam the contractor's
  //    inbox. Read-only refreshes still bump view_count + last_viewed_at.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const shouldNotify = !link.last_viewed_at || new Date(link.last_viewed_at) < oneHourAgo

  const sideEffects = [
    recordPublicLinkView(supabase, req, link, contact)
  ]

  if (shouldNotify) {
    const { kindLabel, detailLink } = viewedLabelFor(link)
    sideEffects.push(
      supabase.from('fh_notifications').insert({
      user_id: link.user_id,
      org_id: link.org_id || contact.org_id || null,
      kind: 'public_link_viewed',
      title: `Customer viewed your ${kindLabel}`,
      body: contact.name ? `${contact.name}${contact.job_title ? ` · ${contact.job_title}` : ''}` : null,
      link: detailLink
      })
    )
    // Lock screen too — "they're looking at it right now" is the best
    // possible moment to call. Same debounce as the bell row.
    sideEffects.push(
      sendPushToUser(supabase, link.user_id, {
      title: `Customer is viewing your ${kindLabel} 👀`,
      body: contact.name ? `${contact.name}${contact.job_title ? ` · ${contact.job_title}` : ''}` : `Tap to open the ${kindLabel}`,
      link: detailLink,
      tag: `link-viewed-${link.id}`
      })
    )
  }

  const settled = await Promise.allSettled(sideEffects)
  for (const result of settled) {
    if (result.status === 'rejected') {
      console.warn('[public-link] side effect failed', result.reason)
    }
  }

  return json({
    ok: true,
    kind: link.kind,
    // change_order links point at one specific CO; the client picks it
    // out of the changeOrders array below.
    change_order_id: link.change_order_id || null,
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
      quote_change_request_note: contact.quote_change_request_note,
      quote_change_requested_at: contact.quote_change_requested_at,
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

// Company branding block shared by every document kind. Mirrors what
// the in-app surfaces pass to the templates so the customer sees the
// contractor's brand, never FieldHorse's.
function buildCompany(profile) {
  return profile ? {
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
    warranty_default: profile.warranty_default || '',
    payment_link: profile.payment_link || '',
    payment_instructions: profile.payment_instructions || ''
  } : { name: 'My Company' }
}

// Quote path (Task 11). The link points at fh_quotes: the quote, its
// client, its lines and the approved version are read by quote id. The
// payload keeps the shape the job path returns, with the client standing
// in for the contact and the quote for the job, so the customer page and
// portalView.ts keep working; it also carries quote_id and the quote's own
// status, which the page reads first. Payments, change orders, invoices
// and photos belong to a job, so they come from the job made from the
// quote when there is one, and are empty otherwise.
async function handleQuote(supabase, req, link) {
  const brandUserId = await brandingUserIdFor(supabase, link)
  const [{ quote, client }, { data: profile }, { data: items }, { data: versions }] = await Promise.all([
    loadQuoteForLink(supabase, link),
    supabase.from('profiles').select('*').eq('user_id', brandUserId).maybeSingle(),
    supabase.from('fh_quote_items').select('*').eq('quote_id', link.quote_id).order('sort_order', { ascending: true }),
    supabase
      .from('fh_quote_versions')
      .select('id, version_number, status, approved_by_name, approved_at, created_at')
      .eq('quote_id', link.quote_id)
      .eq('status', 'approved')
      .order('version_number', { ascending: false })
      .limit(1)
  ])

  if (!quote) {
    return json({ error: 'gone', message: 'This document is no longer available.' }, 404)
  }

  let job = null
  let payments = []
  let changeOrders = []
  let invoices = []
  let photos = []
  if (quote.job_id) {
    const [{ data: jobRow }, { data: pay }, { data: cos }, { data: inv }, { data: photoRows }] = await Promise.all([
      supabase.from('fh_contacts').select('id, stage').eq('id', quote.job_id).match(linkScope(link)).maybeSingle(),
      supabase.from('fh_payments').select(PUBLIC_PAYMENT_COLUMNS).eq('contact_id', quote.job_id).order('paid_on', { ascending: false }),
      supabase.from('fh_change_orders').select(PUBLIC_CHANGE_ORDER_COLUMNS).eq('contact_id', quote.job_id).in('status', ['sent', 'approved']).order('sequence_number', { ascending: true }),
      supabase
        .from('fh_invoices')
        .select('id, contact_id, sequence_number, title, amount, status, issued_at, due_at, description')
        .eq('contact_id', quote.job_id)
        .in('status', ['sent', 'paid', 'overdue'])
        .order('sequence_number', { ascending: true }),
      supabase
        .from('fh_job_files')
        .select('id, storage_path, caption, section_tag, uploaded_at')
        .eq('job_id', quote.job_id)
        .eq('kind', 'photo')
        .order('uploaded_at', { ascending: true })
        .limit(12)
    ])
    job = jobRow || null
    payments = pay || []
    changeOrders = cos || []
    invoices = inv || []
    photos = await signPhotos(supabase, photoRows)
  }

  const approvedVersion = Array.isArray(versions) && versions.length > 0 ? versions[0] : null
  const company = buildCompany(profile)
  const status = String(quote.status || 'draft').toLowerCase()

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const shouldNotify = !link.last_viewed_at || new Date(link.last_viewed_at) < oneHourAgo
  const who = client?.name || null
  const sideEffects = [recordPublicLinkView(supabase, req, link, quote)]
  if (shouldNotify) {
    const { kindLabel, detailLink } = viewedLabelFor(link)
    sideEffects.push(
      supabase.from('fh_notifications').insert({
        user_id: link.user_id,
        org_id: link.org_id || quote.org_id || null,
        kind: 'public_link_viewed',
        title: `Customer viewed your ${kindLabel}`,
        body: who ? `${who}${quote.title ? ` · ${quote.title}` : ''}` : null,
        link: detailLink
      }),
      sendPushToUser(supabase, link.user_id, {
        title: `Customer is viewing your ${kindLabel} 👀`,
        body: who ? `${who}${quote.title ? ` · ${quote.title}` : ''}` : `Tap to open the ${kindLabel}`,
        link: detailLink,
        tag: `link-viewed-${link.id}`
      })
    )
  }
  const settled = await Promise.allSettled(sideEffects)
  for (const result of settled) {
    if (result.status === 'rejected') {
      console.warn('[public-link] quote side effect failed', result.reason)
    }
  }

  return json({
    ok: true,
    kind: link.kind,
    change_order_id: null,
    quote_id: quote.id,
    status,
    contact: {
      id: quote.id,
      name: client?.name || null,
      address: client?.address || null,
      phone: client?.phone || null,
      email: client?.email || null,
      job_title: quote.title || null,
      job_type: quote.job_type || null,
      stage: quoteStage(quote, job),
      proposal_status: status,
      quote_change_request_note: quote.change_request_note || null,
      quote_change_requested_at: quote.change_requested_at || null,
      quote_sent_at: quote.sent_at || null,
      quote_expires_at: quote.expires_at || null,
      created_at: quote.created_at,
      terms_text: quote.terms_text || null,
      scope_text: quote.scope_text || null,
      exclusions_text: quote.exclusions_text || null,
      amount: quote.amount,
      approved_by_name: approvedVersion?.approved_by_name || null,
      approved_at: approvedVersion?.approved_at || approvedVersion?.created_at || null
    },
    company,
    items: items || [],
    payments,
    changeOrders,
    insurance: null,
    invoices,
    photos
  })
}

// Signed photo URLs for the public viewer, 24h TTL; a row that fails to
// sign is left out so one bad row never kills the response.
async function signPhotos(supabase, photoRows) {
  if (!Array.isArray(photoRows) || photoRows.length === 0) return []
  const paths = photoRows.map((r) => r.storage_path).filter(Boolean)
  if (paths.length === 0) return []
  const { data: signedRes } = await supabase.storage
    .from('job-photos')
    .createSignedUrls(paths, 60 * 60 * 24)
  const signedByPath = new Map((signedRes || []).map((s) => [s.path, s.signedUrl]))
  return photoRows
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

// Statement path — client-scoped rollup of every open job. Loads the
// client, all their jobs (scoped to the link's company),
// and the payments + approved change orders across those jobs, then
// returns the shape the public StatementView renders.
async function handleStatement(supabase, req, link) {
  const brandUserId = await brandingUserIdFor(supabase, link)
  const [{ data: client }, { data: profile }, { data: jobs }] = await Promise.all([
    supabase.from('fh_clients').select('*').eq('id', link.client_id).match(linkScope(link)).maybeSingle(),
    supabase.from('profiles').select('*').eq('user_id', brandUserId).maybeSingle(),
    supabase
      .from('fh_contacts')
      .select('id, name, job_title, job_type, stage, amount, address, created_at')
      .eq('client_id', link.client_id)
      .match(linkScope(link))
      .order('created_at', { ascending: true })
  ])

  if (!client) {
    return json({ error: 'gone', message: 'This statement is no longer available.' }, 404)
  }

  const jobRows = Array.isArray(jobs) ? jobs : []
  const jobIds = jobRows.map((j) => j.id)

  let payments = []
  let changeOrders = []
  if (jobIds.length > 0) {
    const [{ data: pay }, { data: cos }] = await Promise.all([
      supabase.from('fh_payments').select(PUBLIC_PAYMENT_COLUMNS).in('contact_id', jobIds).order('paid_on', { ascending: false }),
      supabase.from('fh_change_orders').select(PUBLIC_CHANGE_ORDER_COLUMNS).in('contact_id', jobIds).eq('status', 'approved')
    ])
    payments = pay || []
    changeOrders = cos || []
  }

  const company = buildCompany(profile)

  // View audit + debounced contractor notification, same policy as the
  // job-scoped path. Awaited: Netlify freezes the function once the
  // response is returned, so the old fire-and-forget calls were dropped
  // intermittently, which also broke the one hour debounce. The audit RPC
  // bumps view_count and last_viewed_at and writes fh_public_link_events.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const shouldNotify = !link.last_viewed_at || new Date(link.last_viewed_at) < oneHourAgo

  const sideEffects = [recordPublicLinkView(supabase, req, link, client)]
  if (shouldNotify) {
    const who = client.company_name || client.name || 'A customer'
    sideEffects.push(
      supabase.from('fh_notifications').insert({
        user_id: link.user_id,
        org_id: link.org_id || client.org_id || null,
        kind: 'public_link_viewed',
        title: 'Customer viewed your statement',
        body: who,
        link: `/clients/${link.client_id}`
      }),
      sendPushToUser(supabase, link.user_id, {
        title: 'Customer is viewing your statement 👀',
        body: who,
        link: `/clients/${link.client_id}`,
        tag: `link-viewed-${link.id}`
      })
    )
  }
  const settled = await Promise.allSettled(sideEffects)
  for (const result of settled) {
    if (result.status === 'rejected') {
      console.warn('[public-link] statement side effect failed', result.reason)
    }
  }

  return json({
    ok: true,
    kind: 'statement',
    client: {
      id: client.id,
      name: client.name,
      company_name: client.company_name || null,
      email: client.email || null,
      address: client.address || null
    },
    company,
    jobs: jobRows,
    payments,
    changeOrders
  })
}

async function recordPublicLinkView(supabase, req, link, contact) {
  const params = buildPublicLinkViewEvent(req, link, contact)
  const { error } = await supabase.rpc('fh_record_public_link_view', params)
  if (!error) return

  console.warn('[public-link] audit rpc failed; falling back to direct writes', error)
  const fallbackEvent = publicLinkEventRowFromRpcParams(params)
  const settled = await Promise.allSettled([
    supabase
      .from('fh_public_links')
      .update({
        view_count: (link.view_count || 0) + 1,
        last_viewed_at: new Date().toISOString()
      })
      .eq('id', link.id),
    supabase.from('fh_public_link_events').insert(fallbackEvent)
  ])
  for (const result of settled) {
    if (result.status === 'rejected') {
      console.warn('[public-link] audit fallback failed', result.reason)
    }
  }
}

function publicLinkEventRowFromRpcParams(params) {
  return {
    public_link_id: params.p_public_link_id,
    org_id: params.p_org_id,
    user_id: params.p_user_id,
    contact_id: params.p_contact_id,
    kind: params.p_kind,
    event_type: 'view',
    user_agent: params.p_user_agent,
    referer: params.p_referer,
    ip_hash: params.p_ip_hash,
    metadata: params.p_metadata
  }
}

export const config = { path: '/api/public-link' }
