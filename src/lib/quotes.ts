// Quotes (SPEC D53 to D61). A quote lives on fh_quotes and points at a
// client and, when it came from one, a lead. Make this a job copies its
// scope, price and terms into a new fh_contacts row at stage job and
// sets fh_quotes.job_id; the quote itself keeps its status (D54).

import { supabase } from './supabase.ts'
import { proposalNumber } from '../components/documents/numbers.ts'
import type { Database } from './database.types.ts'

export type QuoteRow = Database['public']['Tables']['fh_quotes']['Row']
export type QuoteInsert = Database['public']['Tables']['fh_quotes']['Insert']
export type QuoteItemRow = Database['public']['Tables']['fh_quote_items']['Row']
type QuoteItemInsert = Database['public']['Tables']['fh_quote_items']['Insert']
export type ContactInsert = Database['public']['Tables']['fh_contacts']['Insert']

export type QuoteStatus = 'draft' | 'sent' | 'viewed' | 'changes_requested' | 'approved' | 'rejected' | 'expired' | 'lost'

export type QuoteClient = { name: string; phone?: string | null; email?: string | null }

const clean = (s: string | null | undefined) => {
  const t = s?.trim()
  return t ? t : null
}

export async function createQuote(input: {
  userId: string
  orgId: string
  clientId: string
  leadId?: string | null
  title?: string | null
  scopeText?: string | null
  termsText?: string | null
  jobType?: string | null
}): Promise<QuoteRow> {
  const row: QuoteInsert = {
    user_id: input.userId,
    org_id: input.orgId,
    client_id: input.clientId,
    lead_id: input.leadId || null,
    title: clean(input.title),
    scope_text: clean(input.scopeText),
    terms_text: clean(input.termsText),
    job_type: clean(input.jobType),
    status: 'draft',
  }
  const { data, error } = await supabase
    .from('fh_quotes')
    .insert(row)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as QuoteRow
}

// The price a job inherits: the base lines only. Optional and excluded
// lines are shown on the quote but never counted (review focus 2).
export function quoteBaseTotal(items: Pick<QuoteItemRow, 'amount' | 'is_optional' | 'is_excluded'>[]): number {
  return items
    .filter((i) => !i.is_optional && !i.is_excluded)
    .reduce((sum, i) => sum + (Number(i.amount) || 0), 0)
}

// Pure. The fh_contacts row Make this a job inserts.
export function quoteToJobDraft(quote: QuoteRow, items: QuoteItemRow[], client: QuoteClient): ContactInsert {
  return {
    stage: 'job',
    client_id: quote.client_id,
    name: client.name,
    phone: client.phone ?? null,
    email: client.email ?? null,
    job_title: quote.title ?? null,
    amount: quoteBaseTotal(items),
    scope_text: quote.scope_text ?? null,
    terms_text: quote.terms_text ?? null,
    exclusions_text: quote.exclusions_text ?? null,
    job_type: quote.job_type ?? null,
    user_id: quote.user_id,
    org_id: quote.org_id ?? null,
  }
}

// Loads the quote, its lines and its client, inserts the job, copies
// the lines onto the job (contact_id set, quote_id null) so the job's
// Money tab keeps working, and links the quote to the job. The quote's
// status is left alone.
export async function makeJobFromQuote(quoteId: string): Promise<{ jobId: string }> {
  const quoteRes = await supabase
    .from('fh_quotes')
    .select('*')
    .eq('id', quoteId)
    .single()
  if (quoteRes.error) throw new Error(quoteRes.error.message)
  const quote = quoteRes.data as QuoteRow

  const itemsRes = await supabase
    .from('fh_quote_items')
    .select('*')
    .eq('quote_id', quoteId)
    .order('sort_order', { ascending: true })
  if (itemsRes.error) throw new Error(itemsRes.error.message)
  const items = (itemsRes.data || []) as QuoteItemRow[]

  const clientRes = await supabase
    .from('fh_clients')
    .select('name, phone, email')
    .eq('id', quote.client_id)
    .single()
  if (clientRes.error) throw new Error(clientRes.error.message)
  const client = clientRes.data as QuoteClient

  const jobRes = await supabase
    .from('fh_contacts')
    .insert(quoteToJobDraft(quote, items, client))
    .select('id')
    .single()
  if (jobRes.error) throw new Error(jobRes.error.message)
  const jobId = (jobRes.data as { id: string }).id

  if (items.length > 0) {
    const copies: QuoteItemInsert[] = items.map((i) => ({
      contact_id: jobId,
      quote_id: null,
      description: i.description,
      qty: i.qty,
      rate: i.rate,
      amount: i.amount,
      unit: i.unit,
      section: i.section,
      notes: i.notes,
      is_optional: i.is_optional,
      is_excluded: i.is_excluded,
      sort_order: i.sort_order,
      user_id: i.user_id,
      org_id: i.org_id,
    }))
    const copyRes = await supabase.from('fh_quote_items').insert(copies)
    if (copyRes.error) throw new Error(copyRes.error.message)
  }

  const linkRes = await supabase
    .from('fh_quotes')
    .update({ job_id: jobId })
    .eq('id', quoteId)
  if (linkRes.error) throw new Error(linkRes.error.message)

  return { jobId }
}

// The customer facing quote number, seeded by the quote id so a
// regenerated document keeps the same number.
export function quoteNumber(companyName: string | null | undefined, quoteId: string, issuedAt?: string | Date | null): string {
  return proposalNumber(companyName, quoteId, issuedAt)
}
