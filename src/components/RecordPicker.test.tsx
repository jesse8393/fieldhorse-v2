import { describe, expect, it } from 'vitest'
import { filterRecordOptions } from './RecordPicker.tsx'

describe('record search', () => {
  const options = [
    { value: 'job:1', label: 'José Parker', description: 'Driveway · 22 Oak Street · abc123', group: 'Jobs' },
    { value: 'lead:2', label: 'José Parker', description: 'Patio · 50 Main Street · def456', group: 'Leads' }
  ]
  it('matches accent-insensitive words across name, address, project and record type', () => {
    expect(filterRecordOptions(options, 'jose oak jobs')).toEqual([options[0]])
    expect(filterRecordOptions(options, 'patio def456')).toEqual([options[1]])
  })
  it('does not collapse similarly named records or cap search results', () => {
    expect(filterRecordOptions(options, 'jose')).toEqual(options)
    expect(filterRecordOptions(Array.from({ length: 120 }, (_, i) => ({ value: String(i), label: `Job ${i}` })), '119')).toEqual([{ value: '119', label: 'Job 119' }])
  })
  it('shows every option when cleared and no unrelated record when unmatched', () => {
    expect(filterRecordOptions(options, '  ')).toEqual(options)
    expect(filterRecordOptions(options, 'unknown')).toEqual([])
  })
})
