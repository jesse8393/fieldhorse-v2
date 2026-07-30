// Sub identity keying, ONE normalization shared by the Subs list
// rollup and the Sub detail fetch.
//
// The old rule keyed on the raw `phone || name` string, so the same
// sub stored as "(615) 555-0101" on old jobs and "6155550101" on new
// ones split into two cards with partial billed totals, and a row with
// neither name nor phone linked to /subs/__untitled__ which the detail
// fetch (which keyed empties as '') could never match.

/** Digits-only phone identity (last 10 digits, so +1 prefixes and
 *  formatting don't split identities). Returns '' when the value has
 *  too few digits to be a phone number. */
export function normalizePhoneKey(phone: string | null | undefined): string {
  const digits = String(phone || '').replace(/\D/g, '')
  if (digits.length < 7) return ''
  return digits.slice(-10)
}

export const UNTITLED_SUB_KEY = '__untitled__'

/** Stable identity key for a sub row: normalized phone when present,
 *  else lowercased name, else the untitled sentinel. */
export function subIdentityKey(row: { phone?: string | null; name?: string | null }): string {
  const phoneKey = normalizePhoneKey(row?.phone)
  if (phoneKey) return phoneKey
  const nameKey = String(row?.name || '').toLowerCase().trim()
  return nameKey || UNTITLED_SUB_KEY
}

/** Does this row belong to the given identity key? Accepts both the
 *  new normalized keys and legacy raw-string keys so stale links keep
 *  resolving. */
export function subMatchesKey(row: { phone?: string | null; name?: string | null }, key: string): boolean {
  if (!key) return false
  if (subIdentityKey(row) === key) return true
  // Legacy key formats (raw phone string / raw lowercased value).
  const legacy = String(row?.phone || row?.name || '').toLowerCase().trim()
  return legacy === key.toLowerCase().trim()
}
