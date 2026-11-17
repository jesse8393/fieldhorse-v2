// Half typed work kept on this device (D23): the create screens' drafts
// under fh:draft:<kind>, and the edit drafts under fh:draft:edit:<what>:<id>.
// Each draft lasts 24 hours and is tagged with the person who typed it.
//
// The tag is what lets a session that ends on its own (a refused refresh
// token, a revoked session) keep the drafts: the person who signs back in
// gets them again, and anyone else signing in on the same device never
// sees them, because a draft tagged with someone else is never read and is
// removed as soon as another account's session starts. A Sign out the
// person chose still clears every draft (AuthContext purgeLocalData).

export const DRAFT_PREFIX = 'fh:draft:'
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000

/** What is stored for one draft. `base` is the saved value an edit started from. */
export type DraftEntry<T> = { form: T; base?: unknown; savedAt: number; userId?: string }

// The person whose session is open, set when a session is published.
// Nothing is written while nobody is signed in.
let owner: string | null = null

function storage(): Storage | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}

function parse(raw: string | null): DraftEntry<unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as DraftEntry<unknown>
    return parsed && typeof parsed === 'object' && parsed.form && typeof parsed.form === 'object' ? parsed : null
  } catch { return null }
}

function expired(entry: DraftEntry<unknown>, now = Date.now()) {
  return now - (entry.savedAt || 0) > DRAFT_TTL_MS
}

function draftKeys(store: Storage): string[] {
  const keys: string[] = []
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)
    if (key && key.startsWith(DRAFT_PREFIX)) keys.push(key)
  }
  return keys
}

export function draftKey(kind: string) {
  return `${DRAFT_PREFIX}${kind}`
}

/**
 * The session's owner changed. A person signing in keeps their own drafts,
 * adopts drafts saved before drafts carried a tag (only the device's owner
 * can have those: every purge cleared them), and loses nobody else's,
 * because every draft tagged with another person is removed here.
 */
export function setDraftOwner(userId: string | null) {
  owner = userId
  const store = storage()
  if (!userId || !store) return
  for (const key of draftKeys(store)) {
    try {
      const entry = parse(store.getItem(key))
      if (!entry || expired(entry) || (entry.userId && entry.userId !== userId)) store.removeItem(key)
      else if (!entry.userId) store.setItem(key, JSON.stringify({ ...entry, userId }))
    } catch { /* storage blocked: nothing was saved either */ }
  }
}

/** The whole stored draft, or null when there is none for this person. */
export function readDraftEntry<T>(kind: string): DraftEntry<T> | null {
  const store = storage()
  if (!store) return null
  try {
    const entry = parse(store.getItem(draftKey(kind)))
    if (!entry || expired(entry)) return null
    if (entry.userId && entry.userId !== owner) return null
    return entry as DraftEntry<T>
  } catch { return null }
}

export function readDraft<T extends Record<string, unknown>>(kind: string): T | null {
  return readDraftEntry<T>(kind)?.form ?? null
}

function hasContent(form: Record<string, unknown>) {
  return Object.values(form).some((v) => typeof v === 'string' ? v.trim() !== '' : v != null && v !== false)
}

/**
 * Saves a draft, or forgets it when nothing is typed. `base` is what an
 * edit started from; an edit is kept even when it empties a field.
 */
export function writeDraft(kind: string, form: Record<string, unknown>, base?: unknown) {
  const store = storage()
  if (!store) return
  try {
    const empty = base === undefined ? !hasContent(form) : Object.keys(form).length === 0
    if (!owner || empty) { store.removeItem(draftKey(kind)); return }
    const entry: DraftEntry<unknown> = { form, savedAt: Date.now(), userId: owner }
    if (base !== undefined) entry.base = base
    store.setItem(draftKey(kind), JSON.stringify(entry))
  } catch { /* quota or private mode: drafts are best effort */ }
}

export function clearDraft(kind: string) {
  try { storage()?.removeItem(draftKey(kind)) } catch { /* ignore */ }
}

/**
 * Removes drafts from this device. keepOwned keeps those tagged with a
 * person, for a session that ended without the person choosing to sign
 * out; drafts with no tag go, since nobody can be sure whose they are.
 */
export function clearDrafts({ keepOwned }: { keepOwned: boolean }) {
  const store = storage()
  if (!store) return
  if (!keepOwned) owner = null
  try {
    for (const key of draftKeys(store)) {
      const entry = keepOwned ? parse(store.getItem(key)) : null
      if (!entry || !entry.userId || expired(entry)) {
        try { store.removeItem(key) } catch { /* non-fatal */ }
      }
    }
  } catch { /* storage blocked: nothing was stored either */ }
}

/** True when two forms hold the same values. */
export function sameDraft(a: unknown, b: unknown) {
  try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
}

/**
 * Where an edit starts: the stored changes over the saved form, when they
 * began from the same saved value (`from`, the form itself unless given)
 * that the screen shows now. A draft whose record changed underneath it
 * (saved elsewhere since) is stale and is removed.
 */
export function startEdit<T extends Record<string, unknown>>(kind: string, base: T, from: unknown = base): { form: T } | null {
  const entry = readDraftEntry<Partial<T>>(kind)
  if (!entry) return null
  if (!sameDraft(entry.base, from)) {
    clearDraft(kind)
    return null
  }
  return { form: { ...base, ...entry.form } }
}
