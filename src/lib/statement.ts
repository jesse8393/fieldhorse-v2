import { createUuid } from './uuid.ts'
// src/lib/statement.ts
//
// Client statement, one rollup of what a client owes across ALL of
// their properties/jobs. Built for repeat clients (e.g. a property
// manager with several buildings) who want a single "here's everything
// I owe you" document instead of one invoice per job.
//
// "Owed" = (contract amount + approved change orders) − payments, per
// property, over billing stages job/invoice/closed. This is the SAME
// definition used on the Invoices screen and in rollups.ts (Clients
// list + ClientDetail "outstanding"), so the statement always agrees
// with what the app shows elsewhere (and never comes back empty for a
// contractor who tracks balances by contract/paid rather than discrete
// invoice rows).
//
// gatherStatement is a PURE function over jobs + payments the caller
// already has, no DB round-trip, trivially unit-testable.
//
// Given the client's invoices (audit 2026-11-16, S05, M-13, PT-06), Total
// due is what is owed on ISSUED invoices, by the allocator Money, the
// invoice PDF and the email use (amountsDueByInvoice), invoices billed to
// the client directly included. Contract money nobody has invoiced yet is
// listed apart, as `notInvoiced`, and is not part of Total due: a
// statement asks the customer to pay bills, not the unbilled contract.
// The in app statement, the customer link and the total posted to
// send-statement all read these figures. A caller that has not loaded the
// invoices gets the older contract less paid rollup.

// pdf.js pulls in jspdf (~390KB), load it lazily so importing this
// module (ClientDetail route graph) doesn't ship the PDF engine on the
// critical path. downloadPdf is fetched alongside generateStatement.
const loadPdf = () => import('./pdf.js')

import { amountsDueByInvoice, isOpenInvoice, knownContractTotal, type DueInvoice } from './invoiceSettlement.ts'

export type StatementJob = {
  id: string
  name?: string | null
  job_title?: string | null
  address?: string | null
  amount?: number | string | null
  stage?: string | null
}

export type StatementPayment = {
  contact_id?: string | null
  invoice_id?: string | null
  amount?: number | string | null
}

export type StatementInvoice = DueInvoice & {
  title?: string | null
  /** What it still owes, when the server worked it out with rows the caller does not have (unsent drafts). */
  amount_due?: number | null
}

export type StatementLine = {
  contactId: string
  property: string
  contract: number
  paid: number
  balance: number
}

export type StatementChangeOrder = {
  contact_id?: string | null
  amount?: number | string | null
  status?: string | null
}

export type StatementData = {
  /** What the customer owes on issued invoices, one line per property (or per invoice billed to the client directly). */
  lines: StatementLine[]
  /** The sum of `lines`, to the cent. */
  totalDue: number
  /** Contract balances not yet invoiced, per property. Not part of totalDue. */
  notInvoiced: StatementLine[]
  notInvoicedTotal: number
}

const toCents = (n: unknown) => {
  const v = Math.round(Number(n || 0) * 100)
  return Number.isFinite(v) ? v : 0
}

// Stages that can carry a billable balance. Leads/quotes aren't owed
// yet; lost is dead. Matches the Invoices screen's job set.
const BILLING_STAGES = new Set(['job', 'invoice', 'closed'])

/** Sum of APPROVED change orders per contact, the amount that adjusts
 *  a job's true contract up (or down, for credits). */
export function approvedCoByContact(
  changeOrders: StatementChangeOrder[] | null | undefined
): Map<string, number> {
  const m = new Map<string, number>()
  for (const co of changeOrders || []) {
    if (co?.status !== 'approved' || !co.contact_id) continue
    m.set(co.contact_id, (m.get(co.contact_id) || 0) + Number(co.amount || 0))
  }
  return m
}

/**
 * Roll the client's jobs into statement lines, one row per property
 * with a positive balance. Contract = job amount + approved change
 * orders (the same "true contract" the Send-invoice sheet and PDF use),
 * so a signed change order actually raises what's owed here. Pure.
 */
export function gatherStatement(
  jobs: StatementJob[] | null | undefined,
  payments: StatementPayment[] | null | undefined,
  changeOrders: StatementChangeOrder[] | null | undefined = [],
  { invoices }: { invoices?: StatementInvoice[] | null } = {}
): StatementData {
  if (invoices) return gatherFromInvoices(jobs || [], payments || [], changeOrders || [], invoices)
  if (!jobs?.length) return { lines: [], totalDue: 0, notInvoiced: [], notInvoicedTotal: 0 }

  const paidByJob = new Map<string, number>()
  for (const p of payments || []) {
    if (!p.contact_id) continue
    paidByJob.set(p.contact_id, (paidByJob.get(p.contact_id) || 0) + Number(p.amount || 0))
  }
  const coByJob = approvedCoByContact(changeOrders)

  const lines: StatementLine[] = []
  for (const j of jobs) {
    if (j.stage && !BILLING_STAGES.has(j.stage)) continue
    const contract = Number(j.amount || 0) + (coByJob.get(j.id) || 0)
    const paid = paidByJob.get(j.id) || 0
    const balance = contract - paid
    if (balance <= 0.5) continue
    lines.push({
      contactId: j.id,
      property: j.job_title || j.name || j.address || 'Project',
      contract,
      paid,
      balance
    })
  }
  lines.sort((a, b) => b.balance - a.balance)
  const totalDue = lines.reduce((s, l) => s + l.balance, 0)
  return { lines, totalDue, notInvoiced: [], notInvoicedTotal: 0 }
}

function gatherFromInvoices(
  jobs: StatementJob[],
  payments: StatementPayment[],
  changeOrders: StatementChangeOrder[],
  invoices: StatementInvoice[]
): StatementData {
  const billing = jobs.filter((j) => !j.stage || BILLING_STAGES.has(j.stage))
  const jobIds = new Set(billing.map((j) => j.id))
  // A job's own invoices, and the ones billed to the client directly.
  const own = invoices.filter((inv) => (inv.contact_id ? jobIds.has(inv.contact_id) : true))
  const coByJob = new Map<string, StatementChangeOrder[]>()
  for (const co of changeOrders) {
    if (!co?.contact_id) continue
    const list = coByJob.get(co.contact_id)
    if (list) list.push(co)
    else coByJob.set(co.contact_id, [co])
  }
  const contractOf = (j: StatementJob) => knownContractTotal({ amount: j.amount, changeOrders: coByJob.get(j.id) ?? [] })
  const byId = new Map(billing.map((j) => [j.id, j]))
  const open = own.filter((inv) => isOpenInvoice(inv))
  const due = open.length > 0 && open.every((inv) => typeof inv.amount_due === 'number' && Number.isFinite(inv.amount_due))
    ? new Map(open.map((inv) => [inv.id, inv.amount_due as number]))
    : amountsDueByInvoice({
        invoices: own,
        payments: payments as any,
        contractFor: (id) => { const j = byId.get(id); return j ? contractOf(j) : null }
      })

  const paidByJob = new Map<string, number>()
  const paidByInvoice = new Map<string, number>()
  for (const p of payments) {
    if (p.contact_id) paidByJob.set(p.contact_id, (paidByJob.get(p.contact_id) || 0) + toCents(p.amount))
    else if (p.invoice_id) paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) || 0) + toCents(p.amount))
  }

  const lines: StatementLine[] = []
  const notInvoiced: StatementLine[] = []
  for (const j of billing) {
    const contract = toCents(contractOf(j) ?? 0)
    const paid = paidByJob.get(j.id) || 0
    const owed = own
      .filter((inv) => inv.contact_id === j.id && isOpenInvoice(inv))
      .reduce((s, inv) => s + toCents(due.get(inv.id)), 0)
    const property = j.job_title || j.name || j.address || 'Project'
    if (owed > 0) lines.push({ contactId: j.id, property, contract: contract / 100, paid: paid / 100, balance: owed / 100 })
    const unbilled = contract - paid - owed
    if (unbilled > 0) notInvoiced.push({ contactId: j.id, property, contract: contract / 100, paid: paid / 100, balance: unbilled / 100 })
  }
  for (const inv of own) {
    if (inv.contact_id || !isOpenInvoice(inv)) continue
    const owed = toCents(due.get(inv.id))
    if (owed <= 0) continue
    lines.push({
      contactId: inv.id,
      property: String(inv.title || '').trim() || `Invoice #${inv.sequence_number ?? ''}`.trim(),
      contract: toCents(inv.amount) / 100,
      paid: (paidByInvoice.get(inv.id) || 0) / 100,
      balance: owed / 100
    })
  }
  lines.sort((a, b) => b.balance - a.balance)
  notInvoiced.sort((a, b) => b.balance - a.balance)
  const sum = (list: StatementLine[]) => list.reduce((s, l) => s + toCents(l.balance), 0) / 100
  return { lines, totalDue: sum(lines), notInvoiced, notInvoicedTotal: sum(notInvoiced) }
}

/**
 * The invoices and payments a statement needs, for the in app screen: every
 * live invoice on the client's jobs and every invoice billed to the client
 * directly, and the payments on those jobs and invoices with the invoice
 * each one paid. Row level security keeps it to the signed in company.
 */
export async function fetchStatementMoney(clientId: string, jobIds: string[]): Promise<{ invoices: StatementInvoice[]; payments: StatementPayment[] }> {
  const { supabase } = await import('./supabase.ts')
  const invoiceColumns = 'id, contact_id, client_id, title, amount, status, due_at, sequence_number, created_at'
  const [byClient, byJob] = await Promise.all([
    supabase.from('fh_invoices').select(invoiceColumns).eq('client_id', clientId).neq('status', 'void'),
    jobIds.length > 0
      ? supabase.from('fh_invoices').select(invoiceColumns).in('contact_id', jobIds).neq('status', 'void')
      : Promise.resolve({ data: [], error: null })
  ])
  if (byClient.error) throw byClient.error
  if (byJob.error) throw byJob.error
  const invoices = uniqueById([...(byClient.data ?? []), ...(byJob.data ?? [])] as StatementInvoice[])
    .filter((inv) => !inv.contact_id || jobIds.includes(inv.contact_id))
  const directIds = invoices.filter((inv) => !inv.contact_id).map((inv) => inv.id)
  const paymentColumns = 'id, contact_id, invoice_id, amount'
  const [onJobs, onDirect] = await Promise.all([
    jobIds.length > 0
      ? supabase.from('fh_payments').select(paymentColumns).in('contact_id', jobIds)
      : Promise.resolve({ data: [], error: null }),
    directIds.length > 0
      ? supabase.from('fh_payments').select(paymentColumns).in('invoice_id', directIds)
      : Promise.resolve({ data: [], error: null })
  ])
  if (onJobs.error) throw onJobs.error
  if (onDirect.error) throw onDirect.error
  const payments = uniqueById([...(onJobs.data ?? []), ...(onDirect.data ?? [])] as Array<StatementPayment & { id: string }>)
  return { invoices, payments }
}

/**
 * The one read of a customer's statement money, shared by the customer
 * page's Statement button and the statement screen, so both total the same
 * invoices and payments through gatherStatement (formats-5).
 */
export function statementMoneyQuery(clientId: string | undefined, jobIds: string[]) {
  return {
    queryKey: ['clientStatementMoney', clientId, jobIds] as const,
    queryFn: () => fetchStatementMoney(clientId as string, jobIds)
  }
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Map<string, T>()
  for (const r of rows) if (r?.id && !seen.has(r.id)) seen.set(r.id, r)
  return [...seen.values()]
}

/** Build the statement PDF result (doc + filename + totalDue). */
export async function buildStatementPdf({ company, client, data }: {
  company: any
  client: any
  data: StatementData
}) {
  // generateStatement lives in the untyped pdf.js, its array params
  // infer as never[], so the typed payload goes through `as any`.
  const { generateStatement } = await loadPdf()
  return generateStatement({
    company,
    client,
    lines: data.lines,
    statementId: client?.id
  } as any)
}

/** Build + trigger a local download. */
export async function downloadStatement(args: { company: any; client: any; data: StatementData }) {
  const result = await buildStatementPdf(args)
  const { downloadPdf } = await loadPdf()
  downloadPdf(result)
  return result
}

export type SendStatementResult =
  | { ok: true; recipient: string }
  | { ok: false; reason: 'no_email' | 'sender_not_configured' | 'error'; message?: string }

/**
 * Email the statement: render → upload to storage → POST send-statement.
 * Falls back to a local download when the email sender isn't configured.
 */
export async function sendStatementEmail({ company, client, data, userId, recipientEmail }: {
  company: any
  client: any
  data: StatementData
  userId: string
  recipientEmail?: string | null
}): Promise<SendStatementResult> {
  const recipient = (recipientEmail || client?.email || '').trim()
  if (!recipient) return { ok: false, reason: 'no_email' }

  const result = await buildStatementPdf({ company, client, data })
  if (!result?.doc) return { ok: false, reason: 'error', message: 'PDF generator returned no document' }

  const { supabase, authHeaders } = await import('./supabase.ts')
  const blob = result.doc.output('blob')
  const rowId = createUuid()
  const path = `${userId}/statements/${rowId}.pdf`
  const { error: upErr } = await supabase.storage
    .from('job-files')
    .upload(path, blob, { upsert: false, contentType: 'application/pdf' })
  if (upErr) return { ok: false, reason: 'error', message: `Couldn't save the statement PDF: ${upErr.message}` }

  const sendRes = await fetch('/api/send-statement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({
      client_id: client.id,
      sender_user_id: userId,
      recipient_email: recipient,
      recipient_name: client.company_name || client.name || null,
      storage_path: path,
      filename: result.filename,
      // The statement's own figure, to the cent, the one the screen shows.
      total_due: data.totalDue
    })
  })
  const body = await sendRes.json().catch(() => ({}))

  if (sendRes.status === 503 && body?.error === 'sender_not_configured') {
    const { downloadPdf } = await loadPdf()
    downloadPdf(result)
    return { ok: false, reason: 'sender_not_configured' }
  }
  if (!sendRes.ok || !body?.ok) {
    return { ok: false, reason: 'error', message: body?.message || body?.error || 'Send failed' }
  }
  return { ok: true, recipient }
}
