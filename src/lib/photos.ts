// Photo helpers for the v3 visual layer.
//
// fh_job_files holds both files and photos, distinguished by `kind`.
// Photos sit in the PRIVATE `job-photos` Supabase Storage bucket, so we
// need signed URLs (1h TTL) to render them in <img>.
//
// Strategy for list views (Jobs, Home Live Feed): one query for all the
// user's photos + ONE batch signed-URL call. No N+1.

import { supabase } from './supabase.js'

const SIGN_TTL_SECONDS = 3600 // 1 hour — long enough for a session, short enough that leaked URLs expire

/**
 * Fetch the latest cover photo per job for the given user, returning a map
 * keyed by contact (job) id → signed URL.
 */
export async function fetchCoverPhotosByJob(userId: string | undefined): Promise<Record<string, string>> {
  if (!userId) return {}

  // Latest-first so the reduce naturally keeps the newest per job.
  const { data: photos, error: qErr } = await supabase
    .from('fh_job_files')
    .select('job_id, storage_path, uploaded_at')
    .eq('user_id', userId)
    .eq('kind', 'photo')
    .order('uploaded_at', { ascending: false })

  if (qErr || !photos || photos.length === 0) return {}

  // Reduce to latest path per job.
  const pathByJob = new Map<string, string>()
  for (const p of photos) {
    if (p.job_id && p.storage_path && !pathByJob.has(p.job_id)) {
      pathByJob.set(p.job_id, p.storage_path)
    }
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
