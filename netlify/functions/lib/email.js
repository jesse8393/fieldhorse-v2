// netlify/functions/lib/email.js
//
// Shared email-rendering helpers for the send-* functions.

// "Pay now" block — a gold button to the contractor's bring-your-own
// pay link plus any free-text instructions. Renders nothing when
// neither is set. `safe` is the caller's HTML-escaper.
export function renderPayBlock(payLink, payInstructions, amountLabel, safe) {
  const url = String(payLink || '').trim()
  const instr = String(payInstructions || '').trim()
  if (!url && !instr) return ''
  const safeUrl = url && /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : (url ? `https://${url}` : '')
  const button = safeUrl
    ? `<a href="${safe(safeUrl)}" style="display:inline-block;background:linear-gradient(135deg,#d4af37,#b7872d);color:#1f1f1f;font-size:14px;font-weight:700;text-decoration:none;padding:12px 24px;border-radius:8px;">Pay${amountLabel ? ` ${safe(amountLabel)}` : ''} now</a>`
    : ''
  const note = instr ? `<p style="margin:${button ? '12px' : '0'} 0 0;font-size:13px;color:#5d5d57;">${safe(instr)}</p>` : ''
  return `<tr><td style="padding:4px 32px 20px;" align="center">${button}${note}</td></tr>`
}
