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
  it('drops text that is not a web address (D07)', () => {
    expect(safePayUrl('not a link')).toBe('')
    expect(safePayUrl('pay@co.com')).toBe('')
    expect(safePayUrl('615-555-0100')).toBe('')
    expect(safePayUrl('zelle')).toBe('')
    expect(safePayUrl('https://not a link')).toBe('')
    expect(safePayUrl('https://user:pw@evil.com/pay')).toBe('')
    expect(safePayUrl('https://')).toBe('')
  })
  it('keeps real web addresses with a path or query', () => {
    expect(safePayUrl('www.paypal.me/parker')).toBe('https://www.paypal.me/parker')
    expect(safePayUrl('https://checkout.square.site/pay?x=1')).toBe('https://checkout.square.site/pay?x=1')
  })
})
