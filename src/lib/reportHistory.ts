import { todayYmd } from './dates.ts'

export type ReportJob = { id: string; name?: string | null; job_title?: string | null; address?: string | null }
export type ReportRecord = { id: string; text?: string | null; body?: string | null; title?: string | null; contact_id?: string | null; created_at?: string | null; parsed?: unknown }

/** Include a stable record reference even when two jobs share a name and address. */
export function reportJobLabel(job: ReportJob): string {
  return [job.name || 'Unnamed customer', job.job_title, job.address, `Job ${job.id.slice(-8)}`].filter(Boolean).join(' · ')
}

function parsedReport(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export type ReportFilters = { jobId?: string; linkage?: string; from?: string; to?: string }

export function filterReports<T extends ReportRecord>(reports: T[], jobs: ReportJob[], query: string, filters: ReportFilters = {}): T[] {
  const needle = query.trim().toLocaleLowerCase()
  const jobLabels = new Map(jobs.map(job => [job.id, reportJobLabel(job)]))
  return reports.filter(report => {
    if (filters.jobId && report.contact_id !== filters.jobId) return false
    if (filters.linkage === 'unlinked' && report.contact_id) return false
    if (filters.linkage === 'linked' && !report.contact_id) return false
    if (filters.linkage === 'unavailable' && (!report.contact_id || jobLabels.has(report.contact_id))) return false
    if (filters.from || filters.to) {
      const date = new Date(report.created_at || '')
      if (!Number.isFinite(date.getTime())) return false
      const day = todayYmd(date)
      if (filters.from && day < filters.from) return false
      if (filters.to && day > filters.to) return false
    }
    if (!needle) return true
    const parsed = parsedReport(report.parsed)
    const content = [report.text, report.body, report.title, report.contact_id ? jobLabels.get(report.contact_id) : 'Unlinked',
      parsed.summary, parsed.action_items, parsed.risks, parsed.materials_needed, parsed.follow_up_date]
    return content.flat().filter(value => typeof value === 'string').join(' ').toLocaleLowerCase().includes(needle)
  })
}

/** Every report contributes to lifetime totals, independent of the visible page or search. */
export function reportStats(reports: ReportRecord[], now = Date.now()) {
  let recent24 = 0
  let parsedCount = 0
  let riskCount = 0
  let unlinkedCount = 0
  for (const report of reports) {
    const age = now - Date.parse(report.created_at || '')
    if (age >= 0 && age < 86_400_000) recent24++
    const parsed = parsedReport(report.parsed)
    if (Object.values(parsed).some(value => Array.isArray(value) ? value.length > 0 : Boolean(value))) parsedCount++
    if (Array.isArray(parsed.risks) && parsed.risks.length > 0) riskCount++
    if (!report.contact_id) unlinkedCount++
  }
  return { total: reports.length, recent24, parsedCount, riskCount, unlinkedCount }
}
