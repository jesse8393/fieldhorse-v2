import { describe, expect, it } from 'vitest'
import { money } from './format.ts'
import { moneyCents } from '../../lib/format.ts'

// formats-6: the customer documents print money the way the PDF does,
// always with cents, so "$6,400 of $12,800 collected" never sits under
// "AMOUNT DUE $6,400.00" on the same invoice.
describe('document money', () => {
  it('prints whole amounts with .00', () => {
    expect(money(6400)).toBe('$6,400.00')
    expect(money(46_200)).toBe('$46,200.00')
    expect(money(0)).toBe('$0.00')
  })

  it('prints cents the same with or without the cents option', () => {
    expect(money(6400, { cents: false })).toBe('$6,400.00')
    expect(money(6400, { cents: true })).toBe('$6,400.00')
    expect(money(12_499.5)).toBe('$12,499.50')
  })

  it('matches the app formatter for every kind of input', () => {
    for (const n of [0, 6400, 6400.5, 1234.567, -1200, '12345.5', null, undefined, 'abc']) {
      expect(money(n as never)).toBe(moneyCents(n as never))
    }
  })
})
