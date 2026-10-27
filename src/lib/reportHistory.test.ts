import { describe, expect, it } from 'vitest'
import { filterReports, reportJobLabel, reportStats } from './reportHistory.ts'

describe('field report history', () => {
  const jobs = [
    { id: 'job-one', name: 'Sam Lane', job_title: 'Roof repairs', address: '10 Oak Street' },
    { id: 'job-two', name: 'Sam Lane', job_title: 'Drainage', address: '20 Oak Street' },
  ]
  it('distinguishes jobs for the same customer with scope, property and record reference', () => {
    expect(reportJobLabel(jobs[0])).toBe('Sam Lane · Roof repairs · 10 Oak Street · Job job-one')
    expect(reportJobLabel(jobs[1])).not.toBe(reportJobLabel(jobs[0]))
    expect(reportJobLabel({ id: 'job-three', name: 'Sam Lane' })).toContain('Job ob-three')
  })
  it('searches old reports and job context before applying a display window', () => {
    const reports = Array.from({ length: 90 }, (_, index) => ({ id: `note-${index}`, text: `Daily report ${index}`, contact_id: index === 89 ? 'job-two' : 'job-one' }))
    expect(filterReports(reports, jobs, '20 oak')).toEqual([reports[89]])
    expect(filterReports(reports, jobs, 'DAILY REPORT 89')).toEqual([reports[89]])
    expect(filterReports(reports, jobs, '  ')).toHaveLength(90)
    expect(filterReports(reports, jobs, 'no match')).toEqual([])
  })
  it('finds parsed details and unlinked records without requiring visible preview text', () => {
    const reports = [
      { id: '1', text: 'Visit', contact_id: 'job-one', parsed: { materials_needed: ['Copper pipe'] } },
      { id: '2', text: 'Unassigned inspection', contact_id: null },
    ]
    expect(filterReports(reports, jobs, 'copper').map(report => report.id)).toEqual(['1'])
    expect(filterReports(reports, jobs, 'unlinked').map(report => report.id)).toEqual(['2'])
  })
  it('counts all history separately from last24h and does not call an unresolved link missing', () => {
    const now = Date.parse('2026-10-27T12:00:00Z')
    const reports = [
      { id: 'today', created_at: '2026-10-27T11:00:00Z', contact_id: 'job-one' },
      { id: 'old', created_at: '2026-09-01T11:00:00Z', contact_id: null, parsed: { summary: 'Inspection', risks: ['Rain', 'Access'] } },
      { id: 'unavailable', created_at: '2026-10-01T11:00:00Z', contact_id: 'no-longer-visible' },
      { id: 'future', created_at: '2026-10-28T11:00:00Z', contact_id: 'job-two' },
    ]
    expect(reportStats(reports, now)).toEqual({ total: 4, recent24: 1, parsedCount: 1, riskCount: 1, unlinkedCount: 1 })
  })
  it('combines job, linkage and inclusive local calendar dates before pagination', () => {
    const reports = [
      { id: 'start', text: 'Footing', contact_id: 'job-one', created_at: new Date(2026, 9, 1, 0, 0).toISOString() },
      { id: 'end', text: 'Footing', contact_id: 'job-one', created_at: new Date(2026, 9, 31, 23, 59).toISOString() },
      { id: 'outside', text: 'Footing', contact_id: 'job-one', created_at: new Date(2026, 10, 1, 0, 0).toISOString() },
      { id: 'other', text: 'Footing', contact_id: 'job-two', created_at: new Date(2026, 9, 10).toISOString() },
      { id: 'missing', text: 'Footing', contact_id: null },
      { id: 'removed', text: 'Footing', contact_id: 'removed-job' },
      { id: 'invalid', text: 'Footing', contact_id: 'job-one', created_at: 'invalid' },
    ]
    expect(filterReports(reports, jobs, 'foot', { jobId: 'job-one', from: '2026-10-01', to: '2026-10-31' }).map(row => row.id)).toEqual(['start', 'end'])
    expect(filterReports(reports, jobs, '', { linkage: 'unlinked' }).map(row => row.id)).toEqual(['missing'])
    expect(filterReports(reports, jobs, '', { linkage: 'unavailable' }).map(row => row.id)).toEqual(['removed'])
    expect(filterReports(reports, jobs, '', { from: '2026-10-31', to: '2026-10-01' })).toEqual([])
  })
})
