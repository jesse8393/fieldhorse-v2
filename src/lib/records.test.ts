import { describe, expect, it } from 'vitest'
import { newRecordRoute, recordRoute, type RecordKind } from './records.ts'

const kinds: [RecordKind, string][] = [
  ['lead', '/leads'],
  ['quote', '/quotes'],
  ['job', '/jobs'],
  ['invoice', '/invoices'],
  ['client', '/clients'],
]

describe('recordRoute', () => {
  it.each(kinds)('routes a %s to its detail screen', (kind, base) => {
    expect(recordRoute(kind, 'abc-123')).toBe(`${base}/abc-123`)
  })
})

describe('newRecordRoute', () => {
  it.each(kinds)('routes a new %s to its create screen', (kind, base) => {
    expect(newRecordRoute(kind)).toBe(`${base}/new`)
  })

  it('appends the params as a query string', () => {
    expect(newRecordRoute('quote', { clientId: 'c1', leadId: 'l1' })).toBe('/quotes/new?clientId=c1&leadId=l1')
  })

  it('encodes keys and values', () => {
    expect(newRecordRoute('job', { title: 'Deck & rail' })).toBe('/jobs/new?title=Deck+%26+rail')
  })

  it('adds no question mark when the params are empty', () => {
    expect(newRecordRoute('lead', {})).toBe('/leads/new')
  })
})
