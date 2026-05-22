// mobile/lib/publicLink.ts
//
// Mint / list / revoke fh_public_links rows from the app (quote +
// invoice surfaces). Mirrors src/lib/publicLink.ts on the web. The
// public viewer page lives on the web origin (fieldhorse.io), so the
// shared URL points there — the customer opens /p/{token} in a
// browser, no app required.

import { supabase } from './supabase'

const TOKEN_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const TOKEN_LEN = 24
const WEB_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL || 'https://fieldhorse.io').replace(/\/+$/, '')

function randomToken(): string {
  const g: any = globalThis as any
  const bytes = new Uint8Array(TOKEN_LEN)
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < TOKEN_LEN; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  let out = ''
  for (const b of bytes) out += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]
  return out
}

export type PublicLinkKind = 'proposal' | 'invoice'

export function buildPublicUrl(token: string): string {
  return `${WEB_BASE}/p/${token}`
}

export async function mintPublicLink({ contactId, userId, kind, expiresAt = null }: {
  contactId: string | undefined
  userId: string | undefined
  kind: PublicLinkKind
  expiresAt?: Date | null
}): Promise<{ token: string; url: string }> {
  if (!contactId || !userId || !kind) throw new Error('contactId, userId, kind required')
  const token = randomToken()
  const { error } = await supabase.from('fh_public_links').insert({
    user_id: userId,
    contact_id: contactId,
    kind,
    token,
    expires_at: expiresAt ? expiresAt.toISOString() : null
  } as any)
  if (error) throw error
  return { token, url: buildPublicUrl(token) }
}

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

export async function revokePublicLink(linkId: string | undefined): Promise<boolean> {
  if (!linkId) return false
  const { error } = await supabase
    .from('fh_public_links')
    .update({ revoked_at: new Date().toISOString() } as any)
    .eq('id', linkId)
  return !error
}
