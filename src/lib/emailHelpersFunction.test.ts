import { describe, expect, it } from 'vitest'
import { formatFromHeader, renderParagraphs, textField } from '../../netlify/functions/lib/email.js'

const safe = (s: string) => String(s || '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c] as string))

describe('From header', () => {
  const addr = 'notifications@fieldhorse.io'

  it('quotes the display name so commas and ampersands are safe', () => {
    expect(formatFromHeader('Smith & Sons, LLC', addr)).toBe('"Smith & Sons, LLC" <notifications@fieldhorse.io>')
  })

  it('drops quotes, backslashes, angle brackets and line breaks from the name', () => {
    expect(formatFromHeader('J. "Bud" Parker\\Construction', addr)).toBe('"J. Bud Parker Construction" <notifications@fieldhorse.io>')
    expect(formatFromHeader('Evil <ceo@bank.example>', addr)).toBe('"Evil ceo@bank.example" <notifications@fieldhorse.io>')
    expect(formatFromHeader('Acme\r\nBcc: victim@example.com', addr)).toBe('"Acme Bcc: victim@example.com" <notifications@fieldhorse.io>')
  })

  it('falls back to a neutral name when nothing printable is left', () => {
    expect(formatFromHeader('""', addr)).toBe('"Notifications" <notifications@fieldhorse.io>')
    expect(formatFromHeader('', addr, 'FieldHorse')).toBe('"FieldHorse" <notifications@fieldhorse.io>')
  })
})

describe('optional text fields', () => {
  it('trims strings and reads anything else as empty', () => {
    expect(textField('  Pat Smith ')).toBe('Pat Smith')
    expect(textField(123)).toBe('')
    expect(textField({ name: 'x' })).toBe('')
    expect(textField(null)).toBe('')
    expect(textField(undefined)).toBe('')
  })
})

describe('paragraphs for the HTML part', () => {
  it('keeps blank line paragraphs and single line breaks', () => {
    const html = renderParagraphs('Hi Pat,\r\n\r\nThe roof is done.\nPhotos attached.\n\n\nThanks', safe)
    expect(html).toBe(
      '<p style="margin:0 0 14px;">Hi Pat,</p>' +
      '<p style="margin:0 0 14px;">The roof is done.<br>Photos attached.</p>' +
      '<p style="margin:0 0 0;">Thanks</p>'
    )
  })

  it('escapes markup and ignores empty input', () => {
    expect(renderParagraphs('<b>5 > 3</b>', safe)).toBe('<p style="margin:0 0 0;">&lt;b&gt;5 &gt; 3&lt;/b&gt;</p>')
    expect(renderParagraphs('  \n\n ', safe)).toBe('')
  })
})
