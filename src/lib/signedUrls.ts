// src/lib/signedUrls.ts
//
// Signed URL reuse for private storage buckets. Every createSignedUrls
// call mints a new token, so the same photo comes back under a new URL
// and the browser downloads it again each time a job's photos mount.
// Keeping each URL in the query cache for most of its lifetime lets a
// remount reuse it, and the browser's HTTP cache then serves the image
// (uploads carry the default one hour max-age). The query cache is
// cleared on sign out and reset on a workspace switch, so a URL never
// outlives the session that signed it.
//
// A caller that keeps a URL (in its own query data, which the offline
// cache saves) keeps when it was signed too, and checks isSignedUrlFresh
// before it draws it: a URL reused from this cache may already be 49
// minutes into its hour, however recent the read that handed it out.

import type { QueryClient } from '@tanstack/react-query'
import { supabase } from './supabase.ts'

export const SIGNED_URL_TTL_SECONDS = 3600
// Reuse a URL only while it has at least ten minutes left, so an <img>
// that renders it never races the expiry.
export const SIGNED_URL_REUSE_MS = (SIGNED_URL_TTL_SECONDS - 10 * 60) * 1000

/** A signed URL and when it was signed (epoch ms). */
export type SignedUrl = { url: string; signedAt: number }

function cacheKey(bucket: string, path: string) {
  return ['signedUrl', bucket, path]
}

/**
 * True while a URL signed at `signedAt` has at least ten minutes of its
 * hour left at `now`. A missing time, or one after `now` (the clock moved
 * back), is never fresh.
 */
export function isSignedUrlFresh(signedAt: number | null | undefined, now: number = Date.now()): boolean {
  if (typeof signedAt !== 'number' || !Number.isFinite(signedAt)) return false
  const age = now - signedAt
  return age >= 0 && age < SIGNED_URL_REUSE_MS
}

/**
 * Signed URLs for `paths` in `bucket`, keyed by path, each with when it was
 * signed. URLs signed in the last 50 minutes are reused with their first
 * signing time; the rest are signed in one request. Paths that fail to
 * sign are left out of the result.
 */
export async function signedUrlEntriesFor(
  queryClient: QueryClient,
  bucket: string,
  paths: readonly string[],
  now: number = Date.now()
): Promise<Map<string, SignedUrl>> {
  const out = new Map<string, SignedUrl>()
  const missing: string[] = []
  for (const path of new Set(paths.filter(Boolean))) {
    const hit = queryClient.getQueryData<SignedUrl>(cacheKey(bucket, path))
    if (hit?.url && isSignedUrlFresh(hit.signedAt, now)) out.set(path, { url: hit.url, signedAt: hit.signedAt })
    else missing.push(path)
  }
  if (missing.length === 0) return out

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(missing, SIGNED_URL_TTL_SECONDS)
  if (error || !data) return out
  for (const s of data) {
    if (!s?.path || !s.signedUrl || s.error) continue
    const entry = { url: s.signedUrl, signedAt: now }
    out.set(s.path, entry)
    queryClient.setQueryData<SignedUrl>(cacheKey(bucket, s.path), entry)
  }
  return out
}

/** signedUrlEntriesFor without the signing times, for callers that draw the URLs at once. */
export async function signedUrlsFor(
  queryClient: QueryClient,
  bucket: string,
  paths: readonly string[],
  now: number = Date.now()
): Promise<Map<string, string>> {
  const entries = await signedUrlEntriesFor(queryClient, bucket, paths, now)
  return new Map(Array.from(entries, ([path, entry]) => [path, entry.url]))
}
