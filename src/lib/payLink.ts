// src/lib/payLink.ts
//
// Coerce a contractor-pasted "pay link" into a safe, clickable URL.
// Allow-list http(s)/mailto/tel; prepend https:// to a bare host; drop
// anything with a dangerous scheme (javascript:, data:, vbscript:, …) to
// '' so it can never reach an href on a customer facing surface.
//
// Shared by pdf.js (invoice/statement PDFs), PublicDoc (the public page),
// and Settings (save-time normalization). The Netlify email function
// keeps its own copy of this in functions/lib/email.js (separate bundle).
export function safePayUrl(raw: unknown): string {
  const t = String(raw || '').trim()
  if (!t) return ''
  if (/^(https?|mailto|tel):/i.test(t)) return t
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return '' // unknown/dangerous scheme
  return `https://${t}`
}
