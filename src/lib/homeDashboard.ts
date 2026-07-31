import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase.ts'
import { ACTIVE_STAGES } from './stages.ts'
import { fetchCoverPhotosByJob } from './photos.ts'
import { fetchAllRows } from './queries.ts'
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
  'quote_change_request_note' | 'quote_change_requested_at'
>>

type ScheduleRow = Pick<
  Database['public']['Tables']['fh_schedule']['Row'],
  'id' | 'contact_id' | 'start_at' | 'end_at' | 'title'
>

type ScheduleWithContact = ScheduleRow & {
  fh_contacts: Pick<ContactRow, 'name' | 'stage'> | null
}

type PaymentRow = Pick<
  Database['public']['Tables']['fh_payments']['Row'],
  'contact_id' | 'amount' | 'created_at' | 'paid_on'
>

type ApprovedCoRow = Pick<
  Database['public']['Tables']['fh_change_orders']['Row'],
  'contact_id' | 'amount' | 'status'
>

type PublicLinkRow = Pick<
  Database['public']['Tables']['fh_public_links']['Row'],
  'contact_id' | 'last_viewed_at'
>

type ChangeOrderRow = Pick<
  Database['public']['Tables']['fh_change_orders']['Row'],
  'id' | 'contact_id' | 'sequence_number' | 'title' | 'amount' | 'updated_at'
>

type InvoiceRow = Pick<
  Database['public']['Tables']['fh_invoices']['Row'],
  'id' | 'contact_id' | 'title' | 'amount' | 'due_at' | 'status'
>

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
  contactId: string
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

export type HomeStageRail = {
  key: 'lead' | 'quote' | 'job' | 'closed' | 'lost'
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
  nextActions: HomeNextAction[]
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
  photoUrlByJob: Record<string, string>
  proposalViews: PublicLinkRow[]
  sentChangeOrders: ChangeOrderRow[]
  openInvoices: InvoiceRow[]
  approvedChangeOrders: ApprovedCoRow[]
}

export const homeDashboardKey = (userId: string | undefined, orgId?: string | null) =>
  ['homeDashboard', userId, orgId ?? null] as const

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

  const totalPipeline = contacts
    .filter((contact) => ACTIVE_STAGES.includes(contact.stage || ''))
    .reduce((sum, contact) => sum + Number(contact.amount || 0), 0)

  const prevPipeline = contacts
    .filter((contact) => {
      if (!ACTIVE_STAGES.includes(contact.stage || '')) return false
      return new Date(contact.created_at || now).getTime() < sevenDaysAgo.getTime()
    })
    .reduce((sum, contact) => sum + Number(contact.amount || 0), 0)

  const risky = contacts.filter((contact) => {
    if (contact.stage !== 'lead' && contact.stage !== 'quote') return false
    const last = new Date(contact.updated_at || contact.created_at || 0)
    return last < sevenDaysAgo
  })
  const riskValue = risky.reduce((sum, contact) => sum + Number(contact.amount || 0), 0)

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

  for (const contact of risky) {
    const lastTouchMs = new Date(contact.updated_at || contact.created_at || 0).getTime()
    const daysWaiting = daysBetween(now, lastTouchMs)
    const dayWord = daysWaiting === 1 ? 'day' : 'days'
    actions.push({
      id: `followup-${contact.id}`,
      kind: 'followup',
      contactId: contact.id,
      verb: 'Follow up',
      contactName: contact.name || 'Unnamed lead',
      contactAmount: Number(contact.amount || 0),
      dueIso: new Date(lastTouchMs).toISOString(),
      dueKind: 'waited',
      title: `Follow up with ${contact.name || 'lead'}`,
      detail: `${contact.stage === 'lead' ? 'Lead' : 'Quote'} waiting ${daysWaiting} ${dayWord}`,
      urgencyLabel: 'Follow up',
      urgencyTone: daysWaiting >= 14 ? 'danger' : 'warn',
      urgency: lastTouchMs,
      tab: contact.stage === 'quote' ? 'quote' : 'overview',
      intent: contact.stage === 'quote' ? 'quote_followup' : 'follow_up',
    })
  }

  for (const contact of behind) {
    actions.push({
      id: `reschedule-${contact.id}`,
      kind: 'reschedule',
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

  const todayYmdStr = localYmd(now)
  for (const contact of contacts) {
    if (!contact.follow_up_on || contact.follow_up_on > todayYmdStr) continue
    if (!['lead', 'quote'].includes(contact.stage || '')) continue
    const due = new Date(`${contact.follow_up_on}T12:00:00`)
    const overdueDays = Math.max(0, Math.round((now.getTime() - due.getTime()) / 86400000))
    actions.push({
      id: `followup-due-${contact.id}`,
      kind: 'followup-due',
      contactId: contact.id,
      verb: 'Call',
      contactName: contact.name || 'Unnamed lead',
      contactAmount: Number(contact.amount || 0),
      dueIso: due.toISOString(),
      dueKind: 'overdue',
      title: `Call ${contact.name || 'lead'}`,
      detail: overdueDays === 0 ? 'Follow up due today' : `Follow up ${overdueDays}d overdue`,
      urgencyLabel: overdueDays === 0 ? 'Due today' : 'Overdue',
      urgencyTone: overdueDays >= 2 ? 'danger' : 'warn',
      urgency: 1 + Math.max(0, 5 - overdueDays),
      tab: contact.stage === 'quote' ? 'quote' : 'overview',
      intent: contact.stage === 'quote' ? 'quote_followup' : 'follow_up',
    })
  }

  const latestViewByContact = new Map<string, number>()
  for (const view of source.proposalViews) {
    if (!view.contact_id || !view.last_viewed_at) continue
    const viewedAt = new Date(view.last_viewed_at).getTime()
    if (Number.isNaN(viewedAt)) continue
    const prev = latestViewByContact.get(view.contact_id) || 0
    if (viewedAt > prev) latestViewByContact.set(view.contact_id, viewedAt)
  }
  for (const contact of contacts) {
    if (contact.stage !== 'quote' || contact.proposal_status !== 'changes_requested') continue
    const requestedAt = contact.quote_change_requested_at || contact.updated_at || contact.created_at
    actions.push({
      id: `quote-changes-${contact.id}`,
      kind: 'quote-changes',
      contactId: contact.id,
      verb: 'Review',
      contactName: contact.name || 'Customer',
      contactAmount: Number(contact.amount || 0),
      dueIso: requestedAt || now.toISOString(),
      dueKind: 'overdue',
      title: 'Customer requested quote changes',
      detail: contact.quote_change_request_note || 'Open the quote and review the requested revision.',
      urgencyLabel: 'Needs revision',
      urgencyTone: 'danger',
      urgency: 0.5,
      tab: 'quote',
      intent: 'review_quote_changes',
    })
  }
  for (const contact of contacts) {
    if (contact.stage !== 'quote') continue
    if (!['sent', 'viewed'].includes((contact.proposal_status || '').toLowerCase())) continue
    const viewedAt = latestViewByContact.get(contact.id)
    if (!viewedAt) continue
    const hoursSince = (now.getTime() - viewedAt) / 3600000
    if (hoursSince < 48) continue
    if (actions.some((action) => action.contactId === contact.id)) continue
    actions.push({
      id: `viewed-quiet-${contact.id}`,
      kind: 'viewed-quiet',
      contactId: contact.id,
      verb: 'Follow up',
      contactName: contact.name || 'Unnamed lead',
      contactAmount: Number(contact.amount || 0),
      dueIso: new Date(viewedAt).toISOString(),
      dueKind: 'waited',
      title: 'They read your quote - follow up',
      detail: `${contact.name || 'Customer'} viewed it ${Math.round(hoursSince / 24)}d ago, no answer`,
      urgencyLabel: 'Engaged',
      urgencyTone: 'warn',
      urgency: 10 + hoursSince / 24,
      tab: 'quote',
      intent: 'quote_followup',
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

  for (const invoice of source.openInvoices) {
    if (!invoice.due_at) continue
    const due = new Date(invoice.due_at)
    if (Number.isNaN(due.getTime()) || due > now) continue
    const daysLate = Math.round((now.getTime() - due.getTime()) / 86400000)
    const contact = contactsById.get(invoice.contact_id)
    actions.push({
      id: `inv-overdue-${invoice.id}`,
      kind: 'inv-overdue',
      contactId: invoice.contact_id,
      verb: 'Nudge',
      contactName: contactName(contact),
      contactAmount: Number(invoice.amount || 0),
      dueIso: due.toISOString(),
      dueKind: 'overdue',
      title: `Invoice ${daysLate}d past due`,
      detail: `${invoice.title || 'Invoice'} - $${Number(invoice.amount || 0).toLocaleString()} - ${contactName(contact, 'customer')}`,
      urgencyLabel: 'Past due',
      urgencyTone: 'danger',
      urgency: Math.max(1, 100 - daysLate),
      tab: 'financials',
      intent: 'nudge_invoice',
    })
  }

  actions.sort((a, b) => a.urgency - b.urgency)

  const stageBreakdown = {
    won: contacts.filter((contact) => contact.stage === 'closed').length,
    active: contacts.filter((contact) => contact.stage === 'job' || contact.stage === 'invoice').length,
    lead: contacts.filter((contact) => contact.stage === 'lead' || contact.stage === 'quote').length,
  }

  const stageRail = (['lead', 'quote', 'job', 'closed', 'lost'] as const).map((stage) => {
    const rows = contacts.filter((contact) => contact.stage === stage)
    return {
      key: stage,
      count: rows.length,
      total: rows.reduce((sum, contact) => sum + Number(contact.amount || 0), 0),
    }
  })

  const quotesAttention = contacts.filter((contact) => {
    if (contact.stage !== 'quote') return false
    if (contact.proposal_status === 'changes_requested') return true
    return new Date(contact.updated_at || contact.created_at || 0) < sevenDaysAgo
  }).length

  const followUps = contacts.filter((contact) => {
    if (contact.stage !== 'lead') return false
    return new Date(contact.updated_at || contact.created_at || 0) < sevenDaysAgo
  }).length

  const todayOnSite = source.todaySchedules.map((schedule) => ({
    id: schedule.id,
    contactId: schedule.contact_id,
    title: schedule.title || schedule.fh_contacts?.name || 'Scheduled visit',
    clientName: schedule.fh_contacts?.name || null,
    stage: schedule.fh_contacts?.stage || null,
    startAt: schedule.start_at,
    endAt: schedule.end_at,
  }))

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
      count: risky.length,
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
    nextActions: actions.slice(0, 6),
    photoUrlByJob: source.photoUrlByJob,
  }
}

function assertOk(label: string, result: { error: { message?: string } | null }) {
  if (result.error) {
    throw new Error(`Home dashboard ${label} failed: ${result.error.message || 'Unknown Supabase error'}`)
  }
}

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
  const paymentsPromise = fetchAllRows<PaymentRow>((from, to) =>
    (orgId
      ? supabase.from('fh_payments').select('contact_id, amount, created_at, paid_on').eq('org_id', orgId)
      : supabase.from('fh_payments').select('contact_id, amount, created_at, paid_on').eq('user_id', userId)
    )
      .order('id', { ascending: true })
      .range(from, to)
  )

  const approvedCoQuery = (orgId
    ? supabase.from('fh_change_orders').select('contact_id, amount, status').eq('org_id', orgId)
    : supabase.from('fh_change_orders').select('contact_id, amount, status').eq('user_id', userId)
  )
    .eq('status', 'approved')

  const todayScheduleQuery = (orgId
    ? supabase.from('fh_schedule').select('id, contact_id, start_at, end_at, title, fh_contacts(name, stage)').eq('org_id', orgId)
    : supabase.from('fh_schedule').select('id, contact_id, start_at, end_at, title, fh_contacts(name, stage)').eq('user_id', userId)
  )
    .gte('start_at', todayStart.toISOString())
    .lt('start_at', todayEnd.toISOString())
    .order('start_at', { ascending: true })
    .limit(6)

  const proposalViewsQuery = (orgId
    ? supabase.from('fh_public_links').select('contact_id, last_viewed_at').eq('org_id', orgId)
    : supabase.from('fh_public_links').select('contact_id, last_viewed_at').eq('user_id', userId)
  )
    .eq('kind', 'proposal')
    .not('last_viewed_at', 'is', null)

  const sentChangeOrdersQuery = (orgId
    ? supabase.from('fh_change_orders').select('id, contact_id, sequence_number, title, amount, updated_at').eq('org_id', orgId)
    : supabase.from('fh_change_orders').select('id, contact_id, sequence_number, title, amount, updated_at').eq('user_id', userId)
  )
    .eq('status', 'sent')

  const openInvoicesQuery = (orgId
    ? supabase.from('fh_invoices').select('id, contact_id, title, amount, due_at, status').eq('org_id', orgId)
    : supabase.from('fh_invoices').select('id, contact_id, title, amount, due_at, status').eq('user_id', userId)
  )
    .in('status', ['sent', 'overdue'])

  const [
    contactsRes,
    overdueSchedRes,
    payments,
    todaySchedRes,
    photoUrlByJob,
    proposalViewsRes,
    sentChangeOrdersRes,
    openInvoicesRes,
    approvedCoRes,
  ] = await Promise.all([
    // Scope contacts the same way as every sibling query (org, else user).
    // Left unscoped this pulled the whole RLS-visible table to the phone AND
    // mixed in partner-shared rows the other signals exclude, inflating the
    // pipeline total and not scaling.
    (orgId
      ? supabase.from('fh_contacts').select('id, name, amount, stage, updated_at, created_at, completed_at, follow_up_on, proposal_status, quote_change_request_note, quote_change_requested_at').eq('org_id', orgId)
      : supabase.from('fh_contacts').select('id, name, amount, stage, updated_at, created_at, completed_at, follow_up_on, proposal_status, quote_change_request_note, quote_change_requested_at').eq('user_id', userId)
    ),
    overdueScheduleQuery,
    paymentsPromise,
    todayScheduleQuery,
    fetchCoverPhotosByJob(userId).catch(() => ({} as Record<string, string>)),
    proposalViewsQuery,
    sentChangeOrdersQuery,
    openInvoicesQuery,
    approvedCoQuery,
  ])

  assertOk('contacts', contactsRes)
  assertOk('overdue schedule', overdueSchedRes)
  assertOk('today schedule', todaySchedRes)
  assertOk('proposal views', proposalViewsRes)
  assertOk('sent change orders', sentChangeOrdersRes)
  assertOk('open invoices', openInvoicesRes)
  assertOk('approved change orders', approvedCoRes)

  return buildHomeDashboardBundle({
    now,
    contacts: (contactsRes.data ?? []) as ContactRow[],
    overdueSchedules: (overdueSchedRes.data ?? []) as Pick<ScheduleRow, 'contact_id'>[],
    payments,
    todaySchedules: (todaySchedRes.data ?? []) as unknown as ScheduleWithContact[],
    photoUrlByJob: photoUrlByJob || {},
    proposalViews: (proposalViewsRes.data ?? []) as PublicLinkRow[],
    sentChangeOrders: (sentChangeOrdersRes.data ?? []) as ChangeOrderRow[],
    openInvoices: (openInvoicesRes.data ?? []) as InvoiceRow[],
    approvedChangeOrders: (approvedCoRes.data ?? []) as ApprovedCoRow[],
  })
}

export function useHomeDashboard(userId: string | undefined, orgId?: string | null) {
  return useQuery({
    queryKey: homeDashboardKey(userId, orgId),
    queryFn: () => fetchHomeDashboard(userId as string, new Date(), orgId),
    enabled: !!userId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
}

export function useHomeDashboardRealtime(userId: string | undefined, orgId?: string | null) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!userId) return

    // Coalesce bursts. The dashboard listens to 7 tables; a single busy
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

    const scopeFilter = orgId ? `org_id=eq.${orgId}` : `user_id=eq.${userId}`
    const channel = supabase
      .channel(`home-dashboard:${orgId || userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fh_contacts', filter: scopeFilter }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fh_schedule', filter: scopeFilter }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fh_payments', filter: scopeFilter }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fh_public_links', filter: scopeFilter }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fh_change_orders', filter: scopeFilter }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fh_invoices', filter: scopeFilter }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fh_job_files', filter: scopeFilter }, invalidate)
      .subscribe()

    return () => {
      if (debounce) clearTimeout(debounce)
      supabase.removeChannel(channel)
    }
  }, [orgId, queryClient, userId])
}
