// MembershipContext — single source of truth for the current user's
// organization + role.
//
// Reads two rows on signin:
//   1. own row in public.org_members  (RLS: org_members_self_read,
//      a direct user_id = auth.uid() check — no self-recursion)
//   2. the matching public.organizations row by org_id (RLS:
//      organizations_member_read, an EXISTS against org_members)
//
// Migration 032 backfilled exactly one membership per existing user
// (each user owns an org-of-one), so today this returns one row. When
// the user is later added to additional orgs, we pick the most
// recently-joined non-revoked membership as "current" and persist the
// choice in localStorage so an org switcher can later flip it.
//
// What this DOES expose:
//   orgId, orgName, role, memberId, joinedAt, loading, error
//   plus permission helpers from lib/permissions.ts pre-bound to role.
//
// What this does NOT do:
//   - mutate org membership (writes go through edge functions per the
//     Phase 3 plan to keep RLS recursion-safe)
//   - decide what queries see — that stays in the data layer; the
//     context only answers "who am I, and what role do I have?"
//   - load anything for an unauthenticated user (returns nulls)

import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase.ts'
import { useAuth } from './AuthContext.tsx'
import {
  type OrgRole,
  canSeeFinancials,
  canManageTeam,
  canSeeAllJobs,
  canEditSettings,
  canInviteMembers,
  canApproveTimesheets,
  canBillOrDelete,
  canCreateFinancialDocs,
  canManageSubs,
  canDoFieldWork,
  isOwner,
  isAdmin,
  isOwnerOrAdmin,
  canViewRoute,
} from '../lib/permissions.ts'

type MembershipRow = {
  id: string
  org_id: string
  role: OrgRole
  joined_at: string
  revoked_at: string | null
}

type OrgRow = {
  id: string
  name: string
  slug: string | null
}

type MembershipContextValue = {
  // raw data
  loading: boolean
  error: string | null
  orgId: string | null
  orgName: string | null
  orgSlug: string | null
  role: OrgRole | null
  memberId: string | null
  joinedAt: string | null
  // Active (non revoked) members in the picked org. Owners/admins/
  // managers see the true count (org_members_financial_roles_read);
  // crew RLS only returns their own row, so for them this reads 1,
  // which is fine: hasCrew only drives owner-facing nav.
  memberCount: number
  hasCrew: boolean
  // refreshable
  refresh: () => Promise<void>
  // bound permission helpers (read role from context, no arg needed)
  isOwner: boolean
  isAdmin: boolean
  isOwnerOrAdmin: boolean
  canSeeFinancials: boolean
  canManageTeam: boolean
  canSeeAllJobs: boolean
  canEditSettings: boolean
  canInviteMembers: boolean
  canApproveTimesheets: boolean
  canBillOrDelete: boolean
  canCreateFinancialDocs: boolean
  canManageSubs: boolean
  canDoFieldWork: boolean
  // route helper
  canViewRoute: (path: string) => boolean
}

const CURRENT_ORG_KEY = 'fh:currentOrgId'

const MembershipContext = createContext<MembershipContextValue | null>(null)

function emptyValue(loading: boolean, error: string | null): MembershipContextValue {
  return {
    loading,
    error,
    orgId: null,
    orgName: null,
    orgSlug: null,
    role: null,
    memberId: null,
    joinedAt: null,
    memberCount: 0,
    hasCrew: false,
    refresh: async () => {},
    isOwner: false,
    isAdmin: false,
    isOwnerOrAdmin: false,
    canSeeFinancials: false,
    canManageTeam: false,
    canSeeAllJobs: false,
    canEditSettings: false,
    canInviteMembers: false,
    canApproveTimesheets: false,
    canBillOrDelete: false,
    canCreateFinancialDocs: false,
    canManageSubs: false,
    canDoFieldWork: false,
    canViewRoute: () => false,
  }
}

export function MembershipProvider({ children }: { children: ReactNode }) {
  const { user, session } = useAuth()
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [membership, setMembership] = useState<MembershipRow | null>(null)
  const [org, setOrg] = useState<OrgRow | null>(null)
  const [memberCount, setMemberCount] = useState<number>(0)
  // Tracks the auth user a fetch was started for. An in-flight fetch for
  // user A can resolve after a fast sign-out→sign-in to user B; without
  // this guard the stale response would overwrite B's org/role. Mirrors
  // the pattern in ProfileContext.
  const activeUserIdRef = useRef<string | null>(null)

  const fetchMembership = useCallback(async () => {
    if (!user) {
      setMembership(null)
      setOrg(null)
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    // Step 1 — own membership row(s). RLS policy `org_members_self_read`
    // permits a direct read where user_id = auth.uid() with no
    // self-recursion (per migration 034 fix).
    const memberQuery = await supabase
      .from('org_members')
      .select('id, org_id, role, joined_at, revoked_at')
      .eq('user_id', user.id)
      .is('revoked_at', null)
      .order('joined_at', { ascending: false })

    // Drop the response if the auth user changed while we were waiting.
    if (activeUserIdRef.current !== user.id) return

    if (memberQuery.error) {
      console.warn('[fieldhorse] membership fetch error', memberQuery.error)
      setError(memberQuery.error.message)
      setLoading(false)
      return
    }

    const rows = (memberQuery.data || []) as MembershipRow[]
    if (rows.length === 0) {
      // Authenticated but not yet in any org. Migration 032 backfilled
      // org-of-one for every user that existed when it ran, so this is
      // an edge case for brand-new signups before backfill runs.
      setMembership(null)
      setOrg(null)
      setLoading(false)
      return
    }

    // Persisted org choice if the user has multiple. Falls back to the
    // most recently joined.
    const stored = typeof window !== 'undefined'
      ? window.localStorage.getItem(CURRENT_ORG_KEY)
      : null
    const picked = (stored && rows.find((r) => r.org_id === stored)) || rows[0]
    setMembership(picked)

    // Step 2 — the org row. RLS policy `organizations_member_read`
    // permits this read because picked.org_id matches my org_members
    // row above.
    const orgQuery = await supabase
      .from('organizations')
      .select('id, name, slug')
      .eq('id', picked.org_id)
      .maybeSingle()

    // Drop the response if the auth user changed while we were waiting.
    if (activeUserIdRef.current !== user.id) return

    if (orgQuery.error) {
      console.warn('[fieldhorse] org fetch error', orgQuery.error)
      setError(orgQuery.error.message)
      setLoading(false)
      return
    }

    setOrg((orgQuery.data as OrgRow | null) || null)

    // Step 3 — active member count for the picked org (drives the
    // solo-mode nav: crew screens only appear when hasCrew).
    const { count } = await supabase
      .from('org_members')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', picked.org_id)
      .is('revoked_at', null)
    if (activeUserIdRef.current !== user.id) return
    setMemberCount(count ?? 1)
    setLoading(false)
  }, [user?.id])

  // Reset on user change so we never paint a previous user's org name.
  // Also re-point the stale-response guard at the new user.
  useEffect(() => {
    activeUserIdRef.current = user?.id ?? null
    setMembership(null)
    setOrg(null)
    setMemberCount(0)
  }, [user?.id])

  useEffect(() => {
    fetchMembership()
  }, [fetchMembership, session?.access_token])

  // Memoized so a token-refresh onAuthStateChange doesn't rebuild the
  // value object + cascade a full-app re-render through every consumer.
  // The unauthenticated case is handled inside so the hook order stays
  // stable (no early return between hooks).
  const value = useMemo<MembershipContextValue>(() => {
    if (!user) return emptyValue(false, null)
    const role = membership?.role ?? null
    return {
      loading,
      error,
      orgId: membership?.org_id ?? null,
      orgName: org?.name ?? null,
      orgSlug: org?.slug ?? null,
      role,
      memberId: membership?.id ?? null,
      joinedAt: membership?.joined_at ?? null,
      memberCount,
      hasCrew: memberCount > 1,
      refresh: fetchMembership,
      // bound helpers
      isOwner: isOwner(role),
      isAdmin: isAdmin(role),
      isOwnerOrAdmin: isOwnerOrAdmin(role),
      canSeeFinancials: canSeeFinancials(role),
      canManageTeam: canManageTeam(role),
      canSeeAllJobs: canSeeAllJobs(role),
      canEditSettings: canEditSettings(role),
      canInviteMembers: canInviteMembers(role),
      canApproveTimesheets: canApproveTimesheets(role),
      canBillOrDelete: canBillOrDelete(role),
      canCreateFinancialDocs: canCreateFinancialDocs(role),
      canManageSubs: canManageSubs(role),
      canDoFieldWork: canDoFieldWork(role),
      canViewRoute: (path: string) => canViewRoute(role, path),
    }
  }, [user, loading, error, membership, org, memberCount, fetchMembership])

  return <MembershipContext.Provider value={value}>{children}</MembershipContext.Provider>
}

export function useMembership() {
  const ctx = useContext(MembershipContext)
  if (!ctx) throw new Error('useMembership must be used inside MembershipProvider')
  return ctx
}
