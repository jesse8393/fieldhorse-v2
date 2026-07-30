import { describe, expect, it } from 'vitest'
import { countNoun } from './format.ts'

describe('countNoun', () => {
  it('uses the singular noun only for exactly one', () => {
    expect(countNoun(1, 'quote')).toBe('quote')
    expect(countNoun(0, 'quote')).toBe('quotes')
    expect(countNoun(2, 'quote')).toBe('quotes')
  })

  it('supports irregular plurals', () => {
    expect(countNoun(1, 'person', 'people')).toBe('person')
    expect(countNoun(3, 'person', 'people')).toBe('people')
  })
})
