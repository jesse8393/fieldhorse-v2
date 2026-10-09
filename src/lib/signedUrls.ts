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

import type { QueryClient } from '@tanstack/react-query'
import { supabase } from './supabase.ts'

export const SIGNED_URL_TTL_SECONDS = 3600
// Reuse a URL only while it has at least ten minutes left, so an <img>
// that renders it never races the expiry.
export const SIGNED_URL_REUSE_MS = (SIGNED_URL_TTL_SECONDS - 10 * 60) * 1000

type CachedUrl = { url: string; signedAt: number }

function cacheKey(bucket: string, path: string) {
  return ['signedUrl', bucket, path]
}

/**
 * Signed URLs for `paths` in `bucket`, keyed by path. URLs signed in the
 * last 50 minutes are reused; the rest are signed in one request. Paths
 * that fail to sign are left out of the result.
 */
export async function signedUrlsFor(
  queryClient: QueryClient,
  bucket: string,
  paths: readonly string[],
  now: number = Date.now()
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const missing: string[] = []
  for (const path of new Set(paths.filter(Boolean))) {
    const hit = queryClient.getQueryData<CachedUrl>(cacheKey(bucket, path))
    const age = hit ? now - hit.signedAt : -1
    if (hit?.url && age >= 0 && age < SIGNED_URL_REUSE_MS) out.set(path, hit.url)
    else missing.push(path)
  }
  if (missing.length === 0) return out

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(missing, SIGNED_URL_TTL_SECONDS)
  if (error || !data) return out
  for (const s of data) {
    if (!s?.path || !s.signedUrl || s.error) continue
    out.set(s.path, s.signedUrl)
    queryClient.setQueryData<CachedUrl>(cacheKey(bucket, s.path), { url: s.signedUrl, signedAt: now })
  }
  return out
}
