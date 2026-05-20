import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase.js'

/**
 * Account attribution — resolve a set of user_ids into display labels
 * via the fh_resolve_account_labels RPC (migration 016).
 *
 * The RPC enforces its own auth gate (caller must be self, the inviter,
 * or an accepted partner of each requested user). Anything outside that
 * scope simply returns no row, and the consumer falls back to "Unknown
 * account".
 *
 * The cache is module-level on purpose: multiple components on the same
 * Job Detail screen (Messages section + Overview activity feed) ask for
 * overlapping user_ids; sharing the cache means at most one RPC call
 * per unique user_id per session.
 */
export type AccountLabel = { label: string; role: string }

const labelCache = new Map<string, AccountLabel>() // user_id -> { label, role }
const inflight = new Map<string, Promise<void>>()   // user_id -> in-flight resolve

async function resolveBatch(missing: string[]) {
  if (missing.length === 0) return
  const { data, error } = await supabase.rpc('fh_resolve_account_labels', {
    p_user_ids: missing
  })
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[accountAttribution] resolve failed', error)
    // Don't poison the cache on error — just leave the user_ids unresolved.
    return
  }
  const got = new Set<string>()
  for (const row of (data || []) as Array<{ user_id: string; label: string; role: string }>) {
    labelCache.set(row.user_id, { label: row.label, role: row.role })
    got.add(row.user_id)
  }
  // Anything we asked for and didn't get back is genuinely unreachable
  // for this caller — cache the negative result so we don't keep asking.
  for (const uid of missing) {
    if (!got.has(uid)) {
      labelCache.set(uid, { label: 'Unknown account', role: 'unknown' })
    }
  }
}

/**
 * useAccountLabels — pass an iterable of user_ids, get back a Map<user_id,
 * { label, role }>. Returns whatever's already cached on first render and
 * fills in the rest async. Stable Map reference between renders when
 * nothing has changed.
 */
export function useAccountLabels(userIds: Iterable<string | null | undefined> | null | undefined) {
  // Stable, deduped, sorted key for the dependency array.
  const idsKey = useMemo(() => {
    const set = new Set()
    for (const id of userIds || []) {
      if (id) set.add(String(id))
    }
    return Array.from(set).sort().join(',')
  }, [userIds])

  const [, force] = useState(0)

  useEffect(() => {
    if (!idsKey) return
    const ids = idsKey.split(',').filter(Boolean)
    const missing = ids.filter((id) => !labelCache.has(id) && !inflight.has(id))
    if (missing.length === 0) return
    let cancelled = false
    const promise = resolveBatch(missing).finally(() => {
      for (const id of missing) inflight.delete(id)
    })
    for (const id of missing) inflight.set(id, promise)
    promise.then(() => {
      if (cancelled) return
      // Bump local state so consumers re-render with the resolved labels.
      force((n) => n + 1)
    })
    return () => { cancelled = true }
  }, [idsKey])

  // Return a Map of currently-known labels. Unresolved ids will simply be
  // missing from the Map; the consumer renders a fallback for those.
  return useMemo(() => {
    const out = new Map<string, AccountLabel>()
    if (!idsKey) return out
    for (const id of idsKey.split(',').filter(Boolean)) {
      const hit = labelCache.get(id)
      if (hit) out.set(id, hit)
    }
    return out
  }, [idsKey])
}

/**
 * Format a single attribution into "Posted by X" / "Added by X" /
 * "Created by X" with optional role suffix when context calls for it.
 *
 * verb: 'posted' | 'added' | 'created'  (default 'posted')
 * showRole: boolean — append " · Partner" or " · Owner" when not self
 */
export function formatAttribution(entry: AccountLabel | null | undefined, verb = 'posted', showRole = false) {
  const v = verb === 'added' ? 'Added by' : verb === 'created' ? 'Created by' : 'Posted by'
  // Friendlier fallback when the label RPC can't resolve a name. The
  // prior "someone on this job" read as alarming/stub-y in the 5/13
  // audit; "a teammate" implies an account member without claiming
  // their identity.
  if (!entry) return `${v} a teammate`
  if (entry.role === 'self') return `${v} you`
  const roleSuffix = showRole && entry.role && entry.role !== 'unknown'
    ? ` · ${entry.role.charAt(0).toUpperCase()}${entry.role.slice(1)}`
    : ''
  return `${v} ${entry.label}${roleSuffix}`
}
