// src/lib/closeout.ts
//
// Closeout actions for the Mark Complete sheet. Reads/writes fh_closeouts
// (migration 028), advances stage to 'closed' when needed, and snapshots
// the job's dollars + photo count at close time so the historical record
// doesn't drift when line items get edited later.
//
// Sign-off methods come from the migration's CHECK constraint — keep this
// list in sync with the SQL or upserts will reject.

import { supabase } from './supabase.ts'
import { transitionStage } from './stages.ts'
import type { Database } from './database.types.ts'

type Contact = Database['public']['Tables']['fh_contacts']['Row']

type CloseoutPayload = {
  closed_at?: string | null
  warranty_start_date?: string | null
  warranty_months?: number | string | null
  signoff_name?: string | null
  signoff_method?: string | null
  signoff_at?: string | null
  notes?: string | null
}

export const SIGNOFF_METHODS = [
  { id: 'verbal',           label: 'Verbal' },
  { id: 'text',             label: 'Text' },
  { id: 'email',            label: 'Email' },
  { id: 'in_person',        label: 'In person' },
  { id: 'signature_typed',  label: 'Typed signature' }
]

export const WARRANTY_PRESETS = [
  { id: 0,   label: 'No warranty' },
  { id: 6,   label: '6 months' },
  { id: 12,  label: '1 year' },
  { id: 24,  label: '2 years' },
  { id: 60,  label: '5 years' },
  { id: 120, label: '10 years' }
]

// Load any existing closeout for a job. Returns null when none.
export async function loadCloseout({ userId, contactId }: { userId: string | undefined; contactId: string | undefined }) {
  if (!userId || !contactId) return null
  const { data } = await supabase
    .from('fh_closeouts')
    .select('*')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .maybeSingle()
  return data || null
}

// Snapshot helpers — called by the sheet before save so the modal can
// show the operator what's about to be locked in.
export async function snapshotJobTotals({ userId, contactId }: { userId: string | undefined; contactId: string | undefined }) {
  if (!userId || !contactId) return { paid: 0, photoCount: 0, approvedCO: 0 }
  const [{ data: payments }, { count: photoCount }, { data: cos }] = await Promise.all([
    supabase
      .from('fh_payments')
      .select('amount')
      .eq('user_id', userId)
      .eq('contact_id', contactId),
    supabase
      .from('fh_job_files')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('job_id', contactId),
    // Approved change orders count toward the final contract — a
    // certificate that says "Paid in full" while CO money is owed is
    // exactly the error the auto-close path already guards against.
    supabase
      .from('fh_change_orders')
      .select('amount, status')
      .eq('user_id', userId)
      .eq('contact_id', contactId)
      .eq('status', 'approved')
  ])
  const paid = (payments || []).reduce((s, p) => s + Number(p.amount || 0), 0)
  const approvedCO = (cos || []).reduce((s, c) => s + Number(c.amount || 0), 0)
  return { paid, photoCount: photoCount || 0, approvedCO }
}

// Persist a closeout. Upserts on (contact_id), so re-completing an
// already-closed job updates the existing record instead of erroring.
// When advanceStage=true and the job isn't already closed, also flips
// stage to 'closed' so the pipeline reflects the closeout.
export async function saveCloseout({ userId, contact, payload, advanceStage = true }: { userId: string | undefined; contact: Contact; payload: CloseoutPayload; advanceStage?: boolean }) {
  if (!userId || !contact?.id) throw new Error('saveCloseout: userId + contact required')

  const totals = await snapshotJobTotals({ userId, contactId: contact.id })

  const row = {
    user_id: userId,
    contact_id: contact.id,
    closed_at: payload.closed_at || new Date().toISOString(),
    warranty_start_date: payload.warranty_start_date || null,
    warranty_months: Number.isFinite(Number(payload.warranty_months)) ? Number(payload.warranty_months) : null,
    signoff_name: payload.signoff_name?.trim() || null,
    signoff_method: SIGNOFF_METHODS.some((m) => m.id === payload.signoff_method)
      ? (payload.signoff_method as string)
      : 'verbal',
    signoff_at: payload.signoff_at || new Date().toISOString(),
    notes: payload.notes?.trim() || null,
    // Contract snapshot INCLUDES approved change orders so the
    // certificate's Final Figures reconcile (contract − paid = balance)
    // instead of printing "Paid in full" while CO money is outstanding.
    final_amount: Number(contact.amount || 0) + Number(totals.approvedCO || 0),
    paid_at_close: totals.paid,
    final_photo_count: totals.photoCount
  }

  const { error } = await supabase
    .from('fh_closeouts')
    .upsert(row, { onConflict: 'contact_id' })
  if (error) throw error

  if (advanceStage && contact.stage !== 'closed') {
    const { error: tErr } = await transitionStage(contact, 'closed')
    if (tErr) throw tErr
  }

  // Best-effort activity note — surfaces on the Activity tab without
  // needing a dedicated event composer.
  try {
    const signLine = row.signoff_name
      ? `${row.signoff_name} signed off (${row.signoff_method.replace('_', ' ')})`
      : `Closed (${row.signoff_method.replace('_', ' ')})`
    await supabase.from('fh_notes').insert({
      user_id: userId,
      contact_id: contact.id,
      text: row.notes ? `${signLine}\n\n${row.notes}` : signLine,
      category: 'activity'
    })
  } catch {}

  return { ...row, totals }
}

// Delete an existing closeout (and optionally reopen the stage).
export async function clearCloseout({ userId, contact, reopenTo = 'job' }: { userId: string | undefined; contact: Contact; reopenTo?: 'invoice' | 'job' | 'lead' | 'quote' | 'closed' | 'lost' }) {
  if (!userId || !contact?.id) throw new Error('clearCloseout: userId + contact required')
  const { error } = await supabase
    .from('fh_closeouts')
    .delete()
    .eq('user_id', userId)
    .eq('contact_id', contact.id)
  if (error) throw error
  if (reopenTo && contact.stage === 'closed') {
    await transitionStage(contact, reopenTo)
  }
}
