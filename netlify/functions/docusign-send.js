// Netlify Function — POST /api/docusign-send
//
// Sends a job's proposal PDF for e-signature through DocuSign. The
// browser uploads the generated proposal PDF to the job-files bucket
// (same as send-quote), then POSTs { contact_id, sender_user_id,
// recipient_email, recipient_name, storage_path, subject }. We:
//   1. verify the caller owns the job (service role)
//   2. download the PDF
//   3. JWT-authenticate to DocuSign, create an envelope with one
//      signer + an anchored signature tab
//   4. record the envelope in fh_esign_envelopes (status='sent')
//
// Auth model: DocuSign JWT Grant (server-to-server, no per-request
// user OAuth). Requires a one-time admin consent grant for the
// integration key + impersonated user.
//
// Env vars (all server-only):
//   DOCUSIGN_INTEGRATION_KEY  — integration (client) key GUID
//   DOCUSIGN_USER_ID          — impersonated user GUID (API Username)
//   DOCUSIGN_ACCOUNT_ID       — API account id GUID
//   DOCUSIGN_PRIVATE_KEY      — RSA private key PEM (full, with header/footer)
//   DOCUSIGN_AUTH_BASE        — account-d.docusign.com (demo) | account.docusign.com (prod)
//   DOCUSIGN_API_BASE         — https://demo.docusign.net (demo) | region base (prod)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//
// When the DocuSign vars are missing the function returns 503
// 'esign_not_configured' so the client can surface a friendly message
// and fall back to the typed-name e-sign or manual send.

import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export default async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'server_misconfigured', message: 'Missing Supabase credentials.' }, 500)
  }

  const cfg = {
    integrationKey: process.env.DOCUSIGN_INTEGRATION_KEY,
    userId: process.env.DOCUSIGN_USER_ID,
    accountId: process.env.DOCUSIGN_ACCOUNT_ID,
    privateKey: process.env.DOCUSIGN_PRIVATE_KEY,
    authBase: process.env.DOCUSIGN_AUTH_BASE || 'account-d.docusign.com',
    apiBase: process.env.DOCUSIGN_API_BASE || 'https://demo.docusign.net'
  }
  if (!cfg.integrationKey || !cfg.userId || !cfg.accountId || !cfg.privateKey) {
    return json({
      error: 'esign_not_configured',
      message: 'DocuSign is not connected yet. Add the DOCUSIGN_* env vars in Netlify.'
    }, 503)
  }

  let body
  try { body = await request.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const { contact_id, sender_user_id, recipient_email, recipient_name, storage_path, subject } = body || {}
  if (!contact_id || !sender_user_id || !recipient_email || !storage_path) {
    return json({ error: 'missing_fields', required: ['contact_id', 'sender_user_id', 'recipient_email', 'storage_path'] }, 400)
  }
  const email = String(recipient_email).toLowerCase().trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid_email' }, 400)

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

  // 1. Ownership check
  const { data: contact, error: cErr } = await supabase
    .from('fh_contacts')
    .select('id, name, job_title, user_id')
    .eq('id', contact_id)
    .eq('user_id', sender_user_id)
    .maybeSingle()
  if (cErr) return json({ error: 'contact_lookup_failed', detail: cErr.message }, 500)
  if (!contact) return json({ error: 'forbidden_or_not_found' }, 403)

  // 2. Download PDF → base64
  const { data: blob, error: dlErr } = await supabase.storage.from('job-files').download(storage_path)
  if (dlErr || !blob) return json({ error: 'pdf_download_failed', detail: dlErr?.message || 'not found' }, 500)
  const base64Pdf = Buffer.from(await blob.arrayBuffer()).toString('base64')

  // 3. JWT auth → access token
  let token
  try {
    token = await getAccessToken(cfg)
  } catch (e) {
    // Most common: consent not granted yet. Surface the consent URL so
    // the operator can authorize the integration once.
    const consentUrl = `https://${cfg.authBase}/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=${cfg.integrationKey}&redirect_uri=https://www.docusign.com`
    return json({
      error: 'docusign_auth_failed',
      detail: e?.message || 'JWT grant failed',
      hint: 'If this is the first send, grant consent once by visiting the consent URL.',
      consent_url: consentUrl
    }, 502)
  }

  // 4. Create envelope
  const docSubject = (subject || `Proposal${contact.job_title ? ` — ${contact.job_title}` : ''} for signature`).slice(0, 100)
  const envelopeDef = {
    emailSubject: docSubject,
    documents: [{
      documentBase64: base64Pdf,
      name: `Proposal-${contact.id}.pdf`,
      fileExtension: 'pdf',
      documentId: '1'
    }],
    recipients: {
      signers: [{
        email,
        name: (recipient_name || contact.name || 'Customer').slice(0, 100),
        recipientId: '1',
        routingOrder: '1',
        tabs: {
          signHereTabs: [{
            // Anchor on the literal text in the proposal's signature
            // block. Falls back gracefully if the anchor isn't found —
            // DocuSign places nothing and the signer can adopt-and-sign
            // via the free-form flow.
            anchorString: 'Client signature',
            anchorUnits: 'pixels',
            anchorXOffset: '0',
            anchorYOffset: '-22'
          }]
        }
      }]
    },
    status: 'sent'
  }

  let envelopeId
  try {
    const res = await fetch(`${cfg.apiBase}/restapi/v2.1/accounts/${cfg.accountId}/envelopes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(envelopeDef)
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return json({ error: 'envelope_create_failed', provider_status: res.status, detail: data?.message || JSON.stringify(data) }, 502)
    }
    envelopeId = data.envelopeId
  } catch (e) {
    return json({ error: 'envelope_create_failed', detail: e?.message || 'network error' }, 502)
  }

  // 5. Record it
  try {
    await supabase.from('fh_esign_envelopes').insert({
      user_id: sender_user_id,
      contact_id,
      envelope_id: envelopeId,
      provider: 'docusign',
      status: 'sent',
      recipient_email: email,
      recipient_name: recipient_name || contact.name || null,
      subject: docSubject
    })
    await supabase.from('fh_notes').insert({
      user_id: sender_user_id,
      contact_id,
      text: `Sent proposal for e-signature to ${email} (DocuSign)`,
      category: 'activity'
    })
  } catch (e) {
    console.warn('[docusign-send] record insert failed', e)
  }

  return json({ ok: true, envelope_id: envelopeId, status: 'sent' })
}

// ---- DocuSign JWT Grant ----
async function getAccessToken(cfg) {
  const now = Math.floor(Date.now() / 1000)
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const header = enc({ alg: 'RS256', typ: 'JWT' })
  const payload = enc({
    iss: cfg.integrationKey,
    sub: cfg.userId,
    aud: cfg.authBase,
    iat: now,
    exp: now + 3600,
    scope: 'signature impersonation'
  })
  const signingInput = `${header}.${payload}`
  // DOCUSIGN_PRIVATE_KEY may arrive with literal \n (Netlify env single
  // line) — normalize back to real newlines for the PEM parser.
  const pem = cfg.privateKey.includes('\\n') ? cfg.privateKey.replace(/\\n/g, '\n') : cfg.privateKey
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), pem).toString('base64url')
  const assertion = `${signingInput}.${signature}`

  const res = await fetch(`https://${cfg.authBase}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    throw new Error(data?.error_description || data?.error || `token endpoint ${res.status}`)
  }
  return data.access_token
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors() } })
}

export const config = { path: '/api/docusign-send' }
