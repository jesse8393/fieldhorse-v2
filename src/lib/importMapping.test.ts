import { describe, it, expect } from 'vitest'
import { buildHeaderMap, mapRows, markFileRepeats, looksLikeCsv } from './importMapping.ts'

const HUBSPOT = ['First Name', 'Last Name', 'Email', 'Phone Number', 'Deal Name', 'Amount']
const JOBBER = ['Display Name', 'Title', 'First Name', 'Last Name', 'Company Name', 'Main Phone #s', 'E-mails', 'Billing Street 1']

describe('buildHeaderMap (D04)', () => {
  it('maps first and last name columns instead of calling the first name the name', () => {
    const hm = buildHeaderMap(HUBSPOT, 'hubspot')
    expect(hm.name).toBeUndefined()
    expect(hm.first_name).toBe('First Name')
    expect(hm.last_name).toBe('Last Name')
    expect(hm.job_title).toBe('Deal Name')
    expect(hm.phone).toBe('Phone Number')
  })

  it('takes the name from Display Name in a Jobber export, not Company Name, and ignores the honorific Title', () => {
    const hm = buildHeaderMap(JOBBER, 'jobber')
    expect(hm.name).toBe('Display Name')
    expect(hm.job_title).toBeUndefined()
    expect(hm.phone).toBe('Main Phone #s')
    expect(hm.email).toBe('E-mails')
    expect(hm.address).toBe('Billing Street 1')
  })

  it('never lets a later synonym overwrite a field already mapped', () => {
    const hm = buildHeaderMap(['Name', 'Contact', 'Phone', 'Mobile'], 'generic')
    expect(hm.name).toBe('Name')
    expect(hm.phone).toBe('Phone')
  })

  it('uses the preset: a HubSpot Title column is a job title, a Jobber one is not', () => {
    expect(buildHeaderMap(['Name', 'Title'], 'hubspot').job_title).toBe('Title')
    expect(buildHeaderMap(['Name', 'Title'], 'jobber').job_title).toBeUndefined()
  })

  it('falls back to the company only when there is no person name', () => {
    expect(buildHeaderMap(['Company Name', 'Phone'], 'generic').company).toBe('Company Name')
    expect(buildHeaderMap(['Company Name', 'Phone'], 'generic').name).toBeUndefined()
  })
})

describe('mapRows (D04, D11)', () => {
  it('joins first and last name so different people stay different', () => {
    const hm = buildHeaderMap(HUBSPOT, 'hubspot')
    const { records } = mapRows([
      { 'First Name': 'John', 'Last Name': 'Carter', Email: '', 'Phone Number': '', 'Deal Name': 'Fence', Amount: '1200' },
      { 'First Name': 'John', 'Last Name': 'Baker', Email: '', 'Phone Number': '', 'Deal Name': 'Deck', Amount: '800' },
    ], hm)
    expect(records.map((r) => r.name)).toEqual(['John Carter', 'John Baker'])
    expect(records[0].amount).toBe(1200)
  })

  it('uses the company as the name when no person name is filled in', () => {
    const hm = buildHeaderMap(JOBBER, 'jobber')
    const { records } = mapRows([
      { 'Display Name': '', Title: '', 'First Name': '', 'Last Name': '', 'Company Name': 'Smith Homes', 'Main Phone #s': '615-555-0201', 'E-mails': '', 'Billing Street 1': '' },
    ], hm)
    expect(records[0].name).toBe('Smith Homes')
  })

  it('trims names and counts rows skipped for having no name', () => {
    const hm = buildHeaderMap(['Name', 'Phone'], 'generic')
    const { records, skipped } = mapRows([
      { Name: '  Ada Stone ', Phone: '1' },
      { Name: '', Phone: '2' },
      { Name: '   ', Phone: '3' },
    ], hm)
    expect(records.map((r) => r.name)).toEqual(['Ada Stone'])
    expect(skipped).toBe(2)
  })
})

describe('markFileRepeats (D10)', () => {
  it('flags rows that repeat an earlier row in the same file', () => {
    expect(markFileRepeats([
      { name: 'Ada Stone', phone: '615-555-0111', email: 'ada@stone.com', job_title: 'Driveway' },
      { name: 'Ada Stone', phone: '615-555-0111', email: 'ada@stone.com', job_title: 'Driveway' },
      { name: 'Ada Stone', phone: '(615) 555-0111', email: 'ADA@stone.com', job_title: 'Driveway' },
      { name: 'Ada Stone', phone: '615-555-0111', email: 'ada@stone.com', job_title: 'Patio' },
      { name: 'Ben Ortiz', phone: '615-555-0112', email: 'ben@ortiz.com', job_title: 'Patio' },
    ])).toEqual([false, true, true, false, false])
  })
})

describe('looksLikeCsv (D11)', () => {
  it('accepts csv and plain text files and rejects spreadsheets and images', () => {
    expect(looksLikeCsv({ name: 'clients.csv', type: 'text/csv' })).toBe(true)
    expect(looksLikeCsv({ name: 'CLIENTS.CSV', type: '' })).toBe(true)
    expect(looksLikeCsv({ name: 'export.txt', type: 'text/plain' })).toBe(true)
    expect(looksLikeCsv({ name: 'clients.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })).toBe(false)
    expect(looksLikeCsv({ name: 'logo.png', type: 'image/png' })).toBe(false)
  })
})
