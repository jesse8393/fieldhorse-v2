// The Jobs list on a phone (spec 9.3, decision D3), as a pure view model.
//
// Tabs: All, Leads, Quotes, Jobs, Done. Lost jobs sit behind the filter
// sheet's "Show lost jobs" switch and never count toward a tab. Under All
// the groups run Jobs, Quotes, Leads, Done; the Done group there holds
// only the last 30 days, while the Done tab holds every finished job.
//
// Every line this module writes itself (next steps, chip labels, group
// titles and notes) avoids dashes of any kind. Names and job titles that
// people typed pass through untouched. Money always prints cents and is
// left out entirely when the role may not see it.

import type { JobRow } from './queries.ts'
import { detailRoute, stageLabel } from './stages.ts'
import { moneyCents } from './format.ts'
import { parseDateOnly } from './dates.ts'

export type JobsTab = 'all' | 'leads' | 'quotes' | 'jobs' | 'done'

export const JOBS_TABS: { id: JobsTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'leads', label: 'Leads' },
  { id: 'quotes', label: 'Quotes' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'done', label: 'Done' }
]

export type JobsGroupId = 'jobs' | 'quotes' | 'leads' | 'done' | 'lost'

export type JobsChip = { label: string; tone: 'success' | 'info' | 'danger' | 'neutral' }

export type JobsRowView = {
  id: string
  title: string
  subline: string
  money: string | null
  next: string | null
  chip: JobsChip | null
  to: string
}

export type JobsGroup = {
  id: JobsGroupId
  title: string
  total: number | null
  note: string
  rows: JobsRowView[]
}

/** "next" puts what needs doing soonest first, "amount" the biggest first. */
export type JobsSort = 'next' | 'amount'

/** A schedule visit on a job (fh_schedule start_at against contact_id). */
export type JobsVisit = { contact_id: string | null; start_at: string | null }

export type JobsListInput = {
  jobs: JobRow[]
  tab: JobsTab
  showLost: boolean
  showMoney: boolean
  now: Date
  /** Optional: visits that give jobs their "On site" and "Starts" chips. */
  visits?: JobsVisit[]
  sort?: JobsSort
}

export type JobsList = { counts: Record<JobsTab, number>; groups: JobsGroup[] }

const DAY_MS = 86400000
const DONE_WINDOW_DAYS = 30
const NEW_LEAD_MS = 48 * 3600 * 1000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Bucket = 'leads' | 'quotes' | 'jobs' | 'done' | 'lost'

// Pipeline v2 keeps 'invoice' only as a legacy alias of 'job'. A row with
// no stage is a fresh lead, as the old list treated it.
function bucketOf(stage: string | null | undefined): Bucket {
  switch (String(stage || 'lead').toLowerCase()) {
    case 'quote': return 'quotes'
    case 'job':
    case 'invoice': return 'jobs'
    case 'closed': return 'done'
    case 'lost': return 'lost'
    default: return 'leads'
  }
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Whole calendar days from `from` to `to`, local time, DST safe. */
function dayDiff(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS)
}

function parseInstant(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function shortDate(d: Date, now: Date): string {
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`
}

function clock(d: Date): string {
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h % 12 || 12}:${m} ${h < 12 ? 'am' : 'pm'}`
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "just now", "2 hours ago", "yesterday", "4 days ago", "Sep 20". */
function ago(d: Date, now: Date): string {
  const ms = now.getTime() - d.getTime()
  if (ms < 3600000) return 'just now'
  if (ms < DAY_MS) return `${plural(Math.floor(ms / 3600000), 'hour', 'hours')} ago`
  const days = dayDiff(d, now)
  if (days <= 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return shortDate(d, now)
}

function amountOf(row: JobRow): number {
  const v = Number(row.amount ?? 0)
  return Number.isFinite(v) ? v : 0
}

function finishedAt(row: JobRow): Date | null {
  return parseInstant(row.completed_at) ?? parseInstant(row.updated_at) ?? parseInstant(row.created_at)
}

type FollowUp = { date: Date; days: number }

function followUpOf(row: JobRow, now: Date): FollowUp | null {
  const date = parseDateOnly(row.follow_up_on)
  if (!date) return null
  return { date, days: dayDiff(now, date) }
}

function followUpLine(f: FollowUp, now: Date): string {
  if (f.days === 0) return 'Follow up today'
  if (f.days === 1) return 'Follow up tomorrow'
  return `Follow up ${shortDate(f.date, now)}`
}

function overdueChip(f: FollowUp | null): JobsChip | null {
  if (!f || f.days >= 0) return null
  return { label: `Follow up ${plural(-f.days, 'day', 'days')} overdue`, tone: 'danger' }
}

type VisitInfo = { next: Date | null; hadEarlier: boolean }

function visitsByJob(visits: JobsVisit[] | undefined, now: Date): Map<string, VisitInfo> {
  const out = new Map<string, VisitInfo>()
  const today = startOfDay(now).getTime()
  for (const v of visits || []) {
    const at = parseInstant(v.start_at)
    if (!v.contact_id || !at) continue
    const info = out.get(v.contact_id) || { next: null, hadEarlier: false }
    if (at.getTime() < today) info.hadEarlier = true
    else if (!info.next || at.getTime() < info.next.getTime()) info.next = at
    out.set(v.contact_id, info)
  }
  return out
}

function visitChip(info: VisitInfo | undefined, now: Date): JobsChip | null {
  if (!info?.next) return null
  const days = dayDiff(now, info.next)
  if (days === 0) return { label: `On site ${clock(info.next)}`, tone: 'success' }
  const when = days === 1 ? 'tomorrow' : days < 7 ? WEEKDAYS[info.next.getDay()] : shortDate(info.next, now)
  return { label: info.hadEarlier ? `Next visit ${when}` : `Starts ${when}`, tone: 'info' }
}

function quoteLine(row: JobRow, now: Date): string | null {
  const sent = parseInstant(row.quote_sent_at)
  switch (row.proposal_status) {
    case 'sent': return sent ? `Sent ${ago(sent, now)}` : 'Sent'
    case 'viewed': return sent ? `Viewed, sent ${ago(sent, now)}` : 'Viewed'
    case 'changes_requested': return 'Changes requested'
    case 'approved': return 'Approved'
    case 'expired': return 'Expired'
    case 'rejected': return 'Declined'
    default: return null
  }
}

function isDraftQuote(row: JobRow): boolean {
  return !row.proposal_status || row.proposal_status === 'draft'
}

function leadSourceLine(row: JobRow, now: Date): string | null {
  const created = parseInstant(row.created_at)
  const source = (row.referred_by || '').trim()
  if (source && created) return `${source}, ${ago(created, now)}`
  if (source) return source
  return created ? `Added ${ago(created, now)}` : null
}

type Built = { view: JobsRowView; amount: number; sortAt: number | null; updated: number; finished: number }

function buildRow(
  row: JobRow,
  bucket: Bucket,
  showMoney: boolean,
  now: Date,
  visits: Map<string, VisitInfo>
): Built {
  const follow = bucket === 'done' || bucket === 'lost' ? null : followUpOf(row, now)
  const visit = bucket === 'jobs' ? visits.get(row.id) : undefined
  let chip: JobsChip | null = overdueChip(follow)
  let next: string | null = null
  // The soonest thing that needs doing, for the "Next step" sort.
  const dates: number[] = []
  if (follow) dates.push(follow.date.getTime())

  if (bucket === 'leads') {
    const created = parseInstant(row.created_at)
    if (!chip && created && now.getTime() - created.getTime() < NEW_LEAD_MS) chip = { label: 'New', tone: 'info' }
    next = follow && follow.days >= 0 ? followUpLine(follow, now) : leadSourceLine(row, now)
  } else if (bucket === 'quotes') {
    if (!chip && isDraftQuote(row)) chip = { label: 'Draft', tone: 'neutral' }
    next = quoteLine(row, now) ?? (follow && follow.days >= 0 ? followUpLine(follow, now) : null)
  } else if (bucket === 'jobs') {
    if (!chip) chip = visitChip(visit, now)
    if (visit?.next) dates.push(visit.next.getTime())
    if (row.completed_at) next = 'Work done'
    else if (follow && follow.days >= 0) next = followUpLine(follow, now)
  } else if (bucket === 'done') {
    const at = finishedAt(row)
    next = at ? `Finished ${shortDate(at, now)}` : null
  } else {
    chip = { label: stageLabel('lost'), tone: 'neutral' }
  }

  const amount = amountOf(row)
  const finished = finishedAt(row)?.getTime() ?? 0
  return {
    view: {
      id: row.id,
      title: row.name || row.fh_clients?.name || 'No name yet',
      subline: row.job_title || row.job_type || row.address || '',
      money: showMoney && row.amount != null && amount !== 0 ? moneyCents(amount) : null,
      next,
      chip,
      to: detailRoute(row)
    },
    amount,
    sortAt: dates.length ? Math.min(...dates) : null,
    updated: parseInstant(row.updated_at || row.created_at)?.getTime() ?? 0,
    finished
  }
}

function sortRows(rows: Built[], bucket: Bucket, sort: JobsSort): Built[] {
  const out = rows.slice()
  if (sort === 'amount') {
    out.sort((a, b) => b.amount - a.amount || b.updated - a.updated)
  } else if (bucket === 'done') {
    out.sort((a, b) => b.finished - a.finished)
  } else {
    // Dated rows first, soonest (or most overdue) first; then the rest,
    // most recently touched first.
    out.sort((a, b) => {
      if (a.sortAt != null && b.sortAt != null) return a.sortAt - b.sortAt || b.updated - a.updated
      if (a.sortAt != null) return -1
      if (b.sortAt != null) return 1
      return b.updated - a.updated
    })
  }
  return out
}

const TITLES: Record<JobsGroupId, string> = {
  jobs: 'Jobs',
  quotes: 'Quotes',
  leads: 'Leads',
  done: 'Done',
  lost: stageLabel('lost')
}

function noteFor(id: JobsGroupId, rows: Built[], allRows: JobRow[], showMoney: boolean, now: Date, recentOnly: boolean): string {
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const amountOrCount = showMoney ? moneyCents(total) : String(rows.length)
  switch (id) {
    case 'jobs': return `${amountOrCount} in progress`
    case 'quotes': return `${amountOrCount} waiting`
    case 'lost': return `${amountOrCount} not won`
    case 'done': return recentOnly ? `Last ${DONE_WINDOW_DAYS} days` : 'All time'
    case 'leads': {
      const weekAgo = now.getTime() - 7 * DAY_MS
      const fresh = allRows.filter((r) => (parseInstant(r.created_at)?.getTime() ?? 0) >= weekAgo).length
      return fresh === 0 ? 'No new leads this week' : `${fresh} new this week`
    }
  }
}

export function buildJobsList(input: JobsListInput): JobsList {
  const { jobs, tab, showLost, showMoney, now } = input
  // Ordering by amount would hint at amounts the role may not see.
  const sort: JobsSort = showMoney && input.sort === 'amount' ? 'amount' : 'next'
  const visits = visitsByJob(input.visits, now)

  const byBucket: Record<Bucket, JobRow[]> = { leads: [], quotes: [], jobs: [], done: [], lost: [] }
  const seen = new Set<string>()
  for (const row of jobs) {
    if (!row?.id || seen.has(row.id)) continue
    seen.add(row.id)
    byBucket[bucketOf(row.stage)].push(row)
  }

  const counts: Record<JobsTab, number> = {
    leads: byBucket.leads.length,
    quotes: byBucket.quotes.length,
    jobs: byBucket.jobs.length,
    done: byBucket.done.length,
    all: byBucket.leads.length + byBucket.quotes.length + byBucket.jobs.length + byBucket.done.length
  }

  const doneCutoff = startOfDay(now).getTime() - DONE_WINDOW_DAYS * DAY_MS
  const order: Record<JobsTab, Bucket[]> = {
    all: ['jobs', 'quotes', 'leads', 'done'],
    leads: ['leads'],
    quotes: ['quotes'],
    jobs: ['jobs'],
    done: ['done']
  }
  const buckets = showLost ? [...order[tab], 'lost' as const] : order[tab]

  const groups: JobsGroup[] = []
  for (const bucket of buckets) {
    const recentOnly = bucket === 'done' && tab === 'all'
    const source = recentOnly
      ? byBucket.done.filter((r) => (finishedAt(r)?.getTime() ?? 0) >= doneCutoff)
      : byBucket[bucket]
    if (source.length === 0) continue
    const built = sortRows(source.map((r) => buildRow(r, bucket, showMoney, now, visits)), bucket, sort)
    groups.push({
      id: bucket,
      title: TITLES[bucket],
      total: showMoney ? built.reduce((s, r) => s + r.amount, 0) : null,
      note: noteFor(bucket, built, source, showMoney, now, recentOnly),
      rows: built.map((b) => b.view)
    })
  }

  return { counts, groups }
}
