import { supabase } from './supabase.ts'
import type { ContactInsert } from './quotes.ts'

/** A retry must address the same job when its first response was lost. */
export async function createJob(row: ContactInsert & { id: string }): Promise<{ id: string }> {
  const { data, error } = await supabase.from('fh_contacts').insert(row).select('id').single()
  if (!error && data?.id) return { id: data.id }
  if (error?.code === '23505') {
    // Never overwrite a committed job with a retry. Only reuse the exact
    // intent owned by this user and company, with RLS still applied.
    let query = supabase.from('fh_contacts').select('id').eq('id', row.id).eq('user_id', row.user_id)
    query = row.org_id ? query.eq('org_id', row.org_id) : query.is('org_id', null)
    const existing = await query.maybeSingle()
    if (!existing.error && existing.data?.id) return { id: existing.data.id }
  }
  throw new Error(error?.message || 'Could not confirm this job was saved. Try again.')
}
