import { describe, expect, it } from 'vitest'
import { headerName } from './headerName.ts'

describe('headerName', () => {
  it('prefers the workspace name', () => {
    expect(headerName('Parker Construction', 'Parker Construction Company', 'Jesse Parker')).toBe('Parker Construction')
  })

  it('falls back to the company name without a trailing Company', () => {
    expect(headerName(null, 'Parker Construction Company', null)).toBe('Parker Construction')
  })

  it('drops a trailing Co.', () => {
    expect(headerName(null, 'Shyld Roofing Co.', null)).toBe('Shyld Roofing')
  })

  it('drops a trailing LLC and the comma before it', () => {
    expect(headerName('Ridge Line Builders, LLC', null, null)).toBe('Ridge Line Builders')
  })

  it('falls back to the person', () => {
    expect(headerName(null, null, 'Jesse Parker')).toBe('Jesse Parker')
  })

  it('says Your company when nothing is set', () => {
    expect(headerName('', '  ', null)).toBe('Your company')
  })

  it('keeps a name that is only the suffix word', () => {
    expect(headerName('Company', null, null)).toBe('Company')
  })

  it('leaves the suffix words alone in the middle of a name', () => {
    expect(headerName('Company Store Remodeling', null, null)).toBe('Company Store Remodeling')
  })
})
