// Opening Universal Capture from anywhere in the app. The sheet listens
// for the `fh:open-capture` window event (see CaptureSheet.tsx); a screen
// that knows which job the person is looking at passes its id so the
// capture is filed against that job.
//
// The attach is a suggestion with the same trust rules as the model's:
// the job goes into the roster normalizeIntent validates against, it
// fills job_id only when the model left it empty, and the person still
// sees it on the confirm card and can change it before anything writes.

import type { CaptureIntent, RosterEntry } from './captureIntelligence.ts'

export type OpenCaptureDetail = { jobId?: string }

export function openCapture(detail: OpenCaptureDetail = {}): void {
  window.dispatchEvent(new CustomEvent<OpenCaptureDetail>('fh:open-capture', { detail }))
}

/**
 * The roster with the attached job first, never twice. The sheet's own
 * roster stops at the 100 most recent active rows, so a job opened from
 * its page can be missing; without it normalizeIntent would drop the id.
 * First also keeps it inside the slice of the roster the model is shown.
 */
export function withAttachedJob<T extends RosterEntry>(roster: T[], job: T | null): T[] {
  if (!job) return [...roster]
  return [job, ...roster.filter((r) => r.id !== job.id)]
}

/**
 * Files the capture on the attached job when the model did not pick one.
 * A job the model chose stays, and a new lead is never put on a job.
 */
export function seedJob(intent: CaptureIntent, jobId: string | null): CaptureIntent {
  if (!jobId || intent.job_id || intent.kind === 'lead') return intent
  return { ...intent, job_id: jobId }
}
