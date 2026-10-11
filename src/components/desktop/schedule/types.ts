// The shape of a schedule row as the Schedule screen hands it to the
// desktop board: a fh_schedule row with its job's name and stage joined
// in. Loose on purpose, the screen passes rows straight from the query.
export type BoardEvent = {
  id: string
  title?: string | null
  start_at?: string | null
  end_at?: string | null
  contact_id?: string | null
  assigned_to?: string | null
  fh_contacts?: { name?: string | null; stage?: string | null } | null
}

export type BoardView = 'day' | 'week' | 'month'

/** Pixels per hour on the board. */
export const HOUR_PX = 60
