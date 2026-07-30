// src/lib/clientMerge.ts
//
// Duplicate detection + merge transaction for fh_clients. Clients are
// considered a possible duplicate when their normalized phone matches
// (digits-only, ignoring leading "1") OR their normalized email matches
// (lowercased + trimmed). Names alone are too noisy, two different
// John Smiths could legitimately exist; two clients sharing the same
// phone almost certainly should not.
//
// Merge rules: the survivor inherits any field where it is currently
// null/empty and the loser has a value. Then every fh_contacts.client_id
// pointing at the loser is rewritten to point at the survivor. Finally
// the loser row is deleted. The fh_clients_aggregate trigger on
// fh_contacts then auto-recomputes the survivor's active/lifetime
// aggregates, we don't have to call recompute manually.
//
// Single user_id check protects against cross-tenant merges. Caller
// must pass the authed user_id; we trust no client-supplied ids.

import { supabase } from './supabase.ts'
import type { Database } from './database.types.ts'

type Client = Database['public']['Tables']['fh_clients']['Row']

export type DuplicateCluster = {
  key: string
  members: Client[]
  matchedOn: string[]
}

function normPhone(v: string | null | undefined) {
  if (!v) return ''
  const digits = String(v).replace(/\D/g, '')
  if (!digits) return ''
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

function normEmail(v: string | null | undefined) {
  if (!v) return ''
  return String(v).trim().toLowerCase()
}

// Group an array of client rows into duplicate clusters. A cluster is
// returned only when it contains 2+ rows and they share at least one of
// (normalized phone, normalized email). Each row may belong to at most
// one cluster, first match wins. Output is sorted with the largest
// clusters first so the UI lists the biggest cleanups at the top.
export function findDuplicateClusters(clients: Client[]): DuplicateCluster[] {
  if (!Array.isArray(clients) || clients.length < 2) return []

  const phoneIndex = new Map<string, Client[]>()
  const emailIndex = new Map<string, Client[]>()
  for (const c of clients) {
    const p = normPhone(c.phone)
    if (p) {
      if (!phoneIndex.has(p)) phoneIndex.set(p, [])
      phoneIndex.get(p)!.push(c)
    }
    const e = normEmail(c.email)
    if (e) {
      if (!emailIndex.has(e)) emailIndex.set(e, [])
      emailIndex.get(e)!.push(c)
    }
  }

  // Union-find over client ids so a phone match + email match that span
  // three rows collapse into a single cluster.
  const parent = new Map<string, string>(clients.map((c) => [c.id, c.id]))
  function find(x: string): string {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!)
      x = parent.get(x)!
    }
    return x
  }
  function union(a: string, b: string) {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const arr of phoneIndex.values()) {
    if (arr.length > 1) for (let i = 1; i < arr.length; i++) union(arr[0].id, arr[i].id)
  }
  for (const arr of emailIndex.values()) {
    if (arr.length > 1) for (let i = 1; i < arr.length; i++) union(arr[0].id, arr[i].id)
  }

  const groups = new Map<string, Client[]>()
  for (const c of clients) {
    const root = find(c.id)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(c)
  }

  const out: DuplicateCluster[] = []
  for (const arr of groups.values()) {
    if (arr.length < 2) continue
    const matchedOn: string[] = []
    const phones = new Set(arr.map((c) => normPhone(c.phone)).filter(Boolean))
    const emails = new Set(arr.map((c) => normEmail(c.email)).filter(Boolean))
    if (phones.size > 0 && [...phoneIndex.values()].some((g) => g.length > 1 && g.every((c) => arr.includes(c)))) {
      matchedOn.push('phone')
    } else if (phones.size === 1 && arr.every((c) => normPhone(c.phone) === [...phones][0])) {
      matchedOn.push('phone')
    }
    if (emails.size === 1 && arr.every((c) => normEmail(c.email) === [...emails][0])) {
      matchedOn.push('email')
    }
    out.push({
      key: arr.map((c) => c.id).sort().join('|'),
      members: arr,
      matchedOn
    })
  }

  out.sort((a, b) => b.members.length - a.members.length)
  return out
}

// Field-merge policy. Survivor wins on every field except where it is
// null/empty AND the loser has a value, in which case the loser's value
// fills it in. We never overwrite a non-empty survivor field.
const MERGEABLE_FIELDS = ['company_name', 'phone', 'email', 'address', 'notes'] as const

function pickMergedValue(survivorVal: unknown, loserVal: unknown) {
  const sHas = survivorVal !== null && survivorVal !== undefined && String(survivorVal).trim() !== ''
  const lHas = loserVal !== null && loserVal !== undefined && String(loserVal).trim() !== ''
  if (sHas) return survivorVal
  if (lHas) return loserVal
  return null
}

// Run a merge. `survivor` is the client row that stays; `losers` is the
// array of client rows that will be absorbed and deleted. Returns
// { reassigned, deletedCount, patch } on success or throws on failure.
export async function mergeClients({ userId, survivor, losers }: { userId: string | undefined; survivor: Client; losers: Client[] }) {
  if (!userId) throw new Error('mergeClients: userId required')
  if (!survivor?.id) throw new Error('mergeClients: survivor required')
  if (!Array.isArray(losers) || losers.length === 0) throw new Error('mergeClients: at least one loser required')

  const loserIds = losers.map((l) => l.id).filter((id) => id && id !== survivor.id)
  if (loserIds.length === 0) return { reassigned: 0, deletedCount: 0, patch: {} }

  // 1) Reassign every contact pointing at a loser. The fh_clients_aggregate
  // trigger fires per row and recomputes both the old and new client.
  const { data: reassigned, error: reErr } = await supabase
    .from('fh_contacts')
    .update({ client_id: survivor.id })
    .in('client_id', loserIds)
    .eq('user_id', userId)
    .select('id')
  if (reErr) throw reErr

  // 2) Build the survivor patch, fill blanks from losers, oldest-first
  // so a hand-edited address on the original beats a newer auto-imported
  // duplicate.
  const ordered = [...losers].sort((a, b) => {
    const da = a.created_at ? new Date(a.created_at).getTime() : 0
    const db = b.created_at ? new Date(b.created_at).getTime() : 0
    return da - db
  })
  const patch: Record<string, unknown> = {}
  for (const f of MERGEABLE_FIELDS) {
    let val: unknown = survivor[f]
    for (const l of ordered) val = pickMergedValue(val, l[f])
    if (val !== survivor[f] && val !== null) patch[f] = val
  }
  if (Object.keys(patch).length > 0) {
    const { error: upErr } = await supabase
      .from('fh_clients')
      .update(patch as Database['public']['Tables']['fh_clients']['Update'])
      .eq('id', survivor.id)
      .eq('user_id', userId)
    if (upErr) throw upErr
  }

  // 3) Delete the loser rows. RLS + explicit user_id keeps this from
  // ever reaching another tenant.
  const { error: delErr } = await supabase
    .from('fh_clients')
    .delete()
    .in('id', loserIds)
    .eq('user_id', userId)
  if (delErr) throw delErr

  return {
    reassigned: (reassigned || []).length,
    deletedCount: loserIds.length,
    patch
  }
}
