import { useCallback, useEffect } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase.ts'
import { ACTIVE_STAGES, MOVED_STAGE_FILTER } from './stages.ts'
import { fetchCoverPhotos, freshCoverUrls } from './photos.ts'
import { chunkIds, fetchAllRows } from './queries.ts'
import { useOrgScope } from './orgScope.ts'
import { OPEN_INVOICE_STATUSES, amountsDueByInvoice, knownContractTotal } from './invoiceSettlement.ts'
import { classifyInvoice } from './moneyView.ts'
import type { RecordKind } from './records.ts'
import type { Database } from './database.types.ts'

// Local-calendar year month day (NOT UTC) so evening follow-ups don't read
// as due a day early. Mirrors src/lib/dates.ts todayYmd.
function localYmd(d: Date) {
  const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const day = String(d.getDate()).padStart(2,'0')
  return `${y}-${m}-${day}`
}

type ContactRow = Pick<
  Database['public']['Tables']['fh_contacts']['Row'],
  'id' | 'name' | 'amount' | 'stage' | 'updated_at' | 'created_at' | 'completed_at' | 'follow_up_on' | 'proposal_status'
> & Partial<Pick<
  Database['public']['Tables']['fh_contacts']['Row'],
  'quote_change_request_note' | 'quote_change_requested_at' | 'address' | 'job_title'
>>

type ClientName = { name: string | null; phone?: string | null } | null

// Phase 9 (D53, D55): leads and quotes are their own records, each
// pointing at a client, whose name is what Today calls them.
type LeadSourceRow = Pick<
  Database['public']['Tables']['fh_leads']['Row'],
  'id' | 'client_id' | 'title' | 'status' | 'follow_up_on' | 'last_contact' | 'created_at' | 'updated_at'
> & { fh_clients: ClientName }

type QuoteSourceRow = Pick<
  Database['public']['Tables']['fh_quotes']['Row'],
  'id' | 'client_id' | 'title' | 'status' | 'amount' | 'job_id' | 'sent_at' | 'change_request_note' | 'change_requested_at' | 'created_at' | 'updated_at'
> & { fh_clients: ClientName }

// A quote still in play: not decided against, and not yet made a job.
const OPEN_QUOTE_STATUSES = ['draft', 'sent', 'viewed', 'changes_requested', 'approved']
// A quote waiting on the customer.
const QUOTE_OUT_STATUSES = ['sent', 'viewed']

type ScheduleRow = Pick<
  Database['public']['Tables']['fh_schedule']['Row'],
  'id' | 'contact_id' | 'start_at' | 'end_at' | 'title'
>

type ScheduleContact = Pick<ContactRow, 'name' | 'stage' | 'address' | 'job_title'>

type ScheduleWithContact = ScheduleRow & {
  fh_contacts: ScheduleContact | null
}

type PaymentRow = Pick<
  Database['public']['Tables']['fh_payments']['Row'],
  'contact_id' | 'amount' | 'created_at' | 'paid_on'
> & Partial<Pick<Database['public']['Tables']['fh_payments']['Row'], 'invoice_id'>>

type ApprovedCoRow = Pick<
  Database['public']['Tables']['fh_change_orders']['Row'],
  'contact_id' | 'amount' | 'status'
>

type ChangeOrderRow = Pick<
  Database['public']['Tables']['fh_change_orders']['Row'],
  'id' | 'contact_id' | 'sequence_number' | 'title' | 'amount' | 'updated_at'
>

type InvoiceRow = Pick<
  Database['public']['Tables']['fh_invoices']['Row'],
  'id' | 'contact_id' | 'title' | 'amount' | 'due_at' | 'status'
> & Partial<Pick<Database['public']['Tables']['fh_invoices']['Row'], 'sequence_number' | 'created_at'>>

export type DashboardTone = 'good' | 'warn' | 'bad' | 'neutral'
export type HomePriorityTone = 'success' | 'warn' | 'danger'
export type HomeActionIntent =
  | 'follow_up'
  | 'quote_followup'
  | 'review_quote_changes'
  | 'reschedule'
  | 'send_invoice'
  | 'nudge_invoice'
  | 'change_order_followup'

export type HomeNextAction = {
  id: string
  kind:
    | 'followup'
    | 'reschedule'
    | 'invoice'
    | 'followup-due'
    | 'viewed-quiet'
    | 'quote-changes'
    | 'co-unsigned'
    | 'inv-overdue'
  /** Which record the row opens (D53): a lead, a quote or a job. */
  recordKind: Extract<RecordKind, 'lead' | 'quote' | 'job'>
  /** That record's id. */
  recordId: string
  /** The job's id, or '' when the row is about a lead or a quote. */
  contactId: string
  /** Present on lead follow ups so missing details can be repaired. */
  clientId?: string | null
  contactPhone?: string | null
  verb: string
  contactName: string
  contactAmount: number
  dueIso: string
  dueKind: 'waited' | 'overdue' | 'invoiced'
  title: string
  detail: string
  urgencyLabel: string
  urgencyTone: HomePriorityTone
  urgency: number
  tab?: 'overview' | 'quote' | 'financials' | 'change_orders'
  intent: HomeActionIntent
}

export type HomeTodayOnSite = {
  id: string
  contactId: string | null
  title: string
  clientName: string | null
  stage: string | null
  startAt: string | null
  endAt: string | null
  address: string | null
  jobTitle: string | null
}

export type HomeTopPipeline = {
  id: string
  name: string
  amount: number
  stage: string | null
  updatedAt: string | null
}

export type HomeJobHealth = {
  id: string
  job: string
  stage: string
  schedule: string
  scheduleTone: DashboardTone
  billing: string
  billingTone: DashboardTone
  risk: string
  riskTone: DashboardTone
  next: string
}

export type HomeStageBreakdown = {
  won: number
  active: number
  lead: number
}

// Four counts (Task 15): open leads, open quotes, jobs under way and the
// invoices still owed, with the money each stands for (leads carry none).
export type HomeStageRail = {
  key: 'lead' | 'quote' | 'job' | 'invoice'
  count: number
  total: number
}

export type HomeDealsAtRisk = {
  count: number
  value: number
  followUps: number
  quotesAttention: number
}

export type HomeDashboardBundle = {
  pipeline: number
  pipelinePrev: number
  dealsAtRisk: HomeDealsAtRisk
  jobsBehind: number
  invoicingWeek: number
  topPipeline: HomeTopPipeline[]
  jobHealth: HomeJobHealth[]
  stageBreakdown: HomeStageBreakdown
  stageRail: HomeStageRail[]
  todayOnSite: HomeTodayOnSite[]
  /** The next local day's visits, the same shape as todayOnSite. */
  tomorrowOnSite: HomeTodayOnSite[]
  /** Every next action, ordered by urgency, for See all. */
  nextActions: HomeNextAction[]
  /**
   * How many next actions there are in all, which can be more than
   * nextActions holds. Missing on a bundle cached by an older build, which
   * counts nextActions instead.
   */
  nextActionsTotal?: number
  photoUrlByJob: Record<string, string>
}

export type HomeDashboardSource = {
  now: Date
  contacts: ContactRow[]
  overdueSchedules: Pick<ScheduleRow, 'contact_id'>[]
  // ALL payments for the scope, not just this week's, paid state,
  // "chase invoice", and job-health outstanding need full history.
  payments: PaymentRow[]
  todaySchedules: ScheduleWithContact[]
  tomorrowSchedules: ScheduleWithContact[]
  photoUrlByJob: Record<string, string>
  /** Every lead of the scope; only open ones ask for anything. */
  leads: LeadSourceRow[]
  /** Every quote of the scope. */
  quotes: QuoteSourceRow[]
  sentChangeOrders: ChangeOrderRow[]
  openInvoices: InvoiceRow[]
  /**
   * The drafts, paid and void invoices of the jobs with an open bill, so
   * money that already paid one bill, or covers an unsent deposit draft, is
   * not counted against an open one.
   */
  settledInvoices?: InvoiceRow[]
  approvedChangeOrders: ApprovedCoRow[]
}

export const homeDashboardKey = (userId: string | undefined, orgId?: string | null) =>
  ['homeDashboard', userId, orgId ?? null] as const

// Cover photos live in their own query keyed by the jobs on screen, so a
// bundle refetch (realtime fires one after most writes) does not re-read
// and re-sign every photo.
export const homeCoversKey = (userId: string | undefined, jobIds: readonly string[]) =>
  ['homeCovers', userId, [...jobIds]] as const

/** The jobs whose rows show a thumbnail on Home, sorted for a stable key. */
export function coverPhotoJobIds(
  bundle: Pick<HomeDashboardBundle, 'nextActions' | 'todayOnSite' | 'topPipeline'>
): string[] {
  const ids = new Set<string>()
  for (const action of bundle.nextActions) if (action.contactId) ids.add(action.contactId)
  for (const row of bundle.todayOnSite) if (row.contactId) ids.add(row.contactId)
  for (const deal of bundle.topPipeline) if (deal.id) ids.add(deal.id)
  return Array.from(ids).sort()
}

function startOfWeek(now: Date) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
}

function daysBetween(now: Date, thenMs: number) {
  return Math.max(1, Math.floor((now.getTime() - thenMs) / 86400000))
}

function contactName(contact: ContactRow | undefined, fallback = 'Job') {
  return contact?.name || fallback
}

function clientName(row: { fh_clients: ClientName; title: string | null }, fallback: string) {
  return row.fh_clients?.name?.trim() || row.title?.trim() || fallback
}

function latestMs(...isos: (string | null | undefined)[]): number {
  let latest = 0
  for (const iso of isos) {
    const ms = iso ? Date.parse(iso) : Number.NaN
    if (!Number.isNaN(ms) && ms > latest) latest = ms
  }
  return latest
}

export function buildHomeDashboardBundle(source: HomeDashboardSource): HomeDashboardBundle {
  const now = source.now
  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(now.getDate() - 7)
  const fiveDaysAgo = new Date(now)
  fiveDaysAgo.setDate(now.getDate() - 5)

  const contactsById = new Map<string, ContactRow>()
  for (const contact of source.contacts) {
    if (contact?.id && !contactsById.has(contact.id)) contactsById.set(contact.id, contact)
  }
  const contacts = Array.from(contactsById.values())

  const openLeads = (source.leads ?? []).filter((lead) => lead.status === 'open')
  // Open quotes, less the ones already made into a job: the job carries
  // that money now.
  const openQuotes = (source.quotes ?? []).filter((quote) => OPEN_QUOTE_STATUSES.includes(quote.status) && !quote.job_id)

  // The pipeline: the jobs under way and the quotes still open.
  const activeJobs = contacts.filter((contact) => ACTIVE_STAGES.includes(contact.stage || ''))
  const totalPipeline = activeJobs.reduce((sum, contact) => sum + Number(contact.amount || 0), 0)
    + openQuotes.reduce((sum, quote) => sum + Number(quote.amount || 0), 0)

  const olderThanWeek = (iso: string | null | undefined) => new Date(iso || now).getTime() < sevenDaysAgo.getTime()
  const prevPipeline = activeJobs
    .filter((contact) => olderThanWeek(contact.created_at))
    .reduce((sum, contact) => sum + Number(contact.amount || 0), 0)
    + openQuotes
      .filter((quote) => olderThanWeek(quote.created_at))
      .reduce((sum, quote) => sum + Number(quote.amount || 0), 0)

  // Quotes out with the customer and quiet for a week: nothing sent or
  // changed since. A quote with changes requested has its own row below.
  const quietQuotes = openQuotes.filter((quote) => {
    if (!QUOTE_OUT_STATUSES.includes(quote.status)) return false
    const last = latestMs(quote.sent_at, quote.updated_at, quote.created_at)
    return last < sevenDaysAgo.getTime()
  })
  const changedQuotes = openQuotes.filter((quote) => quote.status === 'changes_requested')
  const riskValue = [...quietQuotes, ...changedQuotes].reduce((sum, quote) => sum + Number(quote.amount || 0), 0)

  const overdueContactIds = new Set(source.overdueSchedules.map((row) => row.contact_id).filter(Boolean) as string[])
  const behind = contacts.filter((contact) => contact.stage === 'job' && overdueContactIds.has(contact.id))

  // All time paid per contact. The dashboard used to fetch ONLY this
  // week's payments and treat them as all payments, so a job paid in
  // full last month read "Chase invoice · $25,000 owed" and Job Health
  // showed "Outstanding" until a payment happened to land inside the
  // current calendar week.
  const payByContact = new Map<string, number>()
  for (const payment of source.payments) {
    if (!payment.contact_id) continue
    payByContact.set(payment.contact_id, (payByContact.get(payment.contact_id) || 0) + Number(payment.amount || 0))
  }
  const coByContact = new Map<string, number>()
  for (const co of source.approvedChangeOrders) {
    if (co?.status !== 'approved' || !co.contact_id) continue
    coByContact.set(co.contact_id, (coByContact.get(co.contact_id) || 0) + Number(co.amount || 0))
  }
  const balanceFor = (contact: ContactRow) => {
    const contract = Number(contact.amount || 0) + (coByContact.get(contact.id) || 0)
    return contract - (payByContact.get(contact.id) || 0)
  }

  // Collected this week, keyed on paid_on (the date the money actually
  // arrived), falling back to created_at for legacy rows without one.
  const weekStartMs = startOfWeek(now).getTime()
  const weekTotal = source.payments.reduce((sum, payment) => {
    const paidOn = payment.paid_on
      ? new Date(`${String(payment.paid_on).slice(0, 10)}T12:00:00`).getTime()
      : new Date(payment.created_at || 0).getTime()
    return Number.isFinite(paidOn) && paidOn >= weekStartMs ? sum + Number(payment.amount || 0) : sum
  }, 0)

  const actions: HomeNextAction[] = []

  for (const quote of quietQuotes) {
    const lastTouchMs = latestMs(quote.sent_at, quote.updated_at, quote.created_at)
    const daysWaiting = daysBetween(now, lastTouchMs)
    const dayWord = daysWaiting === 1 ? 'day' : 'days'
    const name = clientName(quote, 'Customer')
    actions.push({
      id: `followup-${quote.id}`,
      kind: 'followup',
      recordKind: 'quote',
      recordId: quote.id,
      contactId: '',
      verb: 'Follow up',
      contactName: name,
      contactAmount: Number(quote.amount || 0),
      dueIso: new Date(lastTouchMs).toISOString(),
      dueKind: 'waited',
      title: `Follow up with ${name}`,
      detail: `Quote waiting ${daysWaiting} ${dayWord}`,
      urgencyLabel: 'Follow up',
      urgencyTone: daysWaiting >= 14 ? 'danger' : 'warn',
      urgency: lastTouchMs,
      tab: 'quote',
      intent: 'quote_followup',
    })
  }

  for (const contact of behind) {
    actions.push({
      id: `reschedule-${contact.id}`,
      kind: 'reschedule',
      recordKind: 'job',
      recordId: contact.id,
      contactId: contact.id,
      verb: 'Reschedule',
      contactName: contact.name || 'Unnamed job',
      contactAmount: Number(contact.amount || 0),
      dueIso: now.toISOString(),
      dueKind: 'overdue',
      title: `Reschedule ${contact.name || 'job'}`,
      detail: 'Job behind schedule',
      urgencyLabel: 'Overdue',
      urgencyTone: 'danger',
      urgency: 0,
      tab: 'overview',
      intent: 'reschedule',
    })
  }

  for (const contact of contacts) {
    const awaitingPayment = contact.stage === 'invoice' || (contact.stage === 'job' && contact.completed_at)
    if (!awaitingPayment) continue
    // Only chase money that's actually owed, a fully (or over-) paid
    // job is done, no matter when its payments landed.
    const owed = balanceFor(contact)
    if (owed <= 0.5) continue
    const updated = new Date(contact.updated_at || contact.created_at || 0)
    if (updated > fiveDaysAgo) continue
    actions.push({
      id: `invoice-${contact.id}`,
      kind: 'invoice',
      recordKind: 'job',
      recordId: contact.id,
      contactId: contact.id,
      verb: 'Chase invoice',
      contactName: contact.name || 'Unnamed job',
      contactAmount: owed,
      dueIso: updated.toISOString(),
      dueKind: 'invoiced',
      title: `Chase invoice for ${contact.name || 'job'}`,
      // The remaining balance, not the full contract, a $25K job with
      // $20K collected is owed $5K, and that's the number to chase.
      detail: `$${Math.round(owed).toLocaleString()} owed`,
      urgencyLabel: 'Invoice pending',
      urgencyTone: 'success',
      urgency: updated.getTime(),
      tab: 'financials',
      intent: 'send_invoice',
    })
  }

  // A lead is due by the day its follow up was set for (D60). The most
  // overdue is the most urgent; a due today row sits behind one a week late.
  const todayYmdStr = localYmd(now)
  const dueLeads = openLeads.filter((lead) => !!lead.follow_up_on && lead.follow_up_on <= todayYmdStr)
  for (const lead of dueLeads) {
    const due = new Date(`${lead.follow_up_on}T12:00:00`)
    const overdueDays = Math.max(0, Math.round((now.getTime() - due.getTime()) / 86400000))
    const name = clientName(lead, 'Unnamed lead')
    const phone = lead.fh_clients?.phone?.trim() || null
    const verb = phone ? 'Call' : lead.client_id ? 'Add phone' : 'Follow up'
    actions.push({
      id: `followup-due-${lead.id}`,
      kind: 'followup-due',
      recordKind: 'lead',
      recordId: lead.id,
      contactId: '',
      clientId: lead.client_id,
      contactPhone: phone,
      verb,
      contactName: name,
      contactAmount: 0,
      dueIso: due.toISOString(),
      dueKind: 'overdue',
      title: phone ? `Call ${name}` : lead.client_id ? `Add phone for ${name}` : `Follow up with ${name}`,
      detail: overdueDays === 0 ? 'Follow up due today' : `Follow up ${overdueDays}d overdue`,
      urgencyLabel: overdueDays === 0 ? 'Due today' : 'Overdue',
      urgencyTone: overdueDays >= 2 ? 'danger' : 'warn',
      urgency: 1 + 5 / (1 + overdueDays),
      intent: 'follow_up',
    })
  }

  for (const quote of changedQuotes) {
    const requestedAt = quote.change_requested_at || quote.updated_at || quote.created_at
    actions.push({
      id: `quote-changes-${quote.id}`,
      kind: 'quote-changes',
      recordKind: 'quote',
      recordId: quote.id,
      contactId: '',
      verb: 'Review',
      contactName: clientName(quote, 'Customer'),
      contactAmount: Number(quote.amount || 0),
      dueIso: requestedAt || now.toISOString(),
      dueKind: 'overdue',
      title: 'Customer requested quote changes',
      detail: quote.change_request_note || 'Open the quote and review the requested revision.',
      urgencyLabel: 'Needs revision',
      urgencyTone: 'danger',
      urgency: 0.5,
      tab: 'quote',
      intent: 'review_quote_changes',
    })
  }

  for (const changeOrder of source.sentChangeOrders) {
    const sentAt = new Date(changeOrder.updated_at || 0).getTime()
    const days = (now.getTime() - sentAt) / 86400000
    if (!(days >= 3)) continue
    const contact = contactsById.get(changeOrder.contact_id)
    actions.push({
      id: `co-unsigned-${changeOrder.id}`,
      kind: 'co-unsigned',
      recordKind: 'job',
      recordId: changeOrder.contact_id,
      contactId: changeOrder.contact_id,
      verb: 'Re-send',
      contactName: contactName(contact),
      contactAmount: Math.abs(Number(changeOrder.amount || 0)),
      dueIso: new Date(sentAt).toISOString(),
      dueKind: 'waited',
      title: `CO #${changeOrder.sequence_number} unsigned`,
      detail: `Sent ${Math.round(days)}d ago - nudge ${contactName(contact, 'the customer')}`,
      urgencyLabel: 'Unsigned',
      urgencyTone: 'warn',
      urgency: 100 + days,
      tab: 'change_orders',
      intent: 'change_order_followup',
    })
  }

  // Money's rule (moneyView classifyInvoice): overdue once the due day has
  // ended in local time, for what the allocator says is still owed.
  const approvedCosByContact = new Map<string, ApprovedCoRow[]>()
  for (const co of source.approvedChangeOrders) {
    if (!co?.contact_id) continue
    const list = approvedCosByContact.get(co.contact_id)
    if (list) list.push(co)
    else approvedCosByContact.set(co.contact_id, [co])
  }
  const owedByInvoice = amountsDueByInvoice({
    invoices: [...source.openInvoices, ...(source.settledInvoices ?? [])],
    payments: source.payments,
    // As Money's contractOf: null when the job is unknown or has no recorded
    // amount (and no approved change order), so there is nothing to cap at.
    contractFor: (id) => {
      const contact = contactsById.get(id)
      return contact ? knownContractTotal({ amount: contact.amount, changeOrders: approvedCosByContact.get(id) ?? [] }) : null
    },
  })
  for (const invoice of source.openInvoices) {
    const standing = classifyInvoice(invoice, owedByInvoice.get(invoice.id), now)
    if (standing.status !== 'overdue' || !standing.dueDay || standing.owed <= 0.005) continue
    const daysLate = standing.daysLate
    // Noon on the due day, as follow_up_on above, so the day and the days
    // late read the same on Today as on Money.
    const due = new Date(standing.dueDay.getFullYear(), standing.dueDay.getMonth(), standing.dueDay.getDate(), 12)
    const contact = invoice.contact_id ? contactsById.get(invoice.contact_id) : undefined
    actions.push({
      id: `inv-overdue-${invoice.id}`,
      kind: 'inv-overdue',
      recordKind: 'job',
      recordId: invoice.contact_id ?? '',
      contactId: invoice.contact_id ?? '',
      verb: 'Nudge',
      contactName: contactName(contact),
      contactAmount: standing.owed,
      dueIso: due.toISOString(),
      dueKind: 'overdue',
      title: `Invoice ${daysLate}d past due`,
      detail: `${invoice.title || 'Invoice'}, ${standing.owed.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} owed, ${contactName(contact, 'customer')}`,
      urgencyLabel: 'Past due',
      urgencyTone: 'danger',
      urgency: Math.max(1, 100 - daysLate),
      tab: 'financials',
      intent: 'nudge_invoice',
    })
  }

  actions.sort((a, b) => a.urgency - b.urgency)

  const jobsUnderWay = contacts.filter((contact) => contact.stage === 'job' || contact.stage === 'invoice')
  const stageBreakdown = {
    won: contacts.filter((contact) => contact.stage === 'closed').length,
    active: jobsUnderWay.length,
    lead: openLeads.length + openQuotes.length,
  }

  // Invoices still owed, by Money's allocator, as the overdue rows above.
  const invoicesDue = source.openInvoices
    .map((invoice) => owedByInvoice.get(invoice.id) ?? Number(invoice.amount || 0))
    .filter((owed) => owed > 0.005)
  const stageRail: HomeStageRail[] = [
    { key: 'lead', count: openLeads.length, total: 0 },
    { key: 'quote', count: openQuotes.length, total: openQuotes.reduce((sum, quote) => sum + Number(quote.amount || 0), 0) },
    { key: 'job', count: jobsUnderWay.length, total: jobsUnderWay.reduce((sum, contact) => sum + Number(contact.amount || 0), 0) },
    { key: 'invoice', count: invoicesDue.length, total: invoicesDue.reduce((sum, owed) => sum + owed, 0) },
  ]

  const quotesAttention = quietQuotes.length + changedQuotes.length
  const followUps = dueLeads.length

  // The job comes embedded with each visit. A visit read without the
  // embed falls back to the job's own contact row.
  const onSite = (schedule: ScheduleWithContact): HomeTodayOnSite => {
    const job: Partial<ScheduleContact> | undefined = schedule.fh_contacts
      ?? (schedule.contact_id ? contactsById.get(schedule.contact_id) : undefined)
    return {
      id: schedule.id,
      contactId: schedule.contact_id,
      title: schedule.title || job?.name || 'Scheduled visit',
      clientName: job?.name || null,
      stage: job?.stage || null,
      startAt: schedule.start_at,
      endAt: schedule.end_at,
      address: job?.address || null,
      jobTitle: job?.job_title || null,
    }
  }
  const todayOnSite = source.todaySchedules.map(onSite)
  const tomorrowOnSite = (source.tomorrowSchedules ?? []).map(onSite)

  const topPipeline = contacts
    .filter((contact) => ACTIVE_STAGES.includes(contact.stage || ''))
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
    .slice(0, 3)
    .map((contact) => ({
      id: contact.id,
      name: contact.name || 'Untitled',
      amount: Number(contact.amount || 0),
      stage: contact.stage,
      updatedAt: contact.updated_at || contact.created_at || null,
    }))

  const jobHealth = contacts
    .filter((contact) => contact.stage === 'job' || contact.stage === 'invoice')
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
    .slice(0, 6)
    .map((contact) => {
      const isBehind = overdueContactIds.has(contact.id)
      const scheduleTone: DashboardTone = isBehind ? 'bad' : 'good'
      const amount = Number(contact.amount || 0) + (coByContact.get(contact.id) || 0)
      const outstanding = amount > 0 ? balanceFor(contact) : 0
      const workDone = !!contact.completed_at || contact.stage === 'invoice'
      // Same "real balance" threshold as rollups/statements, sub-50¢
      // dust never drives a warning.
      const owes = outstanding > 0.5
      const billingTone: DashboardTone =
        workDone && owes ? 'warn'
        : amount === 0 ? 'warn'
        : 'good'
      const tones = [scheduleTone, billingTone]
      const riskTone: DashboardTone = tones.includes('bad') ? 'bad' : tones.includes('warn') ? 'warn' : 'good'
      return {
        id: contact.id,
        job: contact.name || 'Untitled',
        stage: workDone && owes ? 'Invoicing' : 'Active',
        schedule: isBehind ? 'Behind' : 'On track',
        scheduleTone,
        billing:
          workDone && owes ? 'Outstanding'
          : amount === 0 ? 'Not set'
          : owes ? 'In progress'
          : 'Paid',
        billingTone,
        risk: riskTone === 'bad' ? 'High' : riskTone === 'warn' ? 'Medium' : 'Low',
        riskTone,
        next:
          isBehind ? 'Reschedule + update client'
          : workDone && owes ? 'Send the final invoice'
          : workDone ? 'Close out the job'
          : 'Keep crew moving',
      }
    })

  return {
    pipeline: totalPipeline,
    pipelinePrev: prevPipeline,
    dealsAtRisk: {
      count: followUps + quotesAttention,
      value: riskValue,
      followUps,
      quotesAttention,
    },
    jobsBehind: behind.length,
    invoicingWeek: weekTotal,
    topPipeline,
    jobHealth,
    stageBreakdown,
    stageRail,
    todayOnSite,
    tomorrowOnSite,
    nextActions: actions,
    nextActionsTotal: actions.length,
    photoUrlByJob: source.photoUrlByJob,
  }
}

function assertOk(label: string, result: { error: { message?: string } | null }) {
  if (result.error) {
    throw new Error(`Home dashboard ${label} failed: ${result.error.message || 'Unknown Supabase error'}`)
  }
}

// fetchAllRows (pages past PostgREST's 1000 row max-rows) with the same
// error wording as assertOk.
async function fetchAllLabelled<T>(label: string, build: Parameters<typeof fetchAllRows>[0]): Promise<T[]> {
  try {
    return await fetchAllRows<T>(build)
  } catch (err) {
    const message = (err as { message?: string } | null)?.message
    throw new Error(`Home dashboard ${label} failed: ${message || 'Unknown Supabase error'}`)
  }
}

const CONTACT_COLUMNS =
  'id, name, amount, stage, updated_at, created_at, completed_at, follow_up_on, proposal_status, quote_change_request_note, quote_change_requested_at, address, job_title'

const INVOICE_COLUMNS = 'id, contact_id, title, amount, due_at, status, sequence_number, created_at'

const LEAD_COLUMNS = 'id, client_id, title, status, follow_up_on, last_contact, created_at, updated_at, fh_clients!fh_leads_client_id_fkey(name, phone)'

const QUOTE_COLUMNS =
  'id, client_id, title, status, amount, job_id, sent_at, change_request_note, change_requested_at, created_at, updated_at, fh_clients!fh_quotes_client_id_fkey(name)'

// Visits with the job they belong to, for Today's next stop and day list.
const SCHEDULE_COLUMNS = 'id, contact_id, start_at, end_at, title, fh_contacts(name, stage, address, job_title)'

// The most visits Today reads for one day. Its headline, next stop and
// "Today, done" count every visit it gets, so this sits well above a full
// day for any crew.
export const VISITS_PER_DAY = 50

// Cover photos are not part of this fetch (photoUrlByJob comes back
// empty): useHomeDashboard loads them in their own query once the bundle
// names the jobs that render a thumbnail.
export async function fetchHomeDashboard(
  userId: string,
  now = new Date(),
  orgId?: string | null,
): Promise<HomeDashboardBundle> {
  const fourteenDaysAgo = new Date(now)
  fourteenDaysAgo.setDate(now.getDate() - 14)
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(todayStart)
  todayEnd.setDate(todayEnd.getDate() + 1)
  const tomorrowEnd = new Date(todayEnd)
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1)

  const overdueScheduleQuery = (orgId
    ? supabase.from('fh_schedule').select('contact_id, end_at, start_at').eq('org_id', orgId)
    : supabase.from('fh_schedule').select('contact_id, end_at, start_at').eq('user_id', userId)
  )
    .lt('end_at', now.toISOString())
    .gte('end_at', fourteenDaysAgo.toISOString())

  // ALL payments for the scope, paged past PostgREST's 1000-row cap.
  // A week-scoped fetch here made every downstream consumer treat
  // "payments since Sunday" as "all payments ever", wrong paid state
  // on every job paid before this week.
  const paymentsPromise = fetchAllLabelled<PaymentRow>('payments', (from, to) =>
    (orgId
      ? supabase.from('fh_payments').select('contact_id, invoice_id, amount, created_at, paid_on').eq('org_id', orgId)
      : supabase.from('fh_payments').select('contact_id, invoice_id, amount, created_at, paid_on').eq('user_id', userId)
    )
      .order('id', { ascending: true })
      .range(from, to)
  )

  // Every set that feeds money math or the action queue is paged the
  // same way. Capped at 1000 unordered rows, the pipeline, stage rail,
  // deals at risk and balanceFor() were computed from an arbitrary
  // subset of a large book.
  const contactsPromise = fetchAllLabelled<ContactRow>('contacts', (from, to) =>
    // Scope contacts the same way as every sibling query (org, else user).
    // Left unscoped this pulled the whole RLS-visible table to the phone AND
    // mixed in partner-shared rows the other signals exclude, inflating the
    // pipeline total and not scaling.
    (orgId
      ? supabase.from('fh_contacts').select(CONTACT_COLUMNS).eq('org_id', orgId)
      : supabase.from('fh_contacts').select(CONTACT_COLUMNS).eq('user_id', userId)
    )
      .not('stage', 'in', MOVED_STAGE_FILTER)
      .order('id', { ascending: true })
      .range(from, to)
  )

  const approvedCoPromise = fetchAllLabelled<ApprovedCoRow>('approved change orders', (from, to) =>
    (orgId
      ? supabase.from('fh_change_orders').select('contact_id, amount, status').eq('org_id', orgId)
      : supabase.from('fh_change_orders').select('contact_id, amount, status').eq('user_id', userId)
    )
      .eq('status', 'approved')
      .order('id', { ascending: true })
      .range(from, to)
  )

  // One local day of visits, earliest first: today, and the next day
  // for Today's evening view.
  const scheduleForDay = (from: Date, to: Date) => (orgId
    ? supabase.from('fh_schedule').select(SCHEDULE_COLUMNS).eq('org_id', orgId)
    : supabase.from('fh_schedule').select(SCHEDULE_COLUMNS).eq('user_id', userId)
  )
    .gte('start_at', from.toISOString())
    .lt('start_at', to.toISOString())
    .order('start_at', { ascending: true })
    .limit(VISITS_PER_DAY)
  const todayScheduleQuery = scheduleForDay(todayStart, todayEnd)
  const tomorrowScheduleQuery = scheduleForDay(todayEnd, tomorrowEnd)

  // Leads and quotes, each with its client's name (D53, D55).
  const leadsPromise = fetchAllLabelled<LeadSourceRow>('leads', (from, to) =>
    (orgId
      ? supabase.from('fh_leads').select(LEAD_COLUMNS).eq('org_id', orgId)
      : supabase.from('fh_leads').select(LEAD_COLUMNS).eq('user_id', userId)
    )
      .order('id', { ascending: true })
      .range(from, to)
  )
  const quotesPromise = fetchAllLabelled<QuoteSourceRow>('quotes', (from, to) =>
    (orgId
      ? supabase.from('fh_quotes').select(QUOTE_COLUMNS).eq('org_id', orgId)
      : supabase.from('fh_quotes').select(QUOTE_COLUMNS).eq('user_id', userId)
    )
      .order('id', { ascending: true })
      .range(from, to)
  )

  const sentChangeOrdersPromise = fetchAllLabelled<ChangeOrderRow>('sent change orders', (from, to) =>
    (orgId
      ? supabase.from('fh_change_orders').select('id, contact_id, sequence_number, title, amount, updated_at').eq('org_id', orgId)
      : supabase.from('fh_change_orders').select('id, contact_id, sequence_number, title, amount, updated_at').eq('user_id', userId)
    )
      .eq('status', 'sent')
      .order('id', { ascending: true })
      .range(from, to)
  )

  // Open invoices, and for the jobs that have one, the drafts, paid and void
  // invoices the allocator reads, so an overdue row asks for what Money asks
  // for. The second read names those jobs (in chunks, as the id lookups in
  // queries.ts do) instead of paging the whole company's invoice history.
  const invoicesFor = (statuses: readonly string[], jobIds?: string[]) => (from: number, to: number) => {
    let query = (orgId
      ? supabase.from('fh_invoices').select(INVOICE_COLUMNS).eq('org_id', orgId)
      : supabase.from('fh_invoices').select(INVOICE_COLUMNS).eq('user_id', userId)
    ).in('status', [...statuses])
    if (jobIds) query = query.in('contact_id', jobIds)
    return query.order('id', { ascending: true }).range(from, to)
  }
  const openInvoicesPromise = fetchAllLabelled<InvoiceRow>('open invoices', invoicesFor(OPEN_INVOICE_STATUSES))
  const settledInvoicesPromise = openInvoicesPromise.then(async (open) => {
    const jobIds = [...new Set(open.map((inv) => inv.contact_id).filter((id): id is string => !!id))]
    const parts = await Promise.all(chunkIds(jobIds).map((chunk) =>
      fetchAllLabelled<InvoiceRow>('settled invoices', invoicesFor(['draft', 'paid', 'void'], chunk))
    ))
    return parts.flat()
  })

  const [
    contacts,
    overdueSchedRes,
    payments,
    todaySchedRes,
    leads,
    sentChangeOrders,
    openInvoices,
    approvedChangeOrders,
    tomorrowSchedRes,
    settledInvoices,
    quotes,
  ] = await Promise.all([
    contactsPromise,
    overdueScheduleQuery,
    paymentsPromise,
    todayScheduleQuery,
    leadsPromise,
    sentChangeOrdersPromise,
    openInvoicesPromise,
    approvedCoPromise,
    tomorrowScheduleQuery,
    settledInvoicesPromise,
    quotesPromise,
  ])

  assertOk('overdue schedule', overdueSchedRes)
  assertOk('today schedule', todaySchedRes)
  assertOk('tomorrow schedule', tomorrowSchedRes)

  return buildHomeDashboardBundle({
    now,
    contacts,
    overdueSchedules: (overdueSchedRes.data ?? []) as Pick<ScheduleRow, 'contact_id'>[],
    payments,
    todaySchedules: (todaySchedRes.data ?? []) as unknown as ScheduleWithContact[],
    tomorrowSchedules: (tomorrowSchedRes.data ?? []) as unknown as ScheduleWithContact[],
    photoUrlByJob: {},
    leads,
    quotes,
    sentChangeOrders,
    openInvoices,
    settledInvoices,
    approvedChangeOrders,
  })
}

// The second argument is accepted for compatibility and ignored: the
// tenant scope comes from MembershipContext via useOrgScope. Home passes
// membership.orgId, which reads null while membership loads, and that
// used to fire a user scoped bundle first and an org scoped one after.
export function useHomeDashboard(userId: string | undefined, _orgId?: string | null) {
  const orgId = useOrgScope(userId)
  const bundleQuery = {
    queryKey: homeDashboardKey(userId, orgId),
    queryFn: () => fetchHomeDashboard(userId as string, new Date(), orgId),
    enabled: !!userId && orgId !== undefined,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  }
  // Same cached bundle, selecting only the jobs that show a thumbnail.
  const coverIds = useQuery({ ...bundleQuery, select: coverPhotoJobIds }).data
  const covers = useQuery({
    queryKey: homeCoversKey(userId, coverIds ?? []),
    queryFn: () => fetchCoverPhotos(coverIds ?? []),
    enabled: !!userId && !!coverIds && coverIds.length > 0,
    // Signed URLs live an hour; refresh well before they lapse.
    staleTime: 30 * 60_000,
    // Keep the current thumbnails while a changed job list loads.
    placeholderData: keepPreviousData,
  }).data
  // Only links that are still fresh by when they were signed: a copy the
  // offline cache brings back hours later shows no photo until the read
  // above signs new ones, instead of a link that has run out.
  const withCovers = useCallback(
    (bundle: HomeDashboardBundle): HomeDashboardBundle => {
      const urls = freshCoverUrls(covers)
      return urls ? { ...bundle, photoUrlByJob: urls } : bundle
    },
    [covers]
  )
  return useQuery({ ...bundleQuery, select: withCovers })
}

// The second argument is accepted for compatibility and ignored, as in
// useHomeDashboard.
export function useHomeDashboardRealtime(userId: string | undefined, _orgId?: string | null) {
  const queryClient = useQueryClient()
  const orgId = useOrgScope(userId)

  useEffect(() => {
    // Wait for the tenant scope so the channel is not opened user scoped,
    // then torn down and reopened org scoped once membership resolves.
    if (!userId || orgId === undefined) return

    // Coalesce bursts. The dashboard listens to 8 tables; a single busy
    // moment (log a payment → contact, payment, invoice, schedule all fire)
    // would otherwise trigger several full 8-query refetches back-to-back.
    // A trailing debounce collapses the burst into one refetch.
    let debounce: ReturnType<typeof setTimeout> | null = null
    const invalidate = () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: homeDashboardKey(userId, orgId) })
      }, 1500)
    }
    // Photo uploads only change the covers, not the bundle.
    let coverDebounce: ReturnType<typeof setTimeout> | null = null
    const invalidateCovers = () => {
      if (coverDebounce) clearTimeout(coverDebounce)
      coverDebounce = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['homeCovers', userId] })
      }, 1500)
    }

    const scopeFilter = orgId ? `org_id=eq.${orgId}` : `user_id=eq.${userId}`
    const channel = supabase
      .channel(`home-dashboard:${orgId || userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fh_contacts', filter: scopeFilter }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fh_schedule', filter: scopeFilter }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fh_payments', filter: scopeFilter }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fh_leads', filter: scopeFilter }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fh_quotes', filter: scopeFilter }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fh_change_orders', filter: scopeFilter }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fh_invoices', filter: scopeFilter }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fh_job_files', filter: scopeFilter }, invalidateCovers)
      .subscribe()

    return () => {
      if (debounce) clearTimeout(debounce)
      if (coverDebounce) clearTimeout(coverDebounce)
      supabase.removeChannel(channel)
    }
  }, [orgId, queryClient, userId])
}
