// Where an fh_contacts row went (SPEC D56). The migration copied every lead
// into fh_leads and every quote into fh_quotes, marked the old row
// moved_lead or moved_quote, and kept the old id on the new row as
// origin_contact_id. A link that still carries the old id follows that
// pointer to the new record.
import { supabase } from './supabase.ts'
import type { RecordKind } from './records.ts'

export type MovedRecord = { kind: Extract<RecordKind, 'lead' | 'quote'>; id: string }

// The new record for an old contact id: the lead first, then the quote. Null
// when nothing points back at this id, or when a read fails.
export async function findMovedRecord(contactId: string): Promise<MovedRecord | null> {
  const lead = await supabase.from('fh_leads').select('id').eq('origin_contact_id', contactId).limit(1).maybeSingle()
  if (lead.data?.id) return { kind: 'lead', id: lead.data.id }
  const quote = await supabase.from('fh_quotes').select('id').eq('origin_contact_id', contactId).limit(1).maybeSingle()
  if (quote.data?.id) return { kind: 'quote', id: quote.data.id }
  return null
}

export type RecordTitle = { id: string; title: string | null }

// A lead or quote by its own id, with the title shown on its screen. Null
// when the id is not a row of that table.
export async function findRecordTitle(kind: MovedRecord['kind'], id: string): Promise<RecordTitle | null> {
  const table = kind === 'lead' ? 'fh_leads' : 'fh_quotes'
  const res = await supabase.from(table).select('id, title').eq('id', id).maybeSingle()
  return res.data ? { id: res.data.id, title: res.data.title } : null
}
