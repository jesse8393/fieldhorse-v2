import { describe, expect, it } from 'vitest'
import { cityLine } from './companyLine.ts'

describe('cityLine', () => {
  it('pulls the city and state from a full address', () => {
    expect(cityLine('2210 Ridgecrest Dr, Murfreesboro, TN 37130')).toBe('Murfreesboro, TN')
    expect(cityLine('2210 Ridgecrest Dr\nMurfreesboro, TN 37130')).toBe('Murfreesboro, TN')
    expect(cityLine('1 Main St, Suite 4, Franklin, Tennessee')).toBe('Franklin, Tennessee')
  })

  it('handles short addresses', () => {
    expect(cityLine('Murfreesboro, TN 37130')).toBe('Murfreesboro, TN')
    expect(cityLine('Murfreesboro, TN')).toBe('Murfreesboro, TN')
    expect(cityLine('2210 Ridgecrest Dr, Murfreesboro')).toBe('Murfreesboro')
  })

  it('returns null when there is nothing to show', () => {
    expect(cityLine(null)).toBeNull()
    expect(cityLine('')).toBeNull()
    expect(cityLine('2210 Ridgecrest Dr')).toBeNull()
  })
})
