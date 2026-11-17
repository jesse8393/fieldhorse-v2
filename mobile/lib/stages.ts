// mobile/lib/stages.ts
//
// Job stages on fh_contacts, mirroring src/lib/stages.ts (that file imports
// the web Supabase client, so native keeps its own copy of the constants).
// Leads live in fh_leads and quotes in fh_quotes. fh_contacts rows marked
// moved_lead or moved_quote were copied out by the migration and must never
// be shown, counted or written.

export const HIDDEN_STAGES = ['moved_lead', 'moved_quote'] as const

// The PostgREST value for .not('stage', 'in', MOVED_STAGE_FILTER) on every
// fh_contacts list read.
export const MOVED_STAGE_FILTER = `(${HIDDEN_STAGES.map((s) => `"${s}"`).join(',')})`

// The stages a person can choose for a job.
export const JOB_STAGE_CHOICES = ['job', 'closed', 'lost'] as const
export type JobStageChoice = typeof JOB_STAGE_CHOICES[number]

export function isJobStageChoice(stage: string): stage is JobStageChoice {
  return (JOB_STAGE_CHOICES as readonly string[]).includes(stage)
}
