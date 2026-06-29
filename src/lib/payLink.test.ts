import { describe, it, expect } from 'vitest'
import { safePayUrl } from './payLink.ts'

describe('safePayUrl', () => {
  it('passes through http(s)/mailto/tel', () => {
    expect(safePayUrl('https://buy.stripe.com/x')).toBe('https://buy.stripe.com/x')
    expect(safePayUrl('http://venmo.com/u/x')).toBe('http://venmo.com/u/x')
    expect(safePayUrl('mailto:pay@co.com')).toBe('mailto:pay@co.com')
    expect(safePayUrl('tel:+16155550100')).toBe('tel:+16155550100')
  })
  it('prepends https:// to a bare host', () => {
    expect(safePayUrl('venmo.com/u/parker')).toBe('https://venmo.com/u/parker')
    expect(safePayUrl('cash.app/$parker')).toBe('https://cash.app/$parker')
  })
  it('drops dangerous schemes', () => {
    expect(safePayUrl('javascript:alert(1)')).toBe('')
    expect(safePayUrl('JavaScript:alert(1)')).toBe('')
    expect(safePayUrl('data:text/html,<script>')).toBe('')
    expect(safePayUrl('vbscript:msgbox(1)')).toBe('')
  })
  it('handles empty / whitespace / null', () => {
    expect(safePayUrl('')).toBe('')
    expect(safePayUrl('   ')).toBe('')
    expect(safePayUrl(null)).toBe('')
  })
})
