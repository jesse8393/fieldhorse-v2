// src/lib/activeCompany.ts
//
// Which company a screen acts for. The jobs list (useJobs in
// lib/queries.ts) is not filtered by company: row level security returns
// every company the person belongs to plus the jobs a partner shared with
// them, because the Jobs list is meant to show all of those. A screen that
// acts on a job, by scheduling it, creating a record for it or counting
// its money, takes only the jobs of the active company: the workspace the
// person picked (MembershipContext, resolved by useOrgScope), or, for
// someone with no company, their own jobs. That is the same rule every org
// scoped query in lib/queries.ts applies on the server (`scoped`).
//
// Pure functions, no React and no network. The hooks that read the active
// company live in lib/queries.ts (useActiveCompany, useCompanyJobs).

import type { OrgScope } from './orgScope.ts'

export type ActiveCompany = {
  /** The active workspace, or null for someone who has no company. */
  orgId: string | null
  /** The signed in person; their own jobs count when there is no company. */
  userId: string
}

type CompanyFields = { org_id?: string | null; user_id?: string | null }

/** The active company once the person and their workspace are both known, else null. */
export function activeCompanyFrom(userId: string | null | undefined, scope: OrgScope): ActiveCompany | null {
  if (!userId || scope === undefined) return null
  return { orgId: scope || null, userId }
}

/**
 * True when a job belongs to the active company: its org_id is the active
 * org, or, when the person has no company, it is their own job. A job from
 * another company, a partner's shared job included, is false, and so is
 * every job while the company is not known yet.
 */
export function inActiveCompany(job: CompanyFields, company: ActiveCompany | null | undefined): boolean {
  if (!company) return false
  if (company.orgId) return job.org_id === company.orgId
  return !!job.user_id && job.user_id === company.userId
}

/** The rows that belong to the active company, in the order given. */
export function onlyActiveCompany<T extends CompanyFields>(rows: T[], company: ActiveCompany | null | undefined): T[] {
  if (!company) return []
  return rows.filter((row) => inActiveCompany(row, company))
}
