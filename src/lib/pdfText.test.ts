import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'
import { pdfSafeText, installWinAnsiText } from './pdfText.ts'

// Every string jsPDF drew for one page, as written into the content stream.
function drawnStrings(doc: any, page = 1): string[] {
  return (doc.internal.pages[page] as string[])
    .flatMap((op) => [...op.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1]))
}

describe('pdfSafeText', () => {
  it('leaves plain ASCII and WinAnsi characters alone', () => {
    const s = 'Paid $500.00 \u00B7 Jos\u00E9\u2019s \u201Cquote\u201D \u2013 50% \u2022 12\u00BD in \u00D7 3 \u2026 \u2122 \u20AC'
    expect(pdfSafeText(s)).toBe(s)
    expect(pdfSafeText('line one\nline two')).toBe('line one\nline two')
  })

  it('maps signs, arrows, primes and spaces the standard fonts cannot draw', () => {
    expect(pdfSafeText('\u2212$300.00')).toBe('-$300.00')
    expect(pdfSafeText('Pay online \u2192 venmo.com')).toBe('Pay online -> venmo.com')
    expect(pdfSafeText('12\u2032 6\u2033')).toBe(`12' 6"`)
    expect(pdfSafeText('\u2265 3 coats')).toBe('>= 3 coats')
    expect(pdfSafeText('a\u2003b\u2009c\u202Fd')).toBe('a b c d')
    expect(pdfSafeText('zero\u200Bwidth\uFEFF')).toBe('zerowidth')
    expect(pdfSafeText('soft\u00ADhyphen')).toBe('softhyphen')
  })

  it('drops accents outside the set and marks anything else with ?', () => {
    expect(pdfSafeText('Nguy\u1EC5n')).toBe('Nguyen')
    expect(pdfSafeText('\uFB01ne')).toBe('fine')
    expect(pdfSafeText('1\u20443 coat')).toBe('1/3 coat')
    expect(pdfSafeText('Joe \u{1F44D}')).toBe('Joe ?')
    expect(pdfSafeText('\u674E')).toBe('?')
  })
})

describe('installWinAnsiText', () => {
  it('stops one stray character from turning the whole line into two byte junk', () => {
    const raw = new jsPDF({ unit: 'mm', format: 'letter' })
    raw.text('Paid to date \u2212$500.00', 10, 10)
    expect(drawnStrings(raw)[0]).toContain('\u0000')

    const doc = installWinAnsiText(new jsPDF({ unit: 'mm', format: 'letter' }))
    doc.text('Paid to date \u2212$500.00', 10, 10)
    doc.text(['Pay online \u2192 x', 'ok'], 10, 20)
    doc.textWithLink('Pay online \u2192 venmo.com/u/parker', 10, 30, { url: 'https://venmo.com/u/parker' })
    const strings = drawnStrings(doc)
    expect(strings).toContain('Paid to date -$500.00')
    expect(strings).toContain('Pay online -> x')
    expect(strings.join('')).not.toContain('\u0000')
  })

  it('measures the same text it draws', () => {
    const doc = installWinAnsiText(new jsPDF({ unit: 'mm', format: 'letter' }))
    expect(doc.getTextWidth('\u2212$5')).toBeCloseTo(doc.getTextWidth('-$5'), 6)
    expect(doc.splitTextToSize('a\u2003b', 100)).toEqual(['a b'])
  })
})
