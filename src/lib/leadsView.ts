// The lead list and the lead screen as pure view helpers (PHASE9_PLAN
// Task 9, SPEC D55, D60, D65). Nothing here touches the network, so the
// screens stay thin and the rules can be unit tested.
//
// Every line this module writes itself avoids dashes of any kind. Names
// and titles people typed pass through untouched.

import type { LeadRow, LeadVisit, QuoteRow } from './queries.ts'
import type { ChipTone } from '../components/fh/Chip.tsx'
import { parseDateOnly } from './dates.ts'
import { moneyCents } from './format.ts'
import { recordRoute } from './records.ts'
import type { JobsRowView } from './jobsList.ts'

export type LeadChip = { label: string; tone: ChipTone }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Leads the list shows: open and quoted. Lost leads are kept, not listed. */
export function listedLeads(leads: LeadRow[]): LeadRow[] {
  return leads.filter((l) => l.status !== 'lost')
}

/**
 * Soonest follow up first (a lead with no follow up date sorts after one
 * with any), then the newest lead first.
 */
export function sortLeads(leads: LeadRow[]): LeadRow[] {
  return [...leads].sort((a, b) => {
    const fa = a.follow_up_on ?? ''
    const fb = b.follow_up_on ?? ''
    if (fa !== fb) {
      if (!fa) return 1
      if (!fb) return -1
      return fa < fb ? -1 : 1
    }
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1
    return a.id < b.id ? -1 : 1
  })
}

/** The soonest visit for each lead that starts at or after `now`. */
export function nextVisitByLead(visits: LeadVisit[] | undefined, now: Date): Map<string, Date> {
  const out = new Map<string, Date>()
  for (const v of visits ?? []) {
    if (!v.lead_id || !v.start_at) continue
    const at = new Date(v.start_at)
    if (Number.isNaN(at.getTime()) || at.getTime() < now.getTime()) continue
    const have = out.get(v.lead_id)
    if (!have || at < have) out.set(v.lead_id, at)
  }
  return out
}

/** "Sat, Oct 10" for a visit, the day without a year. */
export function visitDay(at: Date): string {
  return `${WEEKDAYS[at.getDay()]}, ${MONTHS[at.getMonth()]} ${at.getDate()}`
}

/** "9:00 AM" for a visit, in the phone's zone. */
export function visitTime(at: Date): string {
  return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** "Follow up Oct 9", or "Follow up today", or null without a date. */
export function followUpLine(lead: Pick<LeadRow, 'follow_up_on'>, now: Date): string | null {
  const d = parseDateOnly(lead.follow_up_on)
  if (!d) return null
  const dayMs = 86400000
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const diff = Math.round((d.getTime() - today) / dayMs)
  if (diff === 0) return 'Follow up today'
  if (diff < 0) return `Follow up was ${MONTHS[d.getMonth()]} ${d.getDate()}`
  return `Follow up ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

/** The chip on a lead row: an estimate on the books, else its status. */
export function leadChip(lead: Pick<LeadRow, 'status'>, visit: Date | undefined): LeadChip | null {
  if (lead.status === 'lost') return { label: 'Lost', tone: 'neutral' }
  if (visit) return { label: 'Estimate booked', tone: 'info' }
  if (lead.status === 'quoted') return { label: 'Quoted', tone: 'success' }
  return null
}

/** Who the lead is: the client's name, else a plain placeholder. */
export function leadName(lead: Pick<LeadRow, 'fh_clients'>): string {
  return lead.fh_clients?.name?.trim() || 'Unnamed lead'
}

/** What they need: the lead's title, else its job type, else a plain line. */
export function leadNeed(lead: Pick<LeadRow, 'title' | 'job_type'>): string {
  return lead.title?.trim() || lead.job_type?.trim() || 'Nothing written down yet'
}

const QUOTE_CHIPS: Record<string, LeadChip> = {
  draft: { label: 'Draft', tone: 'neutral' },
  sent: { label: 'Sent', tone: 'info' },
  viewed: { label: 'Viewed', tone: 'info' },
  changes_requested: { label: 'Changes requested', tone: 'danger' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
  lost: { label: 'Lost', tone: 'neutral' }
}

/** The chip on a quote row, from its status. Unknown statuses get no chip. */
export function quoteChip(quote: Pick<QuoteRow, 'status'>): LeadChip | null {
  return QUOTE_CHIPS[quote.status] ?? null
}

/** Quotes the Jobs screen's Quotes tab shows: everything not lost. */
export function listedQuotes(quotes: QuoteRow[]): QuoteRow[] {
  return quotes.filter((q) => q.status !== 'lost')
}

/** Where Schedule estimate goes (D60). Task 13 builds the screen. */
export function scheduleEstimateRoute(leadId: string): string {
  return `/schedule/new?lead=${encodeURIComponent(leadId)}`
}

// ---- Rows for the Jobs screen's Leads and Quotes tabs ----

function matches(search: string, parts: (string | null | undefined)[]): boolean {
  const q = search.trim().toLowerCase()
  if (!q) return true
  return parts.some((p) => !!p && p.toLowerCase().includes(q))
}

/**
 * The Leads tab: open and quoted leads, soonest follow up first, narrowed
 * by the search (who, what, phone, address).
 */
export function buildLeadRows(
  leads: LeadRow[],
  { search = '', visits, now }: { search?: string; visits?: LeadVisit[]; now: Date }
): JobsRowView[] {
  const nextVisit = nextVisitByLead(visits, now)
  return sortLeads(listedLeads(leads))
    .filter((l) => matches(search, [l.fh_clients?.name, l.title, l.job_type, l.fh_clients?.phone, l.fh_clients?.address]))
    .map((l) => ({
      id: l.id,
      title: leadName(l),
      subline: leadNeed(l),
      money: null,
      next: followUpLine(l, now),
      chip: leadChip(l, nextVisit.get(l.id)),
      to: recordRoute('lead', l.id)
    }))
}

/**
 * The Quotes tab: every quote not lost, the latest touched first, with its
 * amount when the role may see money and a chip for its status.
 */
export function buildQuoteRows(
  quotes: QuoteRow[],
  { search = '', showMoney }: { search?: string; showMoney: boolean }
): JobsRowView[] {
  return listedQuotes(quotes)
    .filter((q) => matches(search, [q.fh_clients?.name, q.title, q.job_type, q.fh_clients?.phone, q.fh_clients?.address]))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : a.id < b.id ? -1 : 1))
    .map((q) => ({
      id: q.id,
      title: q.fh_clients?.name?.trim() || 'Unnamed quote',
      subline: q.title?.trim() || q.job_type?.trim() || 'Untitled quote',
      money: showMoney && q.amount > 0 ? moneyCents(q.amount) : null,
      next: null,
      chip: quoteChip(q),
      to: recordRoute('quote', q.id)
    }))
}
