// netlify/functions/lib/email.js
//
// Shared email-rendering helpers for the send-* functions.

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
  if (/^(https?|mailto|tel):/i.test(t)) return t
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return '' // unknown/dangerous scheme
  return `https://${t}`
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
