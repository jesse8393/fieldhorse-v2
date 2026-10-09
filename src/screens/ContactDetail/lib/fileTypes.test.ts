import { describe, expect, it } from 'vitest'
import { extensionOf, isBlockedUpload, opensInline } from './fileTypes.ts'

describe('extensionOf', () => {
  it('returns the lowercase extension', () => {
    expect(extensionOf('Permit.PDF')).toBe('pdf')
    expect(extensionOf('site.plan.v2.dwg')).toBe('dwg')
  })

  it('returns nothing for names without a clean extension', () => {
    expect(extensionOf('README')).toBe('')
    expect(extensionOf('notes.')).toBe('')
    expect(extensionOf('weird.p#f')).toBe('')
    expect(extensionOf(null)).toBe('')
  })
})

describe('isBlockedUpload', () => {
  it('refuses web pages, SVG and XML by type or by name', () => {
    expect(isBlockedUpload({ name: 'invoice.html', type: 'text/html' })).toBe(true)
    expect(isBlockedUpload({ name: 'invoice.HTM', type: '' })).toBe(true)
    expect(isBlockedUpload({ name: 'logo.svg', type: 'image/svg+xml' })).toBe(true)
    expect(isBlockedUpload({ name: 'renamed.pdf', type: 'text/html; charset=utf-8' })).toBe(true)
    expect(isBlockedUpload({ name: 'feed.xml', type: 'application/xml' })).toBe(true)
  })

  it('accepts ordinary documents', () => {
    expect(isBlockedUpload({ name: 'permit.pdf', type: 'application/pdf' })).toBe(false)
    expect(isBlockedUpload({ name: 'bid.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })).toBe(false)
    expect(isBlockedUpload({ name: 'plans.dwg', type: '' })).toBe(false)
    expect(isBlockedUpload({ name: 'site.jpg', type: 'image/jpeg' })).toBe(false)
  })
})

describe('opensInline', () => {
  it('opens PDFs and plain images in a tab', () => {
    expect(opensInline({ mime_type: 'application/pdf', filename: 'contract.pdf' })).toBe(true)
    expect(opensInline({ mime_type: 'image/png', filename: 'sketch.PNG' })).toBe(true)
  })

  it('downloads everything else, and anything whose type and name disagree', () => {
    expect(opensInline({ mime_type: 'text/html', filename: 'page.html' })).toBe(false)
    expect(opensInline({ mime_type: 'image/svg+xml', filename: 'logo.svg' })).toBe(false)
    expect(opensInline({ mime_type: 'application/pdf', filename: 'page.html' })).toBe(false)
    expect(opensInline({ mime_type: null, filename: 'contract.pdf' })).toBe(false)
    expect(opensInline({ mime_type: 'application/zip', filename: 'photos.zip' })).toBe(false)
    expect(opensInline(null)).toBe(false)
  })
})
