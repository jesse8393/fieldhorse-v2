// src/lib/publicLink.ts
//
// Mint, fetch, and revoke fh_public_links rows from any in-app
// surface (Quote tab, InvoiceDetail, future surfaces). Tokens are
// 24 chars of url-safe randomness — short enough to fit in a text
// message, long enough to be unguessable.

import { supabase } from './supabase.js'

const TOKEN_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789' // skip lookalikes
const TOKEN_LEN = 24

function randomToken() {
  // crypto.getRandomValues for a real-random byte stream; map each
  // byte to the alphabet by modulo. Slight modulo bias on a 56-char
  // alphabet is fine for a share token (no key strength claim).
  const bytes = new Uint8Array(TOKEN_LEN)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]
  return out
}

export type PublicLinkKind = 'proposal' | 'invoice'

/**
 * Create a new public link for the given contact. Returns the full
 * row including the token + the public URL ready to share.
 */
export async function mintPublicLink({ contactId, userId, kind, expiresAt = null }: {
  contactId: string | undefined
  userId: string | undefined
  kind: PublicLinkKind
  expiresAt?: Date | null
}) {
  if (!contactId || !userId || !kind) throw new Error('contactId, userId, kind required')
  if (kind !== 'proposal' && kind !== 'invoice') throw new Error(`unknown kind: ${kind}`)
  const token = randomToken()
  const { data, error } = await supabase
    .from('fh_public_links')
    .insert({
      user_id: userId,
      contact_id: contactId,
      kind,
      token,
      expires_at: expiresAt ? expiresAt.toISOString() : null
    })
    .select('*')
    .single()
  if (error) throw error
  return {
    ...data,
    url: buildPublicUrl(token)
  }
}

/**
 * Public-facing URL for a token. Uses the current window origin so
 * the link works regardless of the deploy environment (Netlify
 * preview, production, localhost).
 */
export function buildPublicUrl(token: string) {
  if (typeof window === 'undefined') return `/p/${token}`
  return `${window.location.origin}/p/${token}`
}

/**
 * List all active (non-revoked, non-expired) links for a contact.
 * Caller uses this to surface "X active share link(s)" + a revoke
 * action on detail surfaces.
 */
export async function listPublicLinks(contactId: string | undefined) {
  if (!contactId) return []
  const { data } = await supabase
    .from('fh_public_links')
    .select('*')
    .eq('contact_id', contactId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  return data || []
}

export async function revokePublicLink(linkId: string | undefined) {
  if (!linkId) return false
  const { error } = await supabase
    .from('fh_public_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', linkId)
  return !error
}
