// src/lib/labor.ts
//
// Crew labor cost per job, computed from completed fh_time_punches.
//
// Two clock systems feed job cost without overlapping:
//   • The owner's job-screen TimeClockCard writes BOTH a punch row and
//     an fh_expenses row (category='Labor') — its cost already flows
//     through expenses, so its punches must NOT be counted again here.
//   • Crew members clock in via Crew Home, which writes ONLY a punch
//     row — before this module, that time never reached job cost.
//
// The split: count punches whose user_id differs from the job owner's.
// (Known small hole: the owner clocking via Crew Home is skipped too —
// acceptable; their habit path is the job-screen clock.)
//
// Approval note: completed punches count whether or not a manager has
// approved them yet — the owner wants margin truth same-day. If
// approval becomes the gate, filter on approved_at here.

// Lazy client import: punchHours is pure and unit-tested; a top-level
// supabase import would construct the client (and demand env vars) the
// moment the test file loads.
async function db() {
  const { supabase } = await import('./supabase.ts')
  return supabase
}

export type CrewLabor = {
  cost: number        // Σ hours × hourly_rate over rated punches
  hours: number       // Σ hours over ALL completed crew punches
  unratedHours: number // hours on punches with no hourly_rate (excluded from cost)
  punches: number
}

export function punchHours(p: {
  punch_in_at: string
  punch_out_at: string | null
  break_minutes?: number | null
}): number {
  if (!p.punch_out_at) return 0
  const ms = new Date(p.punch_out_at).getTime() - new Date(p.punch_in_at).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return 0
  const hrs = ms / 3_600_000 - Number(p.break_minutes || 0) / 60
  return Math.max(0, hrs)
}

export async function crewLaborForContact(
  contactId: string | undefined,
  ownerUserId: string | undefined
): Promise<CrewLabor> {
  const empty: CrewLabor = { cost: 0, hours: 0, unratedHours: 0, punches: 0 }
  if (!contactId || !ownerUserId) return empty
  const supabase = await db()
  const { data, error } = await supabase
    .from('fh_time_punches')
    .select('user_id, punch_in_at, punch_out_at, break_minutes, hourly_rate')
    .eq('contact_id', contactId)
    .not('punch_out_at', 'is', null)
    .neq('user_id', ownerUserId)
  if (error || !data) return empty
  const out = { ...empty }
  for (const p of data as any[]) {
    const hrs = punchHours(p)
    if (hrs <= 0) continue
    out.punches += 1
    out.hours += hrs
    const rate = Number(p.hourly_rate)
    if (Number.isFinite(rate) && rate > 0) out.cost += hrs * rate
    else out.unratedHours += hrs
  }
  out.cost = Math.round(out.cost * 100) / 100
  return out
}
