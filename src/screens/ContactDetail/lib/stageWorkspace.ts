// Stage-aware workspace config. One deal flows through stages; the detail
// screen reshapes per stage so each stage reads as its own focused space
// instead of the same 5 tabs everywhere.
//
// Gating rules that matter:
//   - Financials (invoices/payments) is available from `job` onward, so you
//     can add an invoice while a job is running.
//   - `invoice` / `closed` hide the Quote tab entirely — an invoice for
//     materials or a quick job never needed a quote.

export type DealTabId = 'overview' | 'quote' | 'details' | 'financials' | 'files' | 'logs' | 'selections'

const ALL_TABS: DealTabId[] = ['overview', 'quote', 'details', 'financials', 'files', 'logs', 'selections']

// Daily logs only show up once a job is actively running — there's
// nothing to log before then. Job / invoice / closed stages all
// expose the tab so a foreman can post during execution and the
// owner can still browse the history after close-out.
//
// Selections appears starting at quote — clients need to pick finishes
// before the build kicks off, and approved/installed picks stay
// visible through closeout. Lead and lost stages skip it.
const STAGE_TABS: Record<string, DealTabId[]> = {
  lead:    ['overview', 'quote', 'details', 'files'],
  quote:   ['overview', 'quote', 'details', 'selections', 'files'],
  job:     ['overview', 'details', 'selections', 'logs', 'financials', 'files'],
  invoice: ['overview', 'selections', 'logs', 'financials', 'files'],
  closed:  ['overview', 'selections', 'logs', 'financials', 'files'],
  lost:    ['overview', 'files']
}

export function tabsForStage(stage?: string | null): DealTabId[] {
  return STAGE_TABS[String(stage ?? '').toLowerCase()] ?? ALL_TABS
}

// Resolve the tab to actually show: honor the requested tab only if the
// current stage exposes it, otherwise fall back to overview.
export function resolveTabForStage(stage: string | null | undefined, requested: string | null | undefined): DealTabId {
  const allowed = tabsForStage(stage)
  return (requested && allowed.includes(requested as DealTabId)) ? (requested as DealTabId) : 'overview'
}
