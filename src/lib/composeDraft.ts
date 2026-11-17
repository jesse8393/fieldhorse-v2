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

// A day or month name, full or short, as a customer would write it.
const DAY_OR_MONTH = '(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?|Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)'
// The text before a dash ends in a number or a clock time.
const ENDS_IN_NUMBER = /\d(?:\s*(?:am|pm|a\.m\.|p\.m\.))?$/i
const ENDS_IN_DAY_OR_MONTH = new RegExp(`\\b${DAY_OR_MONTH}\\.?$`)
const STARTS_WITH_DAY_OR_MONTH = new RegExp(`^${DAY_OR_MONTH}\\b`)

// A dash that joins the two ends of a range: an en dash written tight
// between two words, a number or time followed by a number or price, or a
// day or month name on each side.
function isRange(dash: string, before: string, after: string): boolean {
  if (dash === '\u2013' && /\w$/.test(before) && /^\w/.test(after)) return true
  if (ENDS_IN_NUMBER.test(before) && /^[\d$]/.test(after)) return true
  return ENDS_IN_DAY_OR_MONTH.test(before) && STARTS_WITH_DAY_OR_MONTH.test(after)
}

// A customer should never get a dash used as punctuation. The drafting
// prompt asks the model for none; this rewrites the ones it writes anyway:
// a range reads "to", a dash after other punctuation or at either end of a
// line is dropped, and any other dash becomes a comma.
export function plainPunctuation(text: string): string {
  return text.replace(PUNCTUATION_DASH, (dash, offset: number, whole: string) => {
    const before = whole.slice(0, offset)
    const after = whole.slice(offset + dash.length)
    const prev = before.slice(-1)
    const next = after.charAt(0)
    if (!prev || prev === '\n') return dash.includes('-') ? dash : ''
    if (!next || next === '\n' || next === '\r') return ''
    if (isRange(dash, before, after)) return ' to '
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
