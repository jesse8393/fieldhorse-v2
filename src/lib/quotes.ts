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
export type ContactInsert = Database['public']['Tables']['fh_contacts']['Insert']

export type QuoteStatus = 'draft' | 'sent' | 'viewed' | 'changes_requested' | 'approved' | 'rejected' | 'expired' | 'lost'


const clean = (s: string | null | undefined) => {
  const t = s?.trim()
  return t ? t : null
}

export async function createQuote(input: {
  userId: string
  orgId: string | null
  clientId: string
  leadId?: string | null
  title?: string | null
  scopeText?: string | null
  termsText?: string | null
  jobType?: string | null
}): Promise<QuoteRow> {
  const row: QuoteInsert = {
    user_id: input.userId,
    org_id: input.orgId ?? null,
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

// The server atomically copies and links the quote. Repeated requests
// return the existing job after checking current permissions.
export async function makeJobFromQuote(quoteId: string): Promise<{ jobId: string }> {
  const { data, error } = await supabase.rpc('fh_make_job_from_quote', { p_quote_id: quoteId })
  if (error) throw new Error(error.message)
  if (typeof data !== 'string' || !data) throw new Error('Job creation could not be confirmed. Try again.')
  return { jobId: data }
}

// The customer facing quote number, seeded by the quote id so a
// regenerated document keeps the same number.
export function quoteNumber(companyName: string | null | undefined, quoteId: string, issuedAt?: string | Date | null): string {
  return proposalNumber(companyName, quoteId, issuedAt)
}
