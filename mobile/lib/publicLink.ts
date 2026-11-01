// mobile/lib/publicLink.ts
//
// Mint / list / revoke fh_public_links rows from the app (quote +
// invoice surfaces). Mirrors src/lib/publicLink.ts on the web. The
// public viewer page lives on the web origin (fieldhorse.io), so the
// shared URL points there, the customer opens /p/{token} in a
// browser, no app required.

import { supabase } from './supabase'
import { confirmMutation } from './mutationResult'
import { getRandomBytesAsync } from 'expo-crypto'

const TOKEN_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const TOKEN_LEN = 24
const WEB_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL || 'https://fieldhorse.io').replace(/\/+$/, '')

async function randomToken(): Promise<string> {
  // Native Hermes does not guarantee global Web Crypto. Use the native CSPRNG
  // and fail closed if it is unavailable; these tokens grant document access.
  const bytes = await getRandomBytesAsync(TOKEN_LEN)
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
  const token = await randomToken()
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
  const { data, error } = await supabase
    .from('fh_public_links')
    .select('*')
    .eq('contact_id', contactId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function revokePublicLink(linkId: string | undefined): Promise<boolean> {
  if (!linkId) return false
  const { error } = await confirmMutation(supabase
    .from('fh_public_links')
    .update({ revoked_at: new Date().toISOString() } as any)
    .eq('id', linkId)
    .select('id'))
  return !error
}
