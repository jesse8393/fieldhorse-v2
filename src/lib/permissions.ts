// permissions.ts — pure role-permission helpers.
//
// One source of truth for "what can role X do?". Lives outside React
// so server code (edge functions), tests, and React both consume the
// same answers.
//
// The roles come from the public.org_role Postgres enum created in
// migration 032 (CREW_PORTAL_FOUNDATION):
//
//   owner    — everything, including billing + delete
//   admin    — everything except billing + delete
//   manager  — their crews + their jobs, financials visible
//   foreman  — their crews + their jobs, financials hidden
//   crew     — own shifts, own time, own tasks only
//
// `null` / undefined means "not a member of any org yet" — the same
// gating as an unauthenticated visitor. Helpers all return `false`
// for null so a missing role fails closed.

export type OrgRole = 'owner' | 'admin' | 'manager' | 'foreman' | 'crew'

export const ORG_ROLES: OrgRole[] = ['owner', 'admin', 'manager', 'foreman', 'crew']

// Loose accept so the helpers also work on the raw enum string from
// Supabase (which is `string` after JSON serialization).
type MaybeRole = OrgRole | string | null | undefined

function is(role: MaybeRole, ...allowed: OrgRole[]): boolean {
  if (!role) return false
  return allowed.includes(role as OrgRole)
}

// ─── identity ───────────────────────────────────────────────
export const isOwner       = (r: MaybeRole) => is(r, 'owner')
export const isAdmin       = (r: MaybeRole) => is(r, 'admin')
export const isManager     = (r: MaybeRole) => is(r, 'manager')
export const isForeman     = (r: MaybeRole) => is(r, 'foreman')
export const isCrew        = (r: MaybeRole) => is(r, 'crew')
export const isOwnerOrAdmin = (r: MaybeRole) => is(r, 'owner', 'admin')

// ─── capability gates ───────────────────────────────────────
// Each capability maps to the smallest set of roles allowed. Keep the
// gates narrow — UI can opt to show "Not connected" rather than crash
// when a role lacks a permission.

/** See $$ amounts, margins, AR balances, payment history, invoices. */
export const canSeeFinancials   = (r: MaybeRole) => is(r, 'owner', 'admin', 'manager')

/** Add / remove / role-edit org members. */
export const canManageTeam      = (r: MaybeRole) => is(r, 'owner', 'admin')

/** See every job in the org, not just jobs you're assigned to. */
export const canSeeAllJobs      = (r: MaybeRole) => is(r, 'owner', 'admin')

/** Edit company profile, brand, services, location, templates. */
export const canEditSettings    = (r: MaybeRole) => is(r, 'owner', 'admin')

/** Send org invites (org_invites row insert). */
export const canInviteMembers   = (r: MaybeRole) => is(r, 'owner', 'admin')

/** Approve weekly timesheets, push to payroll. */
export const canApproveTimesheets = (r: MaybeRole) => is(r, 'owner', 'admin', 'manager')

/** Delete jobs/clients/etc + change billing settings. Owner-only per spec. */
export const canBillOrDelete    = (r: MaybeRole) => is(r, 'owner')

/** Create estimates, change orders, invoices, payments. */
export const canCreateFinancialDocs = (r: MaybeRole) => is(r, 'owner', 'admin', 'manager')

/** See subs + vendor profiles + insurance docs. */
export const canManageSubs      = (r: MaybeRole) => is(r, 'owner', 'admin', 'manager')

/** Crew portal: punch in/out, see own schedule, mark own tasks done. */
export const canDoFieldWork     = (r: MaybeRole) =>
  is(r, 'owner', 'admin', 'manager', 'foreman', 'crew')

// ─── route-level gate (used by sidebar + route guards later) ────
/**
 * Convenience map: "can this role land on this route's primary view?"
 * Routes not listed here are open to everyone with a membership.
 *
 * IMPORTANT: this is NOT the final RLS check. Even if a UI shows a
 * link, the database RLS policies are the real gate. These helpers
 * just hide things that would otherwise be a dead navigation.
 */
export function canViewRoute(role: MaybeRole, route: string): boolean {
  if (!role) return false
  switch (route) {
    case '/':
    case '/home':           return true                            // home redirects foreman/crew to /crew (handled in screen)
    case '/crew':           return canDoFieldWork(role)            // everyone with a role; crew/foreman LAND here
    case '/jobs':           return true                            // role-filtered in-view
    case '/clients':        return canSeeAllJobs(role)             // crew/foreman don't browse the client list
    case '/notes':          return true                            // field reports — everyone can read+write their own
    case '/schedule':       return true                            // role-filtered in-view
    case '/activity':       return true                            // notifications hub
    case '/bid':            return canCreateFinancialDocs(role)    // estimate builder
    case '/compose':        return canSeeFinancials(role)          // client comms
    case '/analytics':      return canSeeFinancials(role)
    case '/import':         return isOwnerOrAdmin(role)
    case '/settings':       return isOwnerOrAdmin(role)
    case '/pour-window':    return true
    case '/subs':           return canManageSubs(role)
    case '/partners':       return canManageSubs(role)
    case '/invoices':       return canSeeFinancials(role)
    case '/team':           return true                            // roster visible to all org members; mutations gated separately
    default:                return true
  }
}
