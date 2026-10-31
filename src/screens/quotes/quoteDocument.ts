import { createUuid } from '../../lib/uuid.ts'
// The quote's document, out the door (Phase 9, Task 10): the proposal PDF,
// the email send, the share link and the electronic signature request, for
// an fh_quotes row. Moved here from the job page's Quote tab, which did the
// same for a contact at stage quote. Every path reads the lines fresh by
// quote_id, so a save still landing is in the document.
//
// Nothing here sends on its own: each function runs on a tap, and the
// Netlify functions behind /api/send-quote and /api/docusign-send do the
// sending. Task 11 teaches them to read the quote by quote_id; until then
// the old contact id rides along when the quote has one.

import { proposalIssuedAt } from '../../lib/proposalDate.ts'
import { supabase, authHeaders } from '../../lib/supabase.ts'
import { mintPublicLink } from '../../lib/publicLink.ts'
import { quoteFollowUpDate } from '../../lib/quoteFollowUp.ts'
import { loadProjectPhotosForPdf } from '../ContactDetail/sections/DocumentPreviewPane.tsx'
import { quoteAsContact, type QuoteWithClient } from './quoteShape.ts'

// Lazy, pdf.js plus jspdf and autoTable are large. Only loads on a tap.
async function loadPdf(): Promise<any> {
  return import('../../lib/pdf.js')
}

export type Company = {
  name: string
  address: string
  phone: string
  email: string
  website: string
  logo_url: string | null
  brand_accent_hex: string | null
  estimate_template: string
  license_number: string
  insured_text: string
  warranty_default: string
}

/** The company block the proposal prints, from the profile. */
export function companyFromProfile(profile: any): Company {
  return {
    name: profile?.company_name || profile?.full_name || 'My Company',
    address: profile?.company_address || '',
    phone: profile?.company_phone || '',
    // The customer facing company_email over the operator's auth email.
    email: profile?.company_email || profile?.email || '',
    website: profile?.company_website || '',
    logo_url: profile?.logo_url || null,
    brand_accent_hex: profile?.brand_accent_hex || null,
    estimate_template: profile?.estimate_template || 'classic',
    license_number: profile?.license_number || '',
    insured_text: profile?.insured_text || '',
    warranty_default: profile?.warranty_default || ''
  }
}

/** The old fh_contacts id the quote came from, or the job it became, for the server routes that still want one. */
export function legacyContactId(quote: QuoteWithClient): string | null {
  return quote.job_id || quote.origin_contact_id || null
}

export type BuildInput = {
  quote: QuoteWithClient
  company: Company
  userId: string
  /** The address the proposal is going to, found the way Money finds it. */
  recipientEmail: string | null
  insurance?: any
}

export class NoLinesError extends Error {
  constructor() { super('Add at least one line in the total before building the quote.') }
}

/** Reads the lines and builds the proposal PDF. Throws NoLinesError with no base line. */
export async function buildQuotePdf({ quote, company, userId, recipientEmail, insurance = null }: BuildInput) {
  const { generateQuote } = await loadPdf()
  const { data, error } = await supabase
    .from('fh_quote_items')
    .select('*')
    .eq('quote_id', quote.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  const items: any[] = data || []
  if (items.filter((i) => !i.is_optional && !i.is_excluded).length === 0) throw new NoLinesError()

  // Photos for the cover and the scope sections, from the job the quote came
  // from or became, best effort. A quote with neither has none.
  const photoSource = legacyContactId(quote)
  const photos: any[] = photoSource ? await loadProjectPhotosForPdf(photoSource, userId).catch(() => []) : []

  const contact = quoteAsContact(quote, recipientEmail)
  const result = await generateQuote({
    company,
    contact: {
      id: contact.id,
      name: contact.name,
      address: contact.address,
      phone: contact.phone,
      email: recipientEmail || null,
      job_title: contact.job_title
    },
    items,
    scope: quote.scope_text || '',
    terms: quote.terms_text || '',
    exclusions: quote.exclusions_text || '',
    expiresAt: quote.expires_at || null,
    issuedAt: proposalIssuedAt(quote),
    status: quote.status || 'draft',
    quoteId: quote.id,
    photos,
    insurance,
    changeOrders: []
  } as any)
  if (!result?.doc) throw new Error('PDF generator returned no document')
  return result
}

export async function downloadQuotePdf(result: any) {
  const { downloadPdf } = await loadPdf()
  downloadPdf(result)
}

// Saves the PDF to job-files so the server can pull it by path with the
// service role. A quote that became a job also gets a Files row on that
// job; a quote with no job has nowhere to list the file, so only storage
// keeps it.
async function uploadQuotePdf(quote: QuoteWithClient, userId: string, result: any): Promise<string> {
  const blob = result.doc.output('blob')
  const rowId = createUuid()
  const path = `${userId}/quotes/${quote.id}/${rowId}.pdf`
  const { error: upErr } = await supabase.storage
    .from('job-files')
    .upload(path, blob, { upsert: false, contentType: 'application/pdf' })
  if (upErr) throw new Error(`Couldn't save the proposal PDF: ${upErr.message}`)
  if (quote.job_id) {
    const { error: insErr } = await supabase.from('fh_job_files').insert({
      id: rowId,
      user_id: userId,
      job_id: quote.job_id,
      filename: result.filename,
      storage_path: path,
      mime_type: 'application/pdf',
      size_bytes: blob.size || 0,
      kind: 'file'
    })
    if (insErr) console.warn('[quote] fh_job_files row insert failed', insErr)
  }
  return path
}

export type SendOutcome = { kind: 'sent' } | { kind: 'sender_not_configured'; result: any }

/** Builds the PDF, saves it and asks the server to email it. */
export async function sendQuoteByEmail(input: BuildInput & { preferences: unknown }): Promise<SendOutcome> {
  const { quote, userId, recipientEmail } = input
  if (!recipientEmail) throw new Error('Add a client email first so we know where to send.')
  const result = await buildQuotePdf(input)
  const path = await uploadQuotePdf(quote, userId, result)
  const res = await fetch('/api/send-quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({
      quote_id: quote.id,
      contact_id: legacyContactId(quote),
      sender_user_id: userId,
      recipient_email: recipientEmail,
      recipient_name: quote.fh_clients?.name || null,
      storage_path: path,
      filename: result.filename,
      follow_up_on: quoteFollowUpDate(input.preferences)
    })
  })
  const body = await res.json().catch(() => ({}))
  if (res.status === 503 && body?.error === 'sender_not_configured') return { kind: 'sender_not_configured', result }
  if (!res.ok || !body?.ok) throw new Error(body?.detail || body?.error || 'Email send failed.')
  return { kind: 'sent' }
}

/** Builds the PDF, saves it and asks DocuSign for a signature. */
export async function sendQuoteForSignature(input: BuildInput): Promise<'sent' | 'esign_not_configured'> {
  const { quote, userId, recipientEmail } = input
  if (!recipientEmail) throw new Error('Add a client email first. DocuSign sends the signing request to the client email.')
  const result = await buildQuotePdf(input)
  const path = await uploadQuotePdf(quote, userId, result)
  const res = await fetch('/api/docusign-send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({
      quote_id: quote.id,
      contact_id: legacyContactId(quote),
      sender_user_id: userId,
      recipient_email: recipientEmail,
      recipient_name: quote.fh_clients?.name || null,
      storage_path: path
    })
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 503 && data?.error === 'esign_not_configured') return 'esign_not_configured'
  if (!res.ok || !data?.ok) throw new Error(data?.detail || data?.error || 'DocuSign send failed.')
  return 'sent'
}

/** Mints the customer link for the quote and returns its URL. */
export async function mintQuoteLink(quote: QuoteWithClient, userId: string): Promise<string> {
  const link = await mintPublicLink({ quoteId: quote.id, contactId: legacyContactId(quote), userId, kind: 'proposal' })
  return link.url
}

/** Only a draft or requested revision needs a manual delivery acknowledgement. */
export function canMarkSent(status: string | null | undefined): boolean {
  return ['draft', 'changes_requested'].includes(String(status || '').toLowerCase())
}

/** Confirm delivery only while the stored quote is still the version of its
 * lifecycle the operator saw. A concurrent approval, request or conversion
 * must win over this acknowledgement. */
export async function markQuoteSent(quoteId: string, expectedStatus: string | null | undefined) {
  const status = String(expectedStatus || '').toLowerCase()
  if (!quoteId || !canMarkSent(status)) throw new Error('This quote cannot be marked as sent.')
  const sentAt = new Date().toISOString()
  const { data, error } = await supabase
    .from('fh_quotes')
    .update({ status: 'sent', sent_at: sentAt })
    .eq('id', quoteId)
    .eq('status', status)
    .is('job_id', null)
    .select('id,status,sent_at')
    .maybeSingle()
  if (error) throw new Error(error.message || 'The quote could not be updated.')
  if (!data || data.id !== quoteId || data.status !== 'sent' || !data.sent_at || Date.parse(data.sent_at) !== Date.parse(sentAt)) {
    throw new Error('This quote has changed. Review its current status before marking it as sent.')
  }
  return data
}

/** An iPhone running the app from the home screen, where the share sheet hands a link on. */
export function isIosStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const standalone = (window.navigator as any).standalone === true
    || window.matchMedia?.('(display-mode: standalone)').matches
  return standalone && /iphone|ipad|ipod/i.test(window.navigator.userAgent)
}
