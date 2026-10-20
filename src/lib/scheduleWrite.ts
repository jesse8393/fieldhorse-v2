// Writers for fh_schedule, shared by the event screen (/schedule/new) and
// the desktop Schedule board's drag and drop. Both write the same row, and
// that row carries org_id, which the old path left to the database trigger
// (migration 035). A visit belongs to one record (SPEC D53, D60): a job
// through contact_id, a lead through lead_id or a quote through quote_id.

import { supabase } from './supabase.ts'

export type ScheduleEventInput = {
  userId: string
  /** The company the visit belongs to. Null when the person has none. */
  orgId: string | null
  contactId: string | null
  /** The lead this visit is for (a lead's estimate, D60). */
  leadId?: string | null
  /** The quote this visit is for. */
  quoteId?: string | null
  title: string
  /** Where and who, such as the client's name and address. */
  description?: string | null
  start_at: string
  end_at: string
  /** Shared series id for a recurring run; every occurrence carries it. */
  recurring?: string | null
}

export type CreateScheduleEventResult = { id: string } | { error: string }
export type CreateScheduleEventsResult = { ids: string[] } | { error: string }

function row(input: ScheduleEventInput) {
  return {
    // Like findOrCreateClient: send the company when it is known, and
    // leave it out otherwise so the insert trigger can fill it.
    ...(input.orgId ? { org_id: input.orgId } : {}),
    user_id: input.userId,
    contact_id: input.contactId || null,
    lead_id: input.leadId || null,
    quote_id: input.quoteId || null,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    start_at: input.start_at,
    end_at: input.end_at,
    recurring: input.recurring ?? null
  }
}

/**
 * Insert several visits in one request (a recurring series is all or
 * nothing). Resolves to the new ids, or the message to show.
 */
export async function createScheduleEvents(inputs: ScheduleEventInput[]): Promise<CreateScheduleEventsResult> {
  if (inputs.some((i) => !i.title.trim())) return { error: 'Give the event a title.' }
  if (inputs.length === 0) return { ids: [] }
  try {
    const { data, error } = await supabase.from('fh_schedule').insert(inputs.map(row)).select('id')
    if (error) return { error: error.message || 'Try again.' }
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id)
    if (ids.length === 0) return { error: 'The event was not saved. Try again.' }
    return { ids }
  } catch (e) {
    return { error: (e as { message?: string })?.message || 'Try again.' }
  }
}

/** Insert one visit. Resolves to its id, or the message to show. */
export async function createScheduleEvent(input: ScheduleEventInput): Promise<CreateScheduleEventResult> {
  const result = await createScheduleEvents([input])
  if ('error' in result) return result
  return { id: result.ids[0] }
}

/**
 * Remove one visit by id (the Undo of a drop). RLS scopes the company, and
 * asking for the id back turns a delete that matched nothing into a
 * visible failure instead of a false success.
 */
export async function deleteScheduleEvent(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    const { data, error } = await supabase.from('fh_schedule').delete().eq('id', id).select('id')
    if (error) return { error: error.message || 'Try again.' }
    if (!data?.length) return { error: 'The event was not removed. Refresh and try again.' }
    return { ok: true }
  } catch (e) {
    return { error: (e as { message?: string })?.message || 'Try again.' }
  }
}
