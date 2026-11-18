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
// at a loser is moved to the survivor (CLIENT_REFERENCES lists every table
// with a foreign key to fh_clients). Leads and quotes are deleted with
// their client and invoices lose it, so nothing may still point at a loser
// when it is deleted: the merge reads every one of those tables first and
// stops if anything is left. The fh_clients_aggregate trigger on
// fh_contacts recomputes the survivor's active/lifetime aggregates, we
// don't have to call recompute manually.
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

// Every table with a foreign key to fh_clients, with the words the screen
// uses for its rows. src/lib/clientMerge.test.ts checks this against the
// generated types and every migration, so a new reference cannot be missed.
// `byKey` tables hold at most one row per client and key (tags, consent,
// the conversation thread). The database merge folds those into the
// survivor's rows, and what stays on the duplicate is a copy of a row the
// survivor already has.
type TableName = keyof Database['public']['Tables']

export const CLIENT_REFERENCES: ReadonlyArray<{ table: TableName; label: string; byKey?: boolean }> = [
  { table: 'fh_contacts', label: 'jobs' },
  { table: 'fh_leads', label: 'leads' },
  { table: 'fh_quotes', label: 'quotes' },
  { table: 'fh_invoices', label: 'invoices' },
  { table: 'fh_follow_ups', label: 'follow ups' },
  { table: 'fh_public_links', label: 'statement links' },
  { table: 'fh_selections', label: 'selections' },
  { table: 'fh_appointments', label: 'appointments' },
  { table: 'fh_reviews', label: 'reviews' },
  { table: 'fh_review_requests', label: 'review requests' },
  { table: 'fh_messages', label: 'messages' },
  { table: 'fh_conversations', label: 'a conversation', byKey: true },
  { table: 'fh_events', label: 'activity history' },
  { table: 'fh_outbox', label: 'queued messages' },
  { table: 'fh_agent_runs', label: 'assistant drafts' },
  { table: 'fh_workflow_runs', label: 'automations' },
  { table: 'fh_form_submissions', label: 'form submissions' },
  { table: 'fh_campaign_recipients', label: 'campaigns', byKey: true },
  { table: 'fh_client_tags', label: 'tags', byKey: true },
  { table: 'fh_client_fields', label: 'custom fields', byKey: true },
  { table: 'fh_consent', label: 'contact preferences', byKey: true },
  { table: 'fh_client_attribution', label: 'lead source details', byKey: true }
]

// The tables the app itself moves when the database merge is not installed.
// The rest (messages, tags, automations) need the database merge; a
// duplicate that has any of them is left in place until it is installed.
export const MOVED_BY_APP = [
  'fh_contacts', 'fh_leads', 'fh_quotes', 'fh_invoices', 'fh_follow_ups', 'fh_public_links', 'fh_selections'
] as const

const MERGE_FUNCTION = 'fh_merge_client_into'

type Moved = { jobs: number; leads: number; quotes: number; invoices: number }

function functionMissing(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  return error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message || '')
}

function joinWords(words: string[]) {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

// Run a merge. `survivor` is the client row that stays; `losers` is the
// array of client rows that will be absorbed and deleted. Returns
// { reassigned, moved, deletedCount, patch } on success or throws a
// sentence the screen can show.
//
// The steps run in this order so a failure part way leaves nothing lost:
// the survivor takes the losers' details first, then everything pointing
// at a loser moves (in one database transaction when fh_merge_client_into
// is installed, and by the app's own updates either way), then every
// table that points at a client is read, and the losers are deleted only
// when nothing points at them. Running the merge again finishes the job.
export async function mergeClients({ userId, survivor, losers }: { userId: string | undefined; survivor: Client; losers: Client[] }) {
  if (!userId) throw new Error('mergeClients: userId required')
  if (!survivor?.id) throw new Error('mergeClients: survivor required')
  if (!Array.isArray(losers) || losers.length === 0) throw new Error('mergeClients: at least one loser required')

  const absorbed = losers.filter((l) => l?.id && l.id !== survivor.id)
  const loserIds = absorbed.map((l) => l.id)
  const moved: Moved = { jobs: 0, leads: 0, quotes: 0, invoices: 0 }
  if (loserIds.length === 0) return { reassigned: 0, moved, deletedCount: 0, patch: {} }

  // 1) Copy what the losers know onto the survivor.
  const patch = planClientMerge(survivor, absorbed)
  if (Object.keys(patch).length > 0) {
    const { data: updated, error: upErr } = await supabase
      .from('fh_clients')
      .update(patch)
      .eq('id', survivor.id)
      .select('id')
    if (upErr) throw new Error("Couldn't update the client you're keeping. Check your connection and try again.")
    if (!updated?.length) throw new Error("Couldn't update the client you're keeping. Refresh and try again.")
  }

  // 2) Move everything in one transaction when the database can. It is not
  // in every database yet, so a missing function falls through to step 3.
  let databaseMerged = false
  const { data: merged, error: mergeErr } = await supabase.rpc(MERGE_FUNCTION, { p_survivor: survivor.id, p_duplicates: loserIds })
  if (mergeErr && !functionMissing(mergeErr)) {
    throw new Error("Couldn't move the duplicate's records. Nothing was deleted. Check your connection and try again.")
  }
  if (!mergeErr && merged && typeof merged === 'object' && !Array.isArray(merged)) {
    databaseMerged = true
    const m = merged as Partial<Record<keyof Moved, number>>
    for (const k of Object.keys(moved) as (keyof Moved)[]) moved[k] += Number(m[k]) || 0
  }

  // 3) The app moves the records it writes itself. After the database
  // merge these find nothing left to move.
  const countKey: Partial<Record<string, keyof Moved>> = { fh_contacts: 'jobs', fh_leads: 'leads', fh_quotes: 'quotes', fh_invoices: 'invoices' }
  for (const table of MOVED_BY_APP) {
    const { data, error } = await supabase
      .from(table)
      .update({ client_id: survivor.id })
      .in('client_id', loserIds)
      .select('id')
    if (error) {
      const label = CLIENT_REFERENCES.find((r) => r.table === table)?.label ?? 'records'
      throw new Error(`Couldn't move the duplicate's ${label}. Nothing was deleted. Check your connection and try again.`)
    }
    const key = countKey[table]
    if (key) moved[key] += (data || []).length
  }

  // 4) Read every table that points at a client. A row still on a loser
  // would be deleted with it (or lose its client), so stop instead.
  const left: string[] = []
  for (const ref of CLIENT_REFERENCES) {
    if (databaseMerged && ref.byKey) continue
    const { data, error } = await supabase
      .from(ref.table)
      .select('client_id')
      .in('client_id', loserIds)
      .limit(1)
    if (error) throw new Error("Couldn't check that everything moved to the kept client. Nothing was deleted. Check your connection and try again.")
    if (data?.length) left.push(ref.label)
  }
  if (left.length) {
    throw new Error(`The duplicate still has ${joinWords(left)} that could not be moved, so it was not deleted. Nothing was lost.`)
  }

  // 5) Delete the loser rows, now that nothing points at them.
  const { data: deleted, error: delErr } = await supabase
    .from('fh_clients')
    .delete()
    .in('id', loserIds)
    .select('id')
  if (delErr) throw new Error("Everything moved to the kept client, but the duplicate couldn't be removed. Try the merge again.")
  if (!deleted?.length) throw new Error("Couldn't remove the duplicate records. Refresh and try again.")

  return {
    reassigned: moved.jobs,
    moved,
    deletedCount: deleted.length,
    patch
  }
}
