// Stage-aware workspace config for the job screen. A job's stage is job,
// closed or lost (SPEC D55); leads and quotes are records of their own
// now, so the job carries no Quote tab. The screen reshapes per stage so
// a closed or lost job reads as its own focused space.
//
// Gating rules that matter:
//   - Financials (invoices/payments) is available on a job and stays
//     readable once it is closed.
//   - A lost job keeps only the overview and its files.
//   - `invoice` is the legacy alias of `job` and gets the same tabs; a
//     contact row still at a sales stage reads as a job too.

export type DealTabId = 'overview' | 'details' | 'financials' | 'files' | 'logs' | 'selections' | 'materials' | 'change_orders'

const JOB_TABS: DealTabId[] = ['overview', 'details', 'selections', 'materials', 'logs', 'change_orders', 'financials', 'files']

const STAGE_TABS: Record<string, DealTabId[]> = {
  job:     JOB_TABS,
  closed:  ['overview', 'selections', 'materials', 'logs', 'change_orders', 'financials', 'files'],
  lost:    ['overview', 'files']
}

export type JobStage = 'job' | 'closed' | 'lost'

/** The stage the screen works from: closed, lost, or job for everything else. */
export function jobStage(stage?: string | null): JobStage {
  const s = String(stage ?? '').toLowerCase()
  return s === 'closed' || s === 'lost' ? s : 'job'
}

export function tabsForStage(stage?: string | null): DealTabId[] {
  return STAGE_TABS[jobStage(stage)]
}

// Resolve the tab to actually show: honor the requested tab only if the
// current stage exposes it, otherwise fall back to overview.
export function resolveTabForStage(stage: string | null | undefined, requested: string | null | undefined): DealTabId {
  const allowed = tabsForStage(stage)
  return (requested && allowed.includes(requested as DealTabId)) ? (requested as DealTabId) : 'overview'
}

export type StageCta = { label: string; action: 'invoice' | 'complete' | 'reopen' }

/**
 * The one gold action for the stage (SPEC D61): Invoice this while money
 * is owed, Mark complete once the balance is collected, Reopen on a closed
 * or lost job. Field roles get none; the caller gates on that.
 */
export function stageCta(stage: string | null | undefined, balance: number | null | undefined): StageCta | null {
  const s = jobStage(stage)
  if (s === 'closed' || s === 'lost') return { label: 'Reopen', action: 'reopen' }
  return Number(balance || 0) > 0
    ? { label: 'Invoice this', action: 'invoice' }
    : { label: 'Mark complete', action: 'complete' }
}
