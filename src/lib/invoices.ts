// First-class invoices (pipeline v2). One fh_invoices row per invoice,
// N per job — deposit, progress draws, final balance. This module is
// the single home for create / PDF / send / settle so the job screen,
// the Financials tab, and the Invoices screen all drive the same
// plumbing. Extracted from InvoiceDrawsSection (which now consumes it)
// so "send an invoice" is callable from anywhere with one function.

import { supabase, authHeaders } from './supabase.ts'
import { generateInvoice, downloadPdf } from './pdf.js'
import type { Database } from './database.types.ts'

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
    insured_text: profile?.insured_text || ''
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
    balance: Math.max(0, contractTotal - paid),
    unbilled: Math.max(0, contractTotal - invoiced)
  }
}

export async function fetchInvoicesForContact(contactId: string) {
  const { data, error } = await supabase
    .from('fh_invoices')
    .select('*')
    .eq('contact_id', contactId)
    .order('sequence_number', { ascending: true })
  return { data: (data || []) as InvoiceRow[], error }
}

export async function createInvoice({ contact, userId, title, amount, status = 'draft', due_at = null, notes = null, description = null }: {
  contact: Pick<Contact, 'id'>
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
      contact_id: contact.id,
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

export async function setInvoiceStatus(invoice: Pick<InvoiceRow, 'id'>, status: InvoiceStatus, extra: Partial<InvoiceRow> = {}) {
  const { data, error } = await supabase
    .from('fh_invoices')
    .update({ status, ...extra })
    .eq('id', invoice.id)
    .select('*')
    .single()
  return { data: data as InvoiceRow | null, error }
}

// Build the per-invoice PDF. The invoice's amount is "this invoice";
// the balance-summary block on the PDF reconciles it against the
// contract total + payments so the customer always sees where this
// bill sits in the whole job.
export async function buildInvoicePdf({ invoice, contact, company, payments = [], changeOrders = [], insurance = null }: {
  invoice: InvoiceRow
  contact: any
  company: any
  payments?: any[]
  changeOrders?: any[]
  insurance?: any
}) {
  const { contractTotal, paid } = contractTotals({ contact, payments, changeOrders })
  const title = invoice.title?.trim() || `Invoice #${invoice.sequence_number}`
  // Customer-facing "what is this for". Falls back to the job title.
  // No address here — the recipient block already prints it, and in
  // the table it just wraps into noise.
  const description = (invoice as any).description?.trim()
    || contact.job_title
    || 'Construction services'
  return generateInvoice({
    company,
    contact: {
      id: contact.id,
      name: contact.name || 'Client',
      address: contact.address,
      phone: contact.phone,
      email: contact.email,
      job_title: `${title} — ${contact.job_title || 'Construction services'}`
    },
    // pdf.js maps line-item `description` → the narrow bold
    // Product/Service column and `notes` → the wide Description column.
    // Title goes narrow, the human-readable description goes wide so it
    // only wraps when it actually runs out of room.
    lineItems: [{ description: title, notes: description, qty: 1, rate: invoice.amount, amount: invoice.amount }],
    notes: invoice.notes || '',
    dueDate: invoice.due_at
      ? new Date(invoice.due_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : '',
    invoiceId: invoice.id,
    payments,
    contractTotal,
    previouslyPaid: paid,
    insurance,
    changeOrders
  } as any)
}

export type SendInvoiceResult =
  | { ok: true; filename: string; recipient: string }
  | { ok: false; reason: 'no_email' | 'sender_not_configured' | 'error'; message?: string }

// Email an invoice: build PDF → upload to the private job-files bucket
// (server pulls it with service role) → POST /api/send-invoice → flip
// the row to 'sent'. On a missing Resend config the PDF downloads
// locally so the operator can email it by hand.
export async function sendInvoiceEmail({ invoice, contact, company, userId, recipientEmail, payments = [], changeOrders = [], insurance = null }: {
  invoice: InvoiceRow
  contact: any
  company: any
  userId: string
  recipientEmail?: string | null
  payments?: any[]
  changeOrders?: any[]
  insurance?: any
}): Promise<SendInvoiceResult> {
  const recipient = (recipientEmail || contact?.email || contact?.fh_clients?.email || '').trim()
  if (!recipient) return { ok: false, reason: 'no_email' }

  const result = await buildInvoicePdf({ invoice, contact, company, payments, changeOrders, insurance })
  if (!result?.doc) return { ok: false, reason: 'error', message: 'PDF generator returned no document' }

  const blob = result.doc.output('blob')
  const rowId = crypto.randomUUID()
  const path = `${userId}/${contact.id}/${rowId}.pdf`
  const { error: upErr } = await supabase.storage
    .from('job-files')
    .upload(path, blob, { upsert: false, contentType: 'application/pdf' })
  if (upErr) return { ok: false, reason: 'error', message: `Couldn't save the invoice PDF: ${upErr.message}` }

  // Audit row — best-effort, never blocks the send.
  try {
    await supabase.from('fh_job_files').insert({
      id: rowId,
      user_id: userId,
      job_id: contact.id,
      filename: result.filename,
      storage_path: path,
      mime_type: 'application/pdf',
      size_bytes: blob.size || 0,
      kind: 'file'
    })
  } catch (e) {
    console.warn('[invoices] fh_job_files row insert failed', e)
  }

  const sendRes = await fetch('/api/send-invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({
      contact_id: contact.id,
      sender_user_id: userId,
      recipient_email: recipient,
      recipient_name: contact.name || null,
      storage_path: path,
      filename: result.filename,
      amount_due: invoice.amount
    })
  })
  const sendBody = await sendRes.json().catch(() => ({}))

  if (sendRes.status === 503 && sendBody?.error === 'sender_not_configured') {
    downloadPdf(result)
    return { ok: false, reason: 'sender_not_configured' }
  }
  if (!sendRes.ok || !sendBody?.ok) {
    const detail = sendBody?.detail || sendBody?.error || 'Unknown provider error'
    const status = sendBody?.provider_status ? ` (HTTP ${sendBody.provider_status})` : ''
    return { ok: false, reason: 'error', message: `Resend rejected${status}: ${detail}` }
  }

  // Don't downgrade a paid invoice just because the PDF was re-sent.
  if (invoice.status !== 'paid') {
    await supabase
      .from('fh_invoices')
      .update({ status: 'sent', issued_at: invoice.issued_at || new Date().toISOString() })
      .eq('id', invoice.id)
  }
  return { ok: true, filename: result.filename, recipient }
}

// Suggested next invoice for a job — drives the SendInvoiceSheet
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
  const isFinal = !!(contact as any)?.completed_at || (totals.unbilled > 0 && totals.unbilled === totals.balance && sequence > 1)
  return {
    title: isFinal ? 'Final balance' : sequence === 1 ? 'Deposit' : `Progress draw ${sequence}`,
    amount: Math.round(totals.unbilled || totals.balance),
    totals
  }
}
