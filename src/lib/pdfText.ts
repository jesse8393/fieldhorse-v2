// src/lib/pdfText.ts
//
// jsPDF's built in fonts (Helvetica, Times, Courier) only cover the Windows
// 1252 ("WinAnsi") character set. When a string holds even one character
// outside that set, jsPDF writes the whole string as two byte text, which
// those fonts draw as junk. A minus sign on "Paid to date", the arrow in
// "Pay online", an em space used as an empty cell, or an emoji in a customer
// name garbled the entire line on the customer's invoice.
//
// pdfSafeText() maps such characters to a plain equivalent, and
// installWinAnsiText() routes every string a document measures or draws
// through it, so the fix covers our own copy, contractor and customer text,
// and autoTable cells alike. Embedding a Unicode TTF with addFont is the
// longer term alternative if non Latin scripts ever need to print.

// Characters above Latin 1 that Windows 1252 (and jsPDF's encoder) supports:
// euro, curly quotes, en and em dash, bullet, ellipsis, trademark and a few
// accented capitals.
const WIN_ANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178
])

// Common characters with a plain stand in.
const REPLACEMENTS: Record<number, string> = {
  0x2212: '-',                                             // minus sign
  0x2010: '-', 0x2011: '-', 0x2012: '-', 0x2015: '-', 0x2043: '-',
  0x2190: '<-', 0x2192: '->', 0x2194: '<->', 0x21d2: '=>',
  0x2264: '<=', 0x2265: '>=',
  0x2032: "'", 0x2033: '"',                                // feet and inches
  0x201b: "'", 0x201f: '"', 0x2035: "'", 0x02bc: "'",
  0x2044: '/', 0x2215: '/',                                // fraction and division slash
  0x2217: '*', 0x2219: '\u2022', 0x25cf: '\u2022', 0x25e6: '\u2022', 0x25aa: '\u2022',
  0x2028: '\n', 0x2029: '\n'
}

// Anything that is not printable ASCII or a line break needs a closer look.
const NEEDS_MAPPING = /[^\x20-\x7e\n\r]/

function isSpace(cp: number) {
  return (cp >= 0x2000 && cp <= 0x200a) || cp === 0x202f || cp === 0x205f || cp === 0x3000
}

function isInvisible(cp: number) {
  return (cp >= 0x200b && cp <= 0x200d) || cp === 0x2060 || cp === 0xfeff || (cp >= 0xfe00 && cp <= 0xfe0f)
}

// Maps one character, or returns null when it has no direct mapping.
function mapDirect(cp: number, ch: string): string | null {
  if (cp === 0x0a || cp === 0x0d) return ch
  if (cp === 0x09) return ' '
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return ''   // control characters
  if (cp === 0xad) return ''                               // soft hyphen would print as a hyphen
  if (cp <= 0xff || WIN_ANSI_EXTRAS.has(cp)) return ch
  const replacement = REPLACEMENTS[cp]
  if (replacement !== undefined) return replacement
  if (isSpace(cp)) return ' '
  if (isInvisible(cp) || /\p{M}/u.test(ch)) return ''      // zero width characters, combining marks
  return null
}

function mapChar(ch: string): string {
  const cp = ch.codePointAt(0) as number
  const direct = mapDirect(cp, ch)
  if (direct !== null) return direct
  // Decompose ("Nguyễn" to "Nguyen", ligatures, full width letters) and keep
  // the result when every piece maps; otherwise mark the gap with '?'.
  const decomposed = ch.normalize('NFKD')
  if (decomposed !== ch) {
    let out = ''
    for (const piece of decomposed) {
      const mapped = mapDirect(piece.codePointAt(0) as number, piece)
      if (mapped === null) return '?'
      out += mapped
    }
    return out
  }
  return '?'
}

/** Returns `text` with every character the standard PDF fonts can draw. */
export function pdfSafeText(text: string): string {
  const s = String(text)
  if (!NEEDS_MAPPING.test(s)) return s
  let out = ''
  for (const ch of s) out += mapChar(ch)
  return out
}

function cleanArg(value: any) {
  if (typeof value === 'string') return pdfSafeText(value)
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? pdfSafeText(v) : v))
  return value
}

/**
 * Makes every string `doc` draws or measures WinAnsi safe. Wraps the
 * instance's text, splitTextToSize and getStringUnitWidth; textWithLink,
 * getTextWidth and jspdf-autotable all go through those, so measured widths
 * and drawn glyphs always agree. Returns the same doc.
 */
export function installWinAnsiText<T>(doc: T): T {
  const target = doc as any
  for (const name of ['text', 'splitTextToSize', 'getStringUnitWidth']) {
    const original = target[name]
    if (typeof original !== 'function') continue
    target[name] = function (this: any, first: any, ...rest: any[]) {
      return original.call(this, cleanArg(first), ...rest)
    }
  }
  return doc
}
