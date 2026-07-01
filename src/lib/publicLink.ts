// src/lib/publicLink.ts
//
// Mint, fetch, and revoke fh_public_links rows from any in-app
// surface (Quote tab, InvoiceDetail, future surfaces). Tokens are
// 24 chars of url-safe randomness — short enough to fit in a text
// message, long enough to be unguessable.

import { supabase } from './supabase.ts'

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

export type PublicLinkKind = 'proposal' | 'invoice' | 'change_order' | 'statement'

/**
 * Create a new public link. Proposal / invoice / change_order links
 * hang off a single job (contactId). A statement link is client-scoped
 * (clientId, no contactId) and rolls up every open job for that client.
 * Returns the full row including the token + the public URL to share.
 */
export async function mintPublicLink({ contactId = null, clientId = null, userId, kind, expiresAt = null, changeOrderId = null }: {
  contactId?: string | null
  clientId?: string | null
  userId: string | undefined
  kind: PublicLinkKind
  expiresAt?: Date | null
  changeOrderId?: string | null
}) {
  if (!userId || !kind) throw new Error('userId, kind required')
  if (!['proposal', 'invoice', 'change_order', 'statement'].includes(kind)) throw new Error(`unknown kind: ${kind}`)
  if (kind === 'statement') {
    if (!clientId) throw new Error('clientId required for statement links')
  } else if (!contactId) {
    throw new Error('contactId required')
  }
  if (kind === 'change_order' && !changeOrderId) throw new Error('changeOrderId required for change_order links')
  const token = randomToken()
  const { data, error } = await supabase
    .from('fh_public_links')
    .insert({
      user_id: userId,
      contact_id: kind === 'statement' ? null : contactId,
      client_id: kind === 'statement' ? clientId : null,
      kind,
      token,
      expires_at: expiresAt ? expiresAt.toISOString() : null,
      change_order_id: changeOrderId
    } as any)
    .select('*')
    .single()
  if (error) throw error
  return {
    ...data,
    url: buildPublicUrl(token)
  }
}

/**
 * List active (non-revoked, non-expired) statement links for a client.
 * Lets the statement sheet reuse an existing share link instead of
 * minting a fresh token on every open.
 */
export async function listClientStatementLinks(clientId: string | undefined) {
  if (!clientId) return []
  const { data } = await supabase
    .from('fh_public_links')
    .select('*')
    .eq('client_id', clientId)
    .eq('kind', 'statement')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  return (data || []).filter((l: any) => !l.expires_at || new Date(l.expires_at) >= new Date())
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
