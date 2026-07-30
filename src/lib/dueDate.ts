// Due-date helpers for fh_job_todos.due_at (migration 010).
//
// fh_job_todos.due_at is timestamptz. The operator's mental model is a
// calendar date in their local timezone, "due May 1" means "by end
// of day May 1 wherever I am". We bridge HTML5 <input type="date">
// (date-only string) ↔ timestamptz by anchoring to local end-of-day.
//
// Status buckets (overdue / today / future) compute against local-day
// boundaries so the chip flips at midnight in the operator's timezone,
// not at UTC midnight.

/**
 * Convert a year month day input value to an ISO timestamptz at the
 * operator's local end-of-day. Returns null for empty input.
 */
export function dateInputToTimestamp(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  const parts = String(dateStr).split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null
  const [y, m, d] = parts
  // Local-timezone constructor, end of day in operator's TZ.
  const local = new Date(y, m - 1, d, 23, 59, 59, 999)
  return local.toISOString()
}

/**
 * Convert an ISO timestamp back to a year month day string for an
 * <input type="date"> value. Returns '' when iso is null/undefined
 * so the input renders empty.
 */
export function timestampToDateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Resolve a due timestamp into a chip-ready status object.
 *
 *   { label: 'Overdue',    tone: 'danger' }  , due day < today
 *   { label: 'Today',      tone: 'warn'   }  , due day === today
 *   { label: 'Apr 30',     tone: 'muted'  }  , due day > today
 *   null                                      , no due_at
 *
 * "Day" comparisons strip time-of-day so a 23:59:59 end-of-day
 * timestamp doesn't get misclassified as overdue at 11:59pm.
 */
export function dueStatus(iso: string | null | undefined): { label: string; tone: string } | null {
  if (!iso) return null
  const due = new Date(iso)
  if (Number.isNaN(due.getTime())) return null
  const now = new Date()
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (dueDay < today) return { label: 'Overdue', tone: 'danger' }
  if (dueDay === today) return { label: 'Today', tone: 'warn' }
  return {
    label: due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    tone: 'muted'
  }
}
