// Single source of truth for job type options. Used by the create screens and Bid
// so the app speaks the same language end-to-end.

export type JobType = { value: string; label: string }

export const JOB_TYPES: JobType[] = [
  { value: 'New Build', label: 'New build' },
  { value: 'Renovation', label: 'Renovation' },
  { value: 'Addition', label: 'Addition' },
  { value: 'Kitchen', label: 'Kitchen' },
  { value: 'Bath', label: 'Bath' },
  { value: 'Concrete', label: 'Concrete' },
  { value: 'Outdoor Living', label: 'Outdoor living' },
  { value: 'Insurance', label: 'Insurance' },
  { value: 'Roofing', label: 'Roofing' }
]

// The last job type saved on a job or quote starts the next New job and
// New quote on this device, so a company that does one kind of work picks
// it once. Before the October redesign the lead sheet kept it under
// fh:lastJobType; the first read moves that value to the current key.
export const LAST_JOB_TYPE_KEY = 'fh:last-job-type'
const OLD_LAST_JOB_TYPE_KEY = 'fh:lastJobType'

function isJobType(value: string | null): value is string {
  return !!value && JOB_TYPES.some((type) => type.value === value)
}

export function readLastJobType(): string {
  try {
    let value = localStorage.getItem(LAST_JOB_TYPE_KEY)
    if (value === null) {
      const old = localStorage.getItem(OLD_LAST_JOB_TYPE_KEY)
      if (old !== null) {
        localStorage.removeItem(OLD_LAST_JOB_TYPE_KEY)
        if (isJobType(old)) {
          localStorage.setItem(LAST_JOB_TYPE_KEY, old)
          value = old
        }
      }
    }
    return isJobType(value) ? value : ''
  } catch { return '' }
}

export function writeLastJobType(value: string) {
  if (!isJobType(value)) return
  try { localStorage.setItem(LAST_JOB_TYPE_KEY, value) } catch { /* storage blocked: the next form starts on Not selected */ }
}
