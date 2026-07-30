// Stage-aware workspace config. One deal flows through stages; the detail
// screen reshapes per stage so each stage reads as its own focused space
// instead of the same 5 tabs everywhere.
//
// Gating rules that matter:
//   - Financials (invoices/payments) is available from `job` onward, so you
//     can add an invoice while a job is running.
//   - `invoice` / `closed` hide the Quote tab entirely, an invoice for
//     materials or a quick job never needed a quote.

export type DealTabId = 'overview' | 'quote' | 'details' | 'financials' | 'files' | 'logs' | 'selections' | 'materials' | 'change_orders'

const ALL_TABS: DealTabId[] = ['overview', 'quote', 'details', 'financials', 'files', 'logs', 'selections', 'materials', 'change_orders']

// Materials appears on the same stages as daily logs, there's no
// procurement to track on a lead, but quote/job/invoice/closed all
// need it (estimators want a working list before the job starts).
//
// Change orders show on quote / job / invoice / closed, a CO
// amends the originally-approved scope, so there's nothing to amend
// on a lead. They're ALSO rendered inline inside the Quote tab on
// the quote stage (the existing quote-authoring flow) so quote-stage
// users see them in both places; that's intentional, not duplication.
const STAGE_TABS: Record<string, DealTabId[]> = {
  lead:    ['overview', 'quote', 'details', 'files'],
  quote:   ['overview', 'quote', 'details', 'selections', 'materials', 'change_orders', 'files'],
  job:     ['overview', 'details', 'selections', 'materials', 'logs', 'change_orders', 'financials', 'files'],
  invoice: ['overview', 'selections', 'materials', 'logs', 'change_orders', 'financials', 'files'],
  closed:  ['overview', 'selections', 'materials', 'logs', 'change_orders', 'financials', 'files'],
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
