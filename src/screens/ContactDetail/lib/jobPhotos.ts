// A job's photos for the phone header and the Spine (spec 9.4): the photo
// rows, newest first, each with a signed url from the private job-photos
// bucket. Signed through signedUrlEntriesFor, so the Files tab reuses the same
// URLs. A photo that fails to sign keeps its place in the count but never
// renders as a thumbnail or a cover.
//
// Pure apart from the read, so the freshness rule can be tested: the
// query reads the rows and signs them (fetchJobPhotos), and the screen
// turns that into what it draws (jobPhotosView).
//
// Each URL keeps the time it was signed, and is drawn only while it is
// fresh by that time (Phase 8, Task 15). A read can reuse a URL the cache
// signed 49 minutes earlier, so the time of the read says nothing about
// when the URL runs out, and the offline cache can hand back a read from
// hours ago.

import type { QueryClient } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase.ts'
import { isSignedUrlFresh, signedUrlEntriesFor } from '../../../lib/signedUrls.ts'
import type { SignedUrl } from '../../../lib/signedUrls.ts'

const BUCKET = 'job-photos'

export type JobPhotoRow = {
  id: string
  storage_path: string
  uploaded_at: string
  caption: string | null
}

export type JobPhotoData = {
  rows: JobPhotoRow[]
  /** The signed URL of each photo that signed, by photo id, with when it was signed. */
  signed: Record<string, SignedUrl>
}

export type JobPhotos = {
  /** Newest first, each with its signed url or null. */
  rows: (JobPhotoRow & { url: string | null })[]
  count: number
  /** The newest photo that signed, for the header. */
  cover: { url: string; alt: string } | null
}

export function jobPhotosKey(jobId: string | null | undefined) {
  return ['jobDetailPhotos', jobId] as const
}

export async function fetchJobPhotos(queryClient: QueryClient, jobId: string): Promise<JobPhotoData> {
  const { data, error } = await supabase
    .from('fh_job_files')
    .select('id, storage_path, uploaded_at, caption')
    .eq('job_id', jobId)
    .eq('kind', 'photo')
    .order('uploaded_at', { ascending: false })
  if (error) throw error
  const rows = ((data || []) as JobPhotoRow[]).filter((r) => r?.id && r.storage_path)
  const signed: Record<string, SignedUrl> = {}
  if (rows.length > 0) {
    try {
      const byPath = await signedUrlEntriesFor(queryClient, BUCKET, rows.map((r) => r.storage_path))
      for (const r of rows) {
        const entry = byPath.get(r.storage_path)
        if (entry) signed[r.id] = entry
      }
    } catch {
      // Signing failed: the rows still count, the header falls back to onyx.
    }
  }
  return { rows, signed }
}

/** What the header and the Spine draw from the query's data at `now`. */
export function jobPhotosView(data: JobPhotoData | undefined, now: number): JobPhotos {
  // Never hand out a URL that may have expired, so no image renders
  // broken: each one counts from when it was signed. A copy saved before
  // the signing times were kept has none, so it shows no URL until the
  // read that runs on every mount lands.
  const signed = data?.signed ?? {}
  const rows = (data?.rows ?? [])
    .map((r) => {
      const entry = signed[r.id]
      return { ...r, url: entry && isSignedUrlFresh(entry.signedAt, now) ? entry.url : null }
    })
    .sort((a, b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)))
  const first = rows.find((r) => r.url)
  return {
    rows,
    count: rows.length,
    cover: first?.url ? { url: first.url, alt: first.caption?.trim() || 'Newest job photo' } : null
  }
}
