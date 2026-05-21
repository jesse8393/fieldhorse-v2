// Single source of truth for job type options — mirrors web src/lib/jobTypes.ts.
export type JobType = { value: string; label: string }

export const JOB_TYPES: JobType[] = [
  { value: 'New Build', label: 'New build' },
  { value: 'Renovation', label: 'Renovation' },
  { value: 'Addition', label: 'Addition' },
  { value: 'Kitchen', label: 'Kitchen' },
  { value: 'Bath', label: 'Bath' },
  { value: 'Concrete', label: 'Concrete' },
  { value: 'Outdoor Living', label: 'Outdoor Living' },
  { value: 'Insurance', label: 'Insurance' },
  { value: 'Roofing', label: 'Roofing' }
]
