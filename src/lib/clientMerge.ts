// src/lib/clientMerge.ts
//
// Duplicate detection + merge transaction for fh_clients. Clients are
// considered a possible duplicate when their normalized phone matches
// (digits-only, ignoring leading "1") OR their normalized email matches
// (lowercased + trimmed). Names alone are too noisy, two different
// John Smiths could legitimately exist; two clients sharing the same
// phone almost certainly should not.
//
// Merge rules (planClientMerge): the survivor inherits any field where it
// is currently null/empty and the loser has a value; every loser's notes
// are appended to the survivor's, and a loser phone or email that differs
// from the survivor's is written into the notes, so nothing the operator
// typed is lost when the loser row is deleted. Then every row that points
// at a loser (jobs, statement links, selections) is repointed at the
// survivor, and finally the loser rows are deleted. The
// fh_clients_aggregate trigger on fh_contacts recomputes the survivor's
// active/lifetime aggregates, we don't have to call recompute manually.
//
// Rows are matched by id only: RLS scopes fh_clients and everything that
// points at it to the caller's company, so a teammate's client merges
// like the caller's own (a user_id filter made those merges silently do
// nothing).
//
// The operator can tell the sheet that flagged clients are different
// people. Those pairs are remembered on this device (see
// rememberNotDuplicates) and findDuplicateClusters stops linking them.

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

// Key for a pair of client ids, the same whichever order they come in.
export function clientPairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

// Group an array of client rows into duplicate clusters. A cluster is
// returned only when it contains 2+ rows and they share at least one of
// (normalized phone, normalized email). Each row may belong to at most
// one cluster, first match wins. Output is sorted with the largest
// clusters first so the UI lists the biggest cleanups at the top.
// `notDuplicates` holds clientPairKey pairs the operator marked as
// different people; a shared phone or email no longer links those two.
export function findDuplicateClusters(
  clients: Client[],
  notDuplicates: ReadonlySet<string> = new Set()
): DuplicateCluster[] {
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
  // Every pair that shares the value is linked, except pairs marked as
  // different people (linking each row to the first one only would let a
  // marked pair through, or split a group around it).
  function linkAll(arr: Client[]) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        if (!notDuplicates.has(clientPairKey(arr[i].id, arr[j].id))) union(arr[i].id, arr[j].id)
      }
    }
  }
  for (const arr of phoneIndex.values()) linkAll(arr)
  for (const arr of emailIndex.values()) linkAll(arr)

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

// "Not duplicates" pairs, kept per user on this device. A shared office
// phone or a family email can make two different clients look alike, and
// without this the banner could only be cleared by merging them.
const NOT_DUPLICATES_KEY = 'fh:clientsNotDuplicates:'

export function loadNotDuplicates(userId: string | undefined): Set<string> {
  if (!userId) return new Set()
  try {
    const raw = localStorage.getItem(NOT_DUPLICATES_KEY + userId)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [])
  } catch {
    return new Set()
  }
}

// Add pairs ([idA, idB]) to the current set, save it and return it. The
// returned set keeps working for the session when storage is blocked.
export function rememberNotDuplicates(
  userId: string | undefined,
  current: ReadonlySet<string>,
  pairs: Array<[string, string]>
): Set<string> {
  const next = new Set([...loadNotDuplicates(userId), ...current])
  for (const [a, b] of pairs) next.add(clientPairKey(a, b))
  if (userId) {
    try { localStorage.setItem(NOT_DUPLICATES_KEY + userId, JSON.stringify([...next])) } catch { /* storage blocked */ }
  }
  return next
}

// Field-merge policy. Survivor wins on every field except where it is
// null/empty AND the loser has a value, in which case the loser's value
// fills it in. We never overwrite a non-empty survivor field. Notes are
// the exception (see planClientMerge): they are combined, never dropped.
const FILL_FIELDS = ['company_name', 'phone', 'email', 'address'] as const

type MergePatch = Partial<Pick<Client, 'company_name' | 'phone' | 'email' | 'address' | 'notes'>>

function pickMergedValue(survivorVal: unknown, loserVal: unknown) {
  const sHas = survivorVal !== null && survivorVal !== undefined && String(survivorVal).trim() !== ''
  const lHas = loserVal !== null && loserVal !== undefined && String(loserVal).trim() !== ''
  if (sHas) return survivorVal
  if (lHas) return loserVal
  return null
}

function byCreatedAt(a: Client, b: Client) {
  const da = a.created_at ? new Date(a.created_at).getTime() : 0
  const db = b.created_at ? new Date(b.created_at).getTime() : 0
  return da - db
}

// The update to apply to the survivor before the losers are deleted.
// Blank fields fill from the losers, oldest first, so a hand-edited
// address on the original beats a newer auto-imported duplicate. Every
// loser note is appended to the survivor's notes, followed by any loser
// phone or email that differs from the one the survivor keeps. Text the
// survivor's notes already contain is skipped, so running the merge again
// after a partial failure doesn't repeat it.
export function planClientMerge(survivor: Client, losers: Client[]): MergePatch {
  const ordered = [...losers].sort(byCreatedAt)
  const patch: MergePatch = {}
  for (const f of FILL_FIELDS) {
    let val: unknown = survivor[f]
    for (const l of ordered) val = pickMergedValue(val, l[f])
    if (val !== survivor[f] && val !== null) patch[f] = val as string
  }

  const baseNotes = (survivor.notes || '').trim()
  const added: string[] = []
  const alreadyThere = (text: string) => baseNotes.includes(text) || added.some((block) => block.includes(text))
  for (const l of ordered) {
    const note = (l.notes || '').trim()
    if (note && !alreadyThere(note)) added.push(note)
  }

  const keptPhones = new Set([normPhone(patch.phone ?? survivor.phone)])
  const keptEmails = new Set([normEmail(patch.email ?? survivor.email)])
  const contactLines: string[] = []
  for (const l of ordered) {
    const phone = normPhone(l.phone)
    if (phone && !keptPhones.has(phone)) {
      keptPhones.add(phone)
      const line = `Other phone: ${String(l.phone).trim()}`
      if (!alreadyThere(line)) contactLines.push(line)
    }
    const email = normEmail(l.email)
    if (email && !keptEmails.has(email)) {
      keptEmails.add(email)
      const line = `Other email: ${String(l.email).trim()}`
      if (!alreadyThere(line)) contactLines.push(line)
    }
  }
  if (contactLines.length) added.push(contactLines.join('\n'))

  if (added.length) patch.notes = [baseNotes, ...added].filter(Boolean).join('\n\n')
  return patch
}

// Run a merge. `survivor` is the client row that stays; `losers` is the
// array of client rows that will be absorbed and deleted. Returns
// { reassigned, deletedCount, patch } on success or throws on failure.
//
// The steps run as separate requests, ordered so a failure part way
// leaves nothing lost: the survivor takes the losers' details first, then
// everything pointing at a loser moves, and the losers are deleted last.
// Running the merge again finishes the job.
export async function mergeClients({ userId, survivor, losers }: { userId: string | undefined; survivor: Client; losers: Client[] }) {
  if (!userId) throw new Error('mergeClients: userId required')
  if (!survivor?.id) throw new Error('mergeClients: survivor required')
  if (!Array.isArray(losers) || losers.length === 0) throw new Error('mergeClients: at least one loser required')

  const absorbed = losers.filter((l) => l?.id && l.id !== survivor.id)
  const loserIds = absorbed.map((l) => l.id)
  if (loserIds.length === 0) return { reassigned: 0, deletedCount: 0, patch: {} }

  // 1) Copy what the losers know onto the survivor.
  const patch = planClientMerge(survivor, absorbed)
  if (Object.keys(patch).length > 0) {
    const { data: updated, error: upErr } = await supabase
      .from('fh_clients')
      .update(patch)
      .eq('id', survivor.id)
      .select('id')
    if (upErr) throw upErr
    if (!updated?.length) throw new Error("Couldn't update the client you're keeping. Refresh and try again.")
  }

  // 2) Reassign every job pointing at a loser. The fh_clients_aggregate
  // trigger fires per row and recomputes both the old and new client.
  const { data: reassigned, error: reErr } = await supabase
    .from('fh_contacts')
    .update({ client_id: survivor.id })
    .in('client_id', loserIds)
    .select('id')
  if (reErr) throw reErr

  // 3) Statement links cascade when their client is deleted, so a link
  // already sent to the customer would start returning not found.
  const { error: linkErr } = await supabase
    .from('fh_public_links')
    .update({ client_id: survivor.id })
    .in('client_id', loserIds)
  if (linkErr) throw linkErr

  // 4) Selections would lose their client (on delete set null).
  const { error: selErr } = await supabase
    .from('fh_selections')
    .update({ client_id: survivor.id })
    .in('client_id', loserIds)
  if (selErr) throw selErr

  // 5) Delete the loser rows.
  const { data: deleted, error: delErr } = await supabase
    .from('fh_clients')
    .delete()
    .in('id', loserIds)
    .select('id')
  if (delErr) throw delErr
  if (!deleted?.length) throw new Error("Couldn't remove the duplicate records. Refresh and try again.")

  return {
    reassigned: (reassigned || []).length,
    deletedCount: deleted.length,
    patch
  }
}
