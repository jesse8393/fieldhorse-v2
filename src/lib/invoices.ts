import { createUuid } from './uuid.ts'
// First-class invoices (pipeline v2, D62). One fh_invoices row per invoice:
// a job's deposit, progress draws and final balance, or a bill that stands
// on its own against a client with no job. This module is the single home
// for create / PDF / send / settle so the invoice screen, the job's money
// tab and Money all drive the same plumbing.

import { supabase, authHeaders } from './supabase.ts'
import { allocateInvoiceDue, knownContractTotal, type DueInvoice } from './invoiceSettlement.ts'
import type { Database } from './database.types.ts'

// pdf.js pulls in jspdf (~390KB). Load it lazily at call time so merely
// importing this module (Invoices, ClientDetail, PublicDoc route graphs)
// doesn't drag the PDF engine into the critical path.
const loadPdf = () => import('./pdf.js')

export type InvoiceRow = Database['public']['Tables']['fh_invoices']['Row']
type Contact = Database['public']['Tables']['fh_contacts']['Row']

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'void'

// Company block for the PDF letterhead, built from the profile row.
// Kept here so every surface formats it identically.
export function companyFromProfile(profile: any) {
  return {
    name: profile?.company_name || profile?.full_name || 'My Company',
    address: profile?.company_address || '',
    phone: profile?.company_phone || '',
    email: profile?.company_email || profile?.email || '',
    website: profile?.company_website || '',
    logo_url: profile?.logo_url || null,
    brand_accent_hex: profile?.brand_accent_hex || null,
    license_number: profile?.license_number || '',
    insured_text: profile?.insured_text || '',
    payment_link: profile?.payment_link || '',
    payment_instructions: profile?.payment_instructions || ''
  }
}

// Contract total = contact.amount + approved change orders. Mirrors
// InvoiceTemplate / InvoiceDrawsSection math so screen and PDF agree.
export function contractTotals({ contact, payments = [], changeOrders = [], invoices = [] }: {
  contact: Partial<Contact> | null | undefined
  payments?: { amount?: number | string | null }[]
  changeOrders?: { amount?: number | string | null; status?: string | null }[]
  invoices?: { amount?: number | string | null; status?: string | null }[]
}) {
  const approvedCO = (changeOrders || [])
    .filter((co) => co?.status === 'approved')
    .reduce((s, co) => s + Number(co.amount || 0), 0)
  const contractTotal = Number(contact?.amount || 0) + approvedCO
  const paid = (payments || []).reduce((s, p) => s + Number(p.amount || 0), 0)
  const invoiced = (invoices || [])
    .filter((inv) => inv?.status !== 'void')
    .reduce((s, inv) => s + Number(inv.amount || 0), 0)
  return {
    contractTotal,
    paid,
    invoiced,
    rawBalance: contractTotal - paid,
    balance: Math.max(0, contractTotal - paid),
    credit: Math.max(0, paid - contractTotal),
    unbilled: Math.max(0, contractTotal - invoiced)
  }
}

// What the customer owes on one invoice right now, from the one allocator
// in invoiceSettlement.ts (allocateInvoiceDue): its amount, less the
// payments linked to it, less its share of money logged against the job
// (in settle order, drafts included) when `invoices` lists the job's
// invoices, and never more than the job still owes. Money's rows, the
// Remind sheet, the reminder email and the PDF it attaches (buildInvoicePdf
// hands it to the hero) and the Mark paid prefill all read this figure. The
// invoice counts as issued here even as a draft, since this is what sending
// it would ask for. Without `invoices`, money logged against the job is
// left alone (it may have paid a bill that is not passed in), so only the
// linked payments and the job balance cap apply. A job with no recorded
// contract amount (knownContractTotal null) has no balance to cap at.
export function invoiceAmountDue({ invoice, contact, payments = [], changeOrders = [], invoices = null }: {
  invoice: (Omit<DueInvoice, 'id'> & { id?: string | null }) | null | undefined
  /** The job the invoice bills, or null for an invoice that bills the client directly (D62). */
  contact: Partial<Contact> | null | undefined
  payments?: { amount?: number | string | null; invoice_id?: string | null }[]
  changeOrders?: { amount?: number | string | null; status?: string | null }[]
  /** Every invoice on the job (any status), so money logged against the job is spread over them. */
  invoices?: DueInvoice[] | null
}) {
  const amount = Number(invoice?.amount || 0)
  if (!Number.isFinite(amount) || amount <= 0) return 0
  const id = invoice?.id || 'this-invoice'
  const self: DueInvoice = { ...invoice, id, status: 'sent' }
  // An invoice with no job is a contract of its own amount: every payment
  // handed in is its own, so what it owes is its amount less those payments.
  if (!contact) {
    const due = allocateInvoiceDue({ invoices: [self], payments, contractTotal: amount, applyUnlinked: true })
    return Math.round((due.get(id) ?? 0) * 100) / 100
  }
  const contractTotal = knownContractTotal({ amount: contact?.amount, changeOrders })
  const others = (invoices || []).filter((inv) => inv?.id !== id)
  const due = allocateInvoiceDue({
    invoices: [...others, self],
    payments,
    contractTotal,
    applyUnlinked: invoices != null
  })
  return Math.round((due.get(id) ?? 0) * 100) / 100
}

export async function fetchInvoicesForContact(contactId: string) {
  const rows: InvoiceRow[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from('fh_invoices').select('*').eq('contact_id', contactId)
      .order('sequence_number', { ascending: true }).order('id').range(from, from + 499)
    if (error) return { data: [] as InvoiceRow[], error }
    rows.push(...(data ?? []) as InvoiceRow[])
    if ((data?.length ?? 0) < 500) return { data: rows, error: null }
  }
}

// An invoice bills a job (contact or contactId) or, with no job, the client
// directly through client_id (D62). Pass clientId with or without a job.
export async function createInvoice({ contact = null, contactId = null, clientId = null, userId, title, amount, status = 'draft', due_at = null, notes = null, description = null }: {
  /** The job it bills, when there is one (D54); null for an invoice against the client alone. */
  contact?: Pick<Contact, 'id'> | null
  /** The job's id, for callers that have no row. */
  contactId?: string | null
  /** The client the invoice bills (D62). An invoice always has one. */
  clientId?: string | null
  userId: string
  title: string
  amount: number
  status?: InvoiceStatus
  due_at?: string | null
  notes?: string | null
  description?: string | null
}) {
  const { data, error } = await supabase
    .from('fh_invoices')
    .insert({
      client_id: clientId || null,
      contact_id: contact?.id || contactId || null,
      user_id: userId,
      sequence_number: 0, // BEFORE INSERT trigger assigns the next number
      title: title?.trim() || 'Invoice',
      amount: Number(amount) || 0,
      status,
      due_at,
      notes: notes?.trim() || null,
      description: description?.trim() || null
    } as any)
    .select('*')
    .single()
  return { data: data as InvoiceRow | null, error }
}

/**
 * Who an invoice bills, for the PDF, the email and the screens: the job's
 * own details first (the job row carries the customer as it was at the
 * time), then the client it or the invoice points at.
 */
export type BillTo = {
  id: string | null
  name: string
  email: string
  phone: string
  address: string
  job_title: string | null
}

export function billTo(
  job: { id?: string | null; name?: string | null; email?: string | null; phone?: string | null; address?: string | null; job_title?: string | null; fh_clients?: { name?: string | null; email?: string | null; phone?: string | null; address?: string | null } | null } | null | undefined,
  client: { id?: string | null; name?: string | null; email?: string | null; phone?: string | null; address?: string | null } | null | undefined
): BillTo {
  const cli = job?.fh_clients || client || {}
  const pick = (a: unknown, b: unknown) => (typeof a === 'string' && a.trim()) || (typeof b === 'string' && b.trim()) || ''
  return {
    id: job?.id || client?.id || null,
    name: pick(job?.name, cli.name) || pick(client?.name, ''),
    email: pick(job?.email, cli.email) || pick(client?.email, ''),
    phone: pick(job?.phone, cli.phone) || pick(client?.phone, ''),
    address: pick(job?.address, cli.address) || pick(client?.address, ''),
    job_title: job?.job_title?.trim() || null
  }
}

/**
 * Records a payment against an invoice that bills the client directly (no
 * job, D62): an fh_payments row linked to the invoice with no contact, and
 * the invoice flips to paid once its payments cover it. A job's invoice is
 * paid through logPayment (lib/pipeline.ts), which settles the job too.
 */
export async function logInvoicePayment(invoice: Pick<InvoiceRow, 'id' | 'user_id' | 'amount' | 'status'>, input: {
  id?: string | null
  amount: number
  method?: string | null
  kind?: string | null
  reference?: string | null
  paid_on?: string | null
  /** Payments already linked to the invoice, so the paid flip counts them. */
  priorPayments?: { amount?: number | string | null }[]
}) {
  const amount = Number(input.amount) || 0
  const kind = ['deposit', 'progress', 'final', 'retainage', 'other'].includes(input.kind ?? '') ? (input.kind as string) : 'other'
  const payload: Record<string, unknown> = {
    ...(input.id ? { id: input.id } : {}),
    user_id: invoice.user_id,
    contact_id: null,
    invoice_id: invoice.id,
    amount,
    method: input.method || 'check',
    kind,
    reference: input.reference || null,
    paid_on: input.paid_on || new Date().toISOString().slice(0, 10)
  }
  const { error } = await supabase.from('fh_payments').upsert(payload as any, { onConflict: 'id', ignoreDuplicates: true })
  if (error) return { error, paid: false }
  const prior = (input.priorPayments || []).reduce((s, p) => s + Number(p.amount || 0), 0)
  const paid = prior + amount >= Number(invoice.amount || 0) - 0.005
  if (paid && invoice.status !== 'paid' && invoice.status !== 'void') {
    await supabase.from('fh_invoices').update({ status: 'paid' }).eq('id', invoice.id)
  }
  return { error: null, paid }
}

export async function setInvoiceStatus(invoice: Pick<InvoiceRow, 'id'>, status: InvoiceStatus, extra: Partial<InvoiceRow> = {}) {
  const { data, error } = await supabase
    .from('fh_invoices')
    .update({ status, ...extra })
    .eq('id', invoice.id)
    .select('*')
    .single()
  return { data: data as InvoiceRow | null, error }
}

/**
 * What an invoice is for, in the customer's words: the invoice's own
 * description, else the job title, else a generic line. Every PDF, email
 * and screen path that prints the Description column goes through this so
 * they never disagree (D62).
 */
export function invoiceDescription(
  invoice: { description?: string | null } | null | undefined,
  contact: { job_title?: string | null } | null | undefined
): string {
  return invoice?.description?.trim() || contact?.job_title?.trim() || 'Construction services'
}

export type InvoicePdfArgs = {
  invoice: InvoiceRow
  /** The job the invoice bills, or null when it bills the client directly (D62). */
  contact: any
  /** The client, read when there is no job (or the job has no customer details). */
  client?: any
  company: any
  payments?: any[]
  changeOrders?: any[]
  insurance?: any
  /** The job's invoices, so money logged against the job is spread over them as Money does. */
  invoices?: DueInvoice[] | null
  /** What this invoice still owes, when the caller has it; else it is worked out here. */
  amountDue?: number | null
}

/**
 * What generateInvoice (lib/pdf.js) is handed for one invoice, as plain
 * data, so the figures the PDF prints can be checked without drawing it.
 * With a job, the balance summary reconciles this bill against the
 * contract and the job's payments. Without one, the invoice is the whole
 * contract: the PDF skips the Contract position block and the hero asks
 * for the invoice less its payments.
 */
export function invoicePdfInput({ invoice, contact, client = null, company, payments = [], changeOrders = [], insurance = null, invoices = null, amountDue = null }: InvoicePdfArgs) {
  const job = contact || null
  const recipient = billTo(job, client)
  // generateInvoice folds approved COs into the balance summary itself
  // (it receives `changeOrders`), so pass the RAW contract amount here :
  // passing the CO-inclusive contractTotals().contractTotal double-counts.
  // A job with no recorded contract (and no approved change order) passes
  // null, and the PDF then reconciles against this invoice instead of
  // calling a $0 contract paid in full.
  const { paid } = contractTotals({ contact: job, payments, changeOrders })
  const contractTotal = !job || knownContractTotal({ amount: job?.amount, changeOrders }) == null
    ? null
    : Number(job?.amount || 0)
  const due = amountDue ?? invoiceAmountDue({ invoice, contact: job, payments, changeOrders, invoices })
  const title = invoice.title?.trim() || `Invoice #${invoice.sequence_number}`
  // Customer facing "what is this for". No address here, the recipient
  // block already prints it, and in the table it just wraps into noise.
  const description = invoiceDescription(invoice, job)
  return {
    company,
    contact: {
      id: recipient.id,
      name: recipient.name || 'Client',
      address: recipient.address,
      phone: recipient.phone,
      email: recipient.email,
      job_title: `${title}, ${recipient.job_title || 'Construction services'}`
    },
    // pdf.js maps line item `description` → the narrow bold
    // Product/Service column and `notes` → the wide Description column.
    // Title goes narrow, the human-readable description goes wide so it
    // only wraps when it actually runs out of room.
    lineItems: [{ description: title, notes: description, qty: 1, rate: invoice.amount, amount: invoice.amount }],
    notes: invoice.notes || '',
    dueDate: invoice.due_at
      ? new Date(invoice.due_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : '',
    dueDateIso: invoice.due_at || null,
    invoiceId: invoice.id,
    // The fh_invoices row this PDF bills, gives the PDF the same real
    // sequence number, issue date, and due date the web link shows, so
    // the emailed PDF and the public page never disagree.
    currentInvoice: invoice,
    payments,
    contractTotal,
    previouslyPaid: job ? paid : null,
    amountDue: due,
    insurance,
    changeOrders: job ? changeOrders : [],
    showContractPosition: !!job
  }
}

// Build the per-invoice PDF. The invoice's amount is "this invoice";
// the balance-summary block on the PDF reconciles it against the
// contract total + payments so the customer always sees where this
// bill sits in the whole job. The hero prints what the invoice still owes
// (invoiceAmountDue, or `amountDue` when the caller already worked it out),
// so the PDF and the email it travels with name one figure.
export async function buildInvoicePdf(args: InvoicePdfArgs) {
  const input = invoicePdfInput(args)
  const { generateInvoice } = await loadPdf()
  return generateInvoice(input as any)
}

export type SendInvoiceResult =
  | { ok: true; filename: string; recipient: string }
  | { ok: false; reason: 'no_email' | 'sender_not_configured' | 'error'; message?: string }

// Email an invoice: build PDF → upload to the private job-files bucket
// (server pulls it with service role) → POST /api/send-invoice → flip
// the row to 'sent'. On a missing Resend config the PDF downloads
// locally so the operator can email it by hand.
export async function sendInvoiceEmail({ invoice, duplicateReviewed = false, contact, client = null, company, userId, recipientEmail, payments = [], changeOrders = [], invoices = null, insurance = null }: {
  invoice: InvoiceRow
  /** The job the invoice bills, or null when it bills the client directly (D62). */
  contact: any
  /** The client, for the recipient when there is no job. */
  client?: any
  company: any
  userId: string
  recipientEmail?: string | null
  payments?: any[]
  changeOrders?: any[]
  /** The job's invoices, so the email asks for what invoiceAmountDue allocates to this one. */
  invoices?: DueInvoice[] | null
  insurance?: any
  duplicateReviewed?: boolean
}): Promise<SendInvoiceResult> {
  const job = contact || null
  const to = billTo(job, client)
  const recipient = (recipientEmail || to.email || '').trim()
  if (!recipient) return { ok: false, reason: 'no_email' }

  // One figure for the email and the PDF it attaches.
  const amountDue = invoiceAmountDue({ invoice, contact: job, payments, changeOrders, invoices })
  const result = await buildInvoicePdf({ invoice, contact: job, client, company, payments, changeOrders, insurance, invoices, amountDue })
  if (!result?.doc) return { ok: false, reason: 'error', message: 'PDF generator returned no document' }

  const blob = result.doc.output('blob')
  const rowId = createUuid()
  // Under the sender's own folder either way (the server checks that); a
  // job's PDF sits with the job's files, a client's under its invoice.
  const path = job ? `${userId}/${job.id}/${rowId}.pdf` : `${userId}/invoices/${invoice.id}/${rowId}.pdf`
  const { error: upErr } = await supabase.storage
    .from('job-files')
    .upload(path, blob, { upsert: false, contentType: 'application/pdf' })
  if (upErr) return { ok: false, reason: 'error', message: `Couldn't save the invoice PDF: ${upErr.message}` }

  // Audit row on the job, best-effort, never blocks the send.
  if (job) {
    try {
      await supabase.from('fh_job_files').insert({
        id: rowId,
        user_id: userId,
        job_id: job.id,
        filename: result.filename,
        storage_path: path,
        mime_type: 'application/pdf',
        size_bytes: blob.size || 0,
        kind: 'file'
      })
    } catch (e) {
      console.warn('[invoices] fh_job_files row insert failed', e)
    }
  }

  const sendRes = await fetch('/api/send-invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({
      contact_id: job?.id || null,
      invoice_id: invoice.id,
      invoice_updated_at: invoice.updated_at,
      duplicate_reviewed: duplicateReviewed,
      client_id: invoice.client_id || client?.id || null,
      sender_user_id: userId,
      recipient_email: recipient,
      recipient_name: to.name || null,
      storage_path: path,
      filename: result.filename,
      amount_due: amountDue,
      // What the email says the invoice is for, the same words as the PDF.
      description: invoiceDescription(invoice, job)
    })
  })
  const sendBody = await sendRes.json().catch(() => ({}))

  if (sendRes.status === 503 && sendBody?.error === 'sender_not_configured') {
    const { downloadPdf } = await loadPdf()
    downloadPdf(result)
    return { ok: false, reason: 'sender_not_configured' }
  }
  if (!sendRes.ok || !sendBody?.ok) {
    const detail = sendBody?.message || sendBody?.detail || sendBody?.error || 'Unknown provider error'
    const status = sendBody?.provider_status ? ` (HTTP ${sendBody.provider_status})` : ''
    return { ok: false, reason: 'error', message: `Delivery stopped${status}: ${detail}` }
  }

  // Don't downgrade a paid invoice just because the PDF was sent again.
  // `invoice` is the row as it was when this send started, and the email
  // can take seconds on a weak signal: only a row still in that status
  // moves to sent, so a void or a payment recorded meanwhile stays
  // (review of Phase 8, task 6).
  if (invoice.status !== 'paid') {
    await supabase
      .from('fh_invoices')
      .update({ status: 'sent', issued_at: invoice.issued_at || new Date().toISOString() })
      .eq('id', invoice.id)
      .eq('status', invoice.status)
  }
  return { ok: true, filename: result.filename, recipient }
}

// Suggested next invoice for a job, drives the new invoice screen's
// prefill. Final balance when the work's complete or everything else
// is billed; otherwise a progress draw of the unbilled remainder.
export function suggestNextInvoice({ contact, payments = [], changeOrders = [], invoices = [] }: {
  contact: Partial<Contact> | null | undefined
  payments?: any[]
  changeOrders?: any[]
  invoices?: any[]
}) {
  const totals = contractTotals({ contact, payments, changeOrders, invoices })
  const sequence = (invoices || []).filter((i) => i?.status !== 'void').length + 1
  // Cent-tolerant compare, unbilled and balance are independently
  // summed floats, so strict === mislabeled the final invoice whenever
  // FP dust crept in.
  const isFinal = !!(contact as any)?.completed_at || (totals.unbilled > 0.005 && Math.abs(totals.unbilled - totals.balance) < 0.005 && sequence > 1)
  // Suggest ONLY unbilled money, rounded to cents (whole-dollar
  // rounding left invoice sets that never reconciled to the contract).
  // When everything is already invoiced, suggest $0, the old
  // `unbilled || balance` fallthrough prefilled a duplicate invoice for
  // the full outstanding balance the moment unbilled hit exactly 0.
  const amount = totals.unbilled > 0.005 ? Math.round(totals.unbilled * 100) / 100 : 0
  return {
    title: isFinal ? 'Final balance' : sequence === 1 ? 'Deposit' : `Progress draw ${sequence}`,
    amount,
    totals
  }
}
