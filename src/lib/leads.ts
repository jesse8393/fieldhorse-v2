// Leads (SPEC D53 to D60). A lead is information from a customer who has
// no quote yet. It lives on fh_leads and points at a client; Quote this
// copies it into a quote draft and marks it quoted once the quote saves.

import { supabase } from './supabase.ts'
import type { Database } from './database.types.ts'

export type LeadRow = Database['public']['Tables']['fh_leads']['Row']
export type LeadInsert = Database['public']['Tables']['fh_leads']['Insert']
export type QuoteInsert = Database['public']['Tables']['fh_quotes']['Insert']

export type LeadStatus = 'open' | 'quoted' | 'lost'

const clean = (s: string | null | undefined) => {
  const t = s?.trim()
  return t ? t : null
}

export async function createLead(input: {
  userId: string
  orgId: string
  clientId: string
  title?: string | null
  notes?: string | null
  source?: string | null
  referredBy?: string | null
  jobType?: string | null
  followUpOn?: string | null
}): Promise<LeadRow> {
  const row: LeadInsert = {
    user_id: input.userId,
    org_id: input.orgId,
    client_id: input.clientId,
    title: clean(input.title),
    notes: clean(input.notes),
    source: clean(input.source),
    referred_by: clean(input.referredBy),
    job_type: clean(input.jobType),
    follow_up_on: input.followUpOn || null,
    status: 'open',
  }
  const { data, error } = await supabase
    .from('fh_leads')
    .insert(row)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as LeadRow
}

async function setLeadStatus(leadId: string, patch: { status: LeadStatus; quote_id?: string | null }) {
  const { error } = await supabase
    .from('fh_leads')
    .update(patch)
    .eq('id', leadId)
  if (error) throw new Error(error.message)
}

// Called once the quote made from this lead has saved (D60).
export async function markLeadQuoted(leadId: string, quoteId: string): Promise<void> {
  await setLeadStatus(leadId, { status: 'quoted', quote_id: quoteId })
}

export async function markLeadLost(leadId: string): Promise<void> {
  await setLeadStatus(leadId, { status: 'lost' })
}

// Pure. The quote draft that Quote this opens: same client, title and
// job type, the lead's notes as the starting scope, and a pointer back.
export function leadToQuoteDraft(lead: LeadRow): Partial<QuoteInsert> {
  return {
    client_id: lead.client_id,
    title: lead.title ?? null,
    job_type: lead.job_type ?? null,
    scope_text: lead.notes ?? null,
    lead_id: lead.id,
  }
}
