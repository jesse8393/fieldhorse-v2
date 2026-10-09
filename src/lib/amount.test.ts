import { describe, it, expect } from 'vitest'
import { parseAmount } from './amount.ts'

describe('parseAmount', () => {
  it('reads currency formatted spreadsheet cells', () => {
    expect(parseAmount('$4,500.00')).toBe(4500)
    expect(parseAmount('4,500')).toBe(4500)
    expect(parseAmount(' 1200 ')).toBe(1200)
    expect(parseAmount('$ 12,000')).toBe(12000)
    expect(parseAmount('USD 4,500')).toBe(4500)
  })

  it('passes real numbers through', () => {
    expect(parseAmount(4500)).toBe(4500)
    expect(parseAmount(0)).toBe(0)
    expect(parseAmount('1.5')).toBe(1.5)
  })

  it('keeps negatives, including accounting parentheses', () => {
    expect(parseAmount('-$50')).toBe(-50)
    expect(parseAmount('(1,200.00)')).toBe(-1200)
  })

  it('takes the leading number from text with units', () => {
    expect(parseAmount('2 sq ft')).toBe(2)
  })

  it('returns null when there is no number', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('   ')).toBeNull()
    expect(parseAmount('$')).toBeNull()
    expect(parseAmount('N/A')).toBeNull()
    expect(parseAmount(null)).toBeNull()
    expect(parseAmount(undefined)).toBeNull()
    expect(parseAmount(NaN)).toBeNull()
    expect(parseAmount({})).toBeNull()
  })
})
