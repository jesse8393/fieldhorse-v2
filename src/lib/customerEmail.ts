// Where a customer's email comes from (Phase 8, Task 15): the job's own
// email, then the email of the client the job is linked to. Money's Remind
// sheet and the Quote tab's send both read this, so a job with no email of
// its own but a linked client with one sends the same way on both.

export type EmailSource = {
  email?: string | null
  fh_clients?: { email?: string | null } | null
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** The job's email, else its linked client's, trimmed; empty when neither has one. */
export function customerEmail(job: EmailSource | null | undefined): string {
  return clean(job?.email) || clean(job?.fh_clients?.email)
}
