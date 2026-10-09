// Role aware shape of the job detail screen.
//
// Field roles (foreman, crew) work the job but do not see its money.
// Migration 064 closes payments, invoices, change orders, quote items,
// quote versions, closeouts and insurance claims to them, so those
// sections would only render empty totals or fail on save. Expenses and
// materials stay open because crew log receipts and receive materials
// from the field, so the Financials tab survives for them as an
// expenses only view.

export type DetailTab = { id: string; label: string }

// Tabs whose whole content reads money tables field roles cannot see.
const MONEY_ONLY_TABS = new Set(['quote', 'change_orders'])

/** Filter and relabel the stage's tabs for the viewer's role. */
export function tabsForRole<T extends DetailTab>(tabs: T[], canSeeMoney: boolean): T[] {
  if (canSeeMoney) return tabs
  return tabs
    .filter((t) => !MONEY_ONLY_TABS.has(t.id))
    .map((t) => (t.id === 'financials' ? { ...t, label: 'Expenses' } : t))
}

/**
 * The tab to render: the requested one when the viewer can open it,
 * otherwise Overview, which every stage and every role has.
 */
export function pickVisibleTab(requested: string | null | undefined, visible: DetailTab[]): string {
  return requested && visible.some((t) => t.id === requested) ? requested : 'overview'
}

/**
 * Who may edit a job's change orders, draws and insurance claim. In a
 * company that is any owner, admin or manager of the job's company, not
 * only the teammate who created the job (they all manage the same book).
 * Without a company it is the job's creator. Crew and foreman never edit
 * these; the database refuses them too.
 */
export function canEditJobMoney(args: {
  contactUserId?: string | null
  contactOrgId?: string | null
  userId?: string | null
  orgId?: string | null
  canCreateFinancialDocs: boolean
}): boolean {
  const isCreator = !!args.userId && args.contactUserId === args.userId
  if (!args.orgId) return isCreator
  if (!args.canCreateFinancialDocs) return false
  if (!args.contactOrgId) return isCreator
  return args.contactOrgId === args.orgId
}
