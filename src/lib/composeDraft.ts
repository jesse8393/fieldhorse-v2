/** Apply the same plain text interpretation to preview, direct send and mailto. */
export function plainDraft(text: string): string {
  return plainPunctuation(String(text || '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1')
    .replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1'))
}

// An em dash, an en dash, or a hyphen with a space on each side, plus the
// spaces around it. A hyphen inside a word, a date or a phone number, and a
// hyphen that starts a list line, are left alone.
const PUNCTUATION_DASH = /[ \t]*(?:[\u2013\u2014]|(?<=[ \t])-(?=[ \t]))[ \t]*/g

// A customer should never get a dash used as punctuation. The drafting
// prompt asks the model for none; this rewrites the ones it writes anyway:
// a range between numbers reads "to", a dash after other punctuation or at
// either end of a line is dropped, and any other dash becomes a comma.
function plainPunctuation(text: string): string {
  return text.replace(PUNCTUATION_DASH, (dash, offset: number, whole: string) => {
    const before = whole.slice(0, offset)
    const after = whole.slice(offset + dash.length)
    const prev = before.slice(-1)
    const next = after.charAt(0)
    if (!prev || prev === '\n') return dash.includes('-') ? dash : ''
    if (!next || next === '\n' || next === '\r') return ''
    if (/\d/.test(prev) && /[\d$]/.test(next)) return ' to '
    if (/[,;:.!?]/.test(prev)) return ' '
    return ', '
  })
}

export function emailDraft(text: string, fallbackSubject: string): { subject: string; body: string } {
  const cleaned = plainDraft(text).trim()
  const match = /^Subject\s*:\s*([^\r\n]+)(?:\r?\n|$)/i.exec(cleaned)
  return {
    subject: match?.[1]?.trim() || fallbackSubject,
    body: match ? cleaned.slice(match[0].length).trimStart() : cleaned,
  }
}
