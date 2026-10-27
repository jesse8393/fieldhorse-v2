import { buildJobsList, type JobsGroup, type JobsList, type JobsListInput } from './jobsList.ts'
import { buildLeadRows, buildQuoteRows } from './leadsView.ts'
import type { JobRow, LeadRow, LeadVisit, QuoteRow } from './queries.ts'

// Leads and quotes now have their own tables. Never treat an old contact
// mirror as a second record or use its ID to write the newer entity.
export function searchWorkJobs(contacts: JobRow[], serverHits: JobRow[], search: string): JobRow[] {
  const isJob = (row: JobRow) => ['job', 'invoice', 'closed', 'lost'].includes(row.stage || '')
  const query = search.trim().toLowerCase()
  const rows = contacts.filter((row) => isJob(row) && (!query ||
    [row.name, row.phone, row.email, row.address, row.referred_by, row.job_type, row.job_title]
      .some((value) => value && value.toLowerCase().includes(query))))
  const seen = new Set(rows.map((row) => row.id))
  // Server search normalizes phone punctuation. Do not discard its matches
  // by applying the literal local search a second time.
  if (query) for (const row of serverHits) {
    if (isJob(row) && !seen.has(row.id)) { rows.push(row); seen.add(row.id) }
  }
  return rows
}

type WorkListInput = JobsListInput & {
  leads: LeadRow[]
  quotes: QuoteRow[]
  leadVisits?: LeadVisit[]
  search?: string
  fieldView: boolean
}

export function buildWorkList(input: WorkListInput): JobsList {
  const jobs = input.jobs.filter((row) => ['job', 'invoice', 'closed', 'lost'].includes(row.stage || ''))
  const tab = input.fieldView && (input.tab === 'leads' || input.tab === 'quotes') ? 'all' : input.tab
  const contacts = buildJobsList({ ...input, jobs, tab })
  const leads = input.fieldView ? [] : buildLeadRows(input.leads, { search: input.search, visits: input.leadVisits, now: input.now })
  const quotes = input.fieldView ? [] : buildQuoteRows(input.quotes, { search: input.search, showMoney: input.showMoney })
  if (input.sort === 'amount' && input.showMoney) {
    const amounts = new Map(input.quotes.map((quote) => [quote.id, quote.amount]))
    quotes.sort((a, b) => (amounts.get(b.id) ?? 0) - (amounts.get(a.id) ?? 0))
  }
  const sales: JobsGroup[] = [
    { id: 'quotes', title: 'Quotes', total: null, note: `${quotes.length} ${quotes.length === 1 ? 'quote' : 'quotes'}`, rows: quotes },
    { id: 'leads', title: 'Leads', total: null, note: `${leads.length} ${leads.length === 1 ? 'lead' : 'leads'}`, rows: leads }
  ].filter((group) => group.rows.length > 0) as JobsGroup[]
  let groups = contacts.groups
  if (tab === 'all') {
    groups = [
      ...groups.filter((group) => group.id === 'jobs'),
      ...sales,
      ...groups.filter((group) => group.id === 'done' || group.id === 'lost')
    ]
  } else if (tab === 'leads' || tab === 'quotes') {
    groups = [...sales.filter((group) => group.id === tab), ...groups.filter((group) => group.id === 'lost')]
  }
  return {
    counts: { ...contacts.counts, leads: leads.length, quotes: quotes.length, all: contacts.counts.all + leads.length + quotes.length },
    groups
  }
}
