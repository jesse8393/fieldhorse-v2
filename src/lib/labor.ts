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

import { supabase } from './supabase.ts'

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
  const { data, error } = await supabase
    .from('fh_time_punches')
    .select('user_id, org_id, punch_in_at, punch_out_at, break_minutes, hourly_rate')
    .eq('contact_id', contactId)
    .not('punch_out_at', 'is', null)
    .neq('user_id', ownerUserId)
  if (error || !data) return empty

  // The punches all belong to one org (the contact's). Scope the rate
  // lookup to that org so a member who also belongs to another org
  // can't have their other-org rate bleed in.
  const punchOrgId = (data as any[]).find((p) => p.org_id)?.org_id || null

  // Resolve owner-set per-member rates for punches that carry no snapshot
  // rate of their own. This is what turns crew labor from $0 into real cost:
  // the crew clock writes no rate, so we fall back to the member's configured
  // default_hourly_rate (org_members). A punch's own hourly_rate still wins
  // when present (it's the rate as of that shift).
  const needRateFor = Array.from(new Set(
    (data as any[])
      .filter((p) => !(Number(p.hourly_rate) > 0))
      .map((p) => p.user_id)
      .filter(Boolean)
  ))
  const memberRate: Record<string, number> = {}
  if (needRateFor.length) {
    let q = (supabase.from('org_members') as any)
      .select('user_id, default_hourly_rate')
      .in('user_id', needRateFor)
      // Skip revoked memberships — a stale rate from a since-removed
      // membership row must not overwrite the active one.
      .is('revoked_at', null)
    if (punchOrgId) q = q.eq('org_id', punchOrgId)
    const { data: members } = await q
    for (const m of (members || []) as any[]) {
      const r = Number(m.default_hourly_rate)
      // Deterministic when >1 row still matches: keep the highest active
      // rate rather than whichever row arrived last.
      if (Number.isFinite(r) && r > 0 && r > (memberRate[m.user_id] || 0)) {
        memberRate[m.user_id] = r
      }
    }
  }

  const out = { ...empty }
  for (const p of data as any[]) {
    const hrs = punchHours(p)
    if (hrs <= 0) continue
    out.punches += 1
    out.hours += hrs
    let rate = Number(p.hourly_rate)
    if (!(Number.isFinite(rate) && rate > 0)) rate = memberRate[p.user_id] || 0
    if (rate > 0) out.cost += hrs * rate
    else out.unratedHours += hrs
  }
  out.cost = Math.round(out.cost * 100) / 100
  return out
}
