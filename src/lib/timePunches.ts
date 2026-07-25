// timePunches — DB-backed time tracking.
//
// Replaces the localStorage-only model in TimeClockCard. The DB is
// the source of truth (multi-device safe via the unique-index on
// open punches), but we still cache the active punch id in
// localStorage so the running-meter doesn't flicker on a fast
// refresh.
//
// Geolocation is optional and best-effort. We pass undefined coords
// rather than blocking the punch if the browser refuses.

import { supabase } from './supabase.ts'

export type TimePunch = {
  id: string
  user_id: string
  org_id: string | null
  contact_id: string | null
  punch_in_at: string
  punch_out_at: string | null
  punch_in_lat: number | null
  punch_in_lon: number | null
  punch_in_accuracy_m: number | null
  punch_out_lat: number | null
  punch_out_lon: number | null
  punch_out_accuracy_m: number | null
  hourly_rate: number | null
  break_minutes: number
  notes: string | null
  flagged: boolean
  flag_reason: string | null
  approved_at: string | null
  approved_by: string | null
  created_at: string
  updated_at: string
}

const ACTIVE_CACHE_KEY = 'fh:timepunch:activeId'

function rememberActive(id: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (id) window.localStorage.setItem(ACTIVE_CACHE_KEY, id)
    else    window.localStorage.removeItem(ACTIVE_CACHE_KEY)
  } catch {}
}

/** Best-effort geolocation. Resolves with nulls if the browser
 *  refuses or geolocation isn't available — never rejects. */
async function tryGeolocate(): Promise<{ lat: number | null; lon: number | null; acc: number | null }> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return { lat: null, lon: null, acc: null }
  }
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve({ lat: null, lon: null, acc: null }), 4000)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(timer)
        resolve({
          lat: pos.coords.latitude ?? null,
          lon: pos.coords.longitude ?? null,
          acc: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        })
      },
      () => {
        window.clearTimeout(timer)
        resolve({ lat: null, lon: null, acc: null })
      },
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 60_000 },
    )
  })
}

/** Fetch the caller's active (un-clocked-out) punch, if any.
 *  Used to restore meter state on page load. */
export async function getActivePunch(userId: string): Promise<TimePunch | null> {
  const { data, error } = await supabase
    .from('fh_time_punches')
    .select('*')
    .eq('user_id', userId)
    .is('punch_out_at', null)
    .order('punch_in_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.warn('[timePunches] active fetch error', error)
    return null
  }
  if (data) rememberActive(data.id)
  return (data as TimePunch | null) ?? null
}

/** Per-job active punch lookup — used by TimeClockCard so the meter
 *  only restores when the active punch belongs to the job you're
 *  looking at. Returns null if the active punch is on a different job
 *  (the UI should treat that as "not clocked in here"). */
export async function getActivePunchForContact(
  userId: string,
  contactId: string,
): Promise<TimePunch | null> {
  const { data, error } = await supabase
    .from('fh_time_punches')
    .select('*')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .is('punch_out_at', null)
    .order('punch_in_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.warn('[timePunches] active-for-contact fetch error', error)
    return null
  }
  return (data as TimePunch | null) ?? null
}

/** Punch in. Inserts a new row with punch_in_at = now(). org_id is
 *  filled in by the BEFORE INSERT trigger from migration 035.
 *
 *  Open-punch guard: if the caller already has an un-clocked-out punch
 *  on the SAME job (double-tap, second tab, stale UI), return THAT
 *  punch instead of inserting a second one — two open punches later
 *  double-count labor hours in job cost. An open punch on a DIFFERENT
 *  job must NOT be returned (ultrareview x5: doing so mis-attributed
 *  Job A's hours to Job B's cost) — fall through to the insert and let
 *  the one-active-per-user unique index reject it, which drives the
 *  callers' existing "Already on the clock" error paths. */
export async function punchIn(opts: {
  userId: string
  contactId?: string | null
}): Promise<TimePunch> {
  const existing = await getActivePunch(opts.userId)
  if (existing && (existing.contact_id ?? null) === (opts.contactId ?? null)) {
    return existing
  }
  const { lat, lon, acc } = await tryGeolocate()
  const { data, error } = await supabase
    .from('fh_time_punches')
    .insert({
      user_id: opts.userId,
      contact_id: opts.contactId ?? null,
      punch_in_at: new Date().toISOString(),
      punch_in_lat: lat,
      punch_in_lon: lon,
      punch_in_accuracy_m: acc,
    })
    .select('*')
    .single()
  if (error) throw error
  rememberActive((data as TimePunch).id)
  return data as TimePunch
}

/** Punch out the active row. Optional hourly_rate snapshot + notes. */
export async function punchOut(opts: {
  punchId: string
  hourlyRate?: number | null
  notes?: string | null
  breakMinutes?: number | null
}): Promise<TimePunch> {
  const { lat, lon, acc } = await tryGeolocate()
  const patch: {
    punch_out_at: string
    punch_out_lat: number | null
    punch_out_lon: number | null
    punch_out_accuracy_m: number | null
    hourly_rate?: number
    notes?: string
    break_minutes?: number
  } = {
    punch_out_at: new Date().toISOString(),
    punch_out_lat: lat,
    punch_out_lon: lon,
    punch_out_accuracy_m: acc,
  }
  if (opts.hourlyRate != null) patch.hourly_rate = opts.hourlyRate
  if (opts.notes != null)       patch.notes = opts.notes
  if (opts.breakMinutes != null) patch.break_minutes = opts.breakMinutes
  const { data, error } = await supabase
    .from('fh_time_punches')
    .update(patch)
    .eq('id', opts.punchId)
    .select('*')
    .single()
  if (error) throw error
  rememberActive(null)
  return data as TimePunch
}

/** The caller's own default hourly rate (org_members self-read row).
 *  Used to snapshot the rate onto a punch at clock-out so historical
 *  shifts keep pricing at the rate that was in effect when they were
 *  worked — without a snapshot, a later raise silently repriced every
 *  past (even approved) shift on every job. Best-effort: returns null
 *  when no membership/rate exists. When the caller belongs to several
 *  orgs, prefers the membership matching orgId. */
export async function fetchMyDefaultRate(userId: string, orgId?: string | null): Promise<number | null> {
  // database.types.ts predates migration 057's default_hourly_rate
  // column — same `as any` cast lib/labor.ts uses for this table.
  const { data, error } = await (supabase.from('org_members') as any)
    .select('org_id, default_hourly_rate')
    .eq('user_id', userId)
    .is('revoked_at', null)
  if (error || !data?.length) return null
  const rows = data as { org_id: string | null; default_hourly_rate: number | null }[]
  const match = (orgId && rows.find((r) => r.org_id === orgId)) || rows[0]
  const rate = Number(match?.default_hourly_rate)
  return Number.isFinite(rate) && rate > 0 ? rate : null
}

/** List the caller's recent punches (newest first). */
export async function listMyRecentPunches(
  userId: string,
  limit = 14,
): Promise<TimePunch[]> {
  const { data, error } = await supabase
    .from('fh_time_punches')
    .select('*')
    .eq('user_id', userId)
    .order('punch_in_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.warn('[timePunches] list error', error)
    return []
  }
  return (data || []) as TimePunch[]
}

/** Compute total worked minutes (clamped to non-negative, excluding
 *  break_minutes). For a still-active punch, treats now() as the
 *  punch-out time. */
export function workedMinutes(p: TimePunch, nowMs = Date.now()): number {
  if (!p.punch_in_at) return 0
  const inMs  = new Date(p.punch_in_at).getTime()
  const outMs = p.punch_out_at ? new Date(p.punch_out_at).getTime() : nowMs
  const raw   = Math.max(0, Math.round((outMs - inMs) / 60_000))
  return Math.max(0, raw - (p.break_minutes || 0))
}
