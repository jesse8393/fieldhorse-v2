// netlify/functions/lib/email.js
//
// Shared email-rendering helpers for the send-* functions.

import crypto from 'node:crypto'
import { personFirstName } from '../../../src/lib/quoteView.ts'

// The greeting line: "Hi Marco," when the name reads as a person's, and a
// neutral "Hello," for a company ("The Roof Doctor", "MMC Properties") or
// no name, which used to read "Hi The," and "Hi MMC,". The same reading
// the customer page uses (personFirstName).
export function greetingFor(name) {
  const first = personFirstName(typeof name === 'string' ? name : '')
  return first ? `Hi ${first},` : 'Hello,'
}

// Head for every customer email: a phone renders it at its own width
// instead of zooming out a desktop layout.
export const EMAIL_HEAD = '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>'

// How long one call to the mail provider may take. Netlify stops a
// synchronous function after 10 seconds, so the send gives up first and
// the handler can still answer with a plain error.
export const PROVIDER_TIMEOUT_MS = 8000

// Idempotency key for a send: the kind of email plus a hash of the record
// and the attachment path (or, with no attachment, the message itself). A
// second tap after a lost response repeats the same request, gets the same
// key, and the provider sends nothing new for 24 hours. A new document is
// uploaded under a new path, so a deliberate resend gets a new key.
export function idempotencyKey(kind, ...parts) {
  const digest = crypto.createHash('sha256').update(parts.map((p) => String(p ?? '')).join('\n')).digest('hex').slice(0, 40)
  return `${kind}/${digest}`
}

// POST one email to Resend with an idempotency key and a time limit. Never
// throws: a network error or a timeout comes back as { ok: false,
// status: 0 } with a plain detail, so the handler answers JSON instead of
// a crash.
export async function sendViaResend({ apiKey, payload, key, timeoutMs = PROVIDER_TIMEOUT_MS }) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(key ? { 'Idempotency-Key': key } : {})
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    })
    const body = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, body }
  } catch (e) {
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError'
    return {
      ok: false,
      status: 0,
      body: {},
      detail: timedOut
        ? 'The email provider did not answer in time. Try again in a minute.'
        : 'Could not reach the email provider. Try again in a minute.'
    }
  }
}

// The handler's error body for a send that did not go out. The provider's
// status and words go to the function log for us; the person reads a plain
// sentence, since the phone app shows detail as it is.
export const SEND_FAILED_DETAIL = 'The email did not go out. Try again, or download the PDF and send it yourself.'
export function sendFailure(result, detail = SEND_FAILED_DETAIL) {
  console.error('[email] send failed', { status: result.status || null, body: result.body, detail: result.detail || null })
  return { error: 'send_failed', detail }
}

// RFC 5322 From header with the display name as a quoted string. Company
// names such as `Smith & Sons, LLC` or `J. "Bud" Parker` broke the
// unquoted `${name} <${address}>` form (the comma splits an address list,
// the quote ends the name early). Quotes, backslashes, angle brackets and
// control characters are dropped from the name, so it can neither break
// out of the quotes nor pose as a second address.
export function formatFromHeader(name, address, fallbackName = 'Notifications') {
  const clean = (value) => String(value || '')
    .replace(/[\p{Cc}"\\<>]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const display = clean(name) || clean(fallbackName)
  return display ? `"${display}" <${address}>` : String(address)
}

// Optional text field from a JSON request body. Anything that is not a
// string (a number, an object, null) reads as empty, so a malformed client
// gets the default copy instead of a TypeError and an opaque 500.
export function textField(value) {
  return typeof value === 'string' ? value.trim() : ''
}

// Plain text to HTML paragraphs: a blank line starts a new paragraph and a
// single newline becomes <br>. Paragraphs are spaced 14px apart with no
// margin after the last one. `safe` is the caller's HTML escaper.
export function renderParagraphs(text, safe) {
  const paragraphs = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  return paragraphs
    .map((p, i) => `<p style="margin:0 0 ${i === paragraphs.length - 1 ? '0' : '14px'};">${safe(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

// Coerce a contractor-pasted pay link into a safe, clickable URL.
// Allow-list http(s)/mailto/tel; a bare host gets https:// prepended;
// anything with a NON-safe scheme (javascript:, data:, vbscript:, …) is
// dropped to '' so it never reaches an href. Shared shape with the
// client-side helpers in pdf.js / PublicDoc.tsx / Settings.tsx.
export function safePayUrl(raw) {
  const t = String(raw || '').trim()
  if (!t) return ''
  if (/^(mailto|tel):/i.test(t)) return t
  if (/^https?:/i.test(t)) return isWebAddress(t) ? t : ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return '' // unknown/dangerous scheme
  const url = `https://${t}`
  return isWebAddress(url) ? url : ''
}

// A real web address: no spaces, parses, names a host with a dot in it,
// and carries no user name or password (which would hide the real host).
function isWebAddress(t) {
  if (/\s/.test(t)) return false
  try {
    const u = new URL(t)
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname) && !u.username && !u.password
  } catch {
    return false
  }
}

// "Pay now" block — a gold button to the contractor's bring-your-own
// pay link plus any free-text instructions. Renders nothing when
// neither is set. `safe` is the caller's HTML-escaper.
export function renderPayBlock(payLink, payInstructions, amountLabel, safe) {
  const url = String(payLink || '').trim()
  const instr = String(payInstructions || '').trim()
  if (!url && !instr) return ''
  const safeUrl = safePayUrl(url)
  const button = safeUrl
    ? `<a href="${safe(safeUrl)}" style="display:inline-block;background:#C9963A;color:#141414;font-size:14px;font-weight:700;text-decoration:none;padding:12px 24px;border-radius:10px;">Pay${amountLabel ? ` ${safe(amountLabel)}` : ''} now</a>`
    : ''
  const note = instr ? `<p style="margin:${button ? '12px' : '0'} 0 0;font-size:14px;color:#5C5C5C;">${safe(instr)}</p>` : ''
  return `<tr><td style="padding:4px 32px 24px;" align="center">${button}${note}</td></tr>`
}
