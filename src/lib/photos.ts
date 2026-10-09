// Photo helpers for the v3 visual layer.
//
// fh_job_files holds both files and photos, distinguished by `kind`.
// Photos sit in the PRIVATE `job-photos` Supabase Storage bucket, so we
// need signed URLs (1h TTL) to render them in <img>.
//
// Strategy for list views (Home cards): one query for the newest photo
// of each job on screen + ONE batch signed-URL call. No N+1, and no scan
// of the whole photo table.

import { supabase } from './supabase.ts'

const SIGN_TTL_SECONDS = 3600 // 1 hour, long enough for a session, short enough that leaked URLs expire

type CoverRow = {
  id: string
  fh_job_files: { storage_path: string | null; uploaded_at: string | null }[] | null
}

/**
 * Fetch the latest cover photo for each of the given jobs, returning a
 * map keyed by contact (job) id → signed URL. Jobs without a photo are
 * left out.
 *
 * Bounded by the ids the caller renders. It used to read every photo
 * row the user had and reduce in JS, which PostgREST silently capped at
 * max-rows (1000), so jobs whose newest photo was older than the 1000th
 * lost their cover. The embedded read below returns at most one photo
 * per job: PostgREST applies an embedded limit per parent row.
 */
export async function fetchCoverPhotosByJob(jobIds: readonly string[]): Promise<Record<string, string>> {
  const ids = Array.from(new Set(jobIds.filter(Boolean)))
  if (ids.length === 0) return {}

  const { data, error } = await supabase
    .from('fh_contacts')
    .select('id, fh_job_files(storage_path, uploaded_at)')
    .in('id', ids)
    .eq('fh_job_files.kind', 'photo')
    .order('uploaded_at', { referencedTable: 'fh_job_files', ascending: false })
    .limit(1, { referencedTable: 'fh_job_files' })

  if (error || !data) return {}

  // Newest path per job. The embedded limit already leaves one row; the
  // compare keeps this correct if a response ever carries more.
  const pathByJob = new Map<string, string>()
  for (const row of data as unknown as CoverRow[]) {
    let newest: { path: string; at: string } | null = null
    for (const f of row.fh_job_files ?? []) {
      if (!f?.storage_path) continue
      const at = f.uploaded_at || ''
      if (!newest || at > newest.at) newest = { path: f.storage_path, at }
    }
    if (row.id && newest) pathByJob.set(row.id, newest.path)
  }

  const uniquePaths = Array.from(new Set(pathByJob.values()))
  if (uniquePaths.length === 0) return {}

  // ONE batch sign call. createSignedUrls returns { path, signedUrl, error } per entry.
  const { data: signed, error: signErr } = await supabase.storage
    .from('job-photos')
    .createSignedUrls(uniquePaths, SIGN_TTL_SECONDS)

  if (signErr || !signed) return {}

  const urlByPath = new Map<string, string>()
  for (const s of signed) {
    if (s?.path && s.signedUrl && !s.error) urlByPath.set(s.path, s.signedUrl)
  }

  const out: Record<string, string> = {}
  for (const [jobId, path] of pathByJob.entries()) {
    const url = urlByPath.get(path)
    if (url) out[jobId] = url
  }
  return out
}
