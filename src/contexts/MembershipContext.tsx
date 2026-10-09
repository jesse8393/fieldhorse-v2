// MembershipContext, single source of truth for the current user's
// organization + role.
//
// Reads on signin:
//   1. own rows in public.org_members  (RLS: org_members_self_read,
//      a direct user_id = auth.uid() check, no self-recursion)
//   2. the matching public.organizations rows (RLS:
//      organizations_member_read, an EXISTS against org_members)
//
// A user can belong to more than one org (an owner who also accepted a
// crew invite, say). The current workspace is picked by
// lib/activeOrg.ts: the choice saved on this device, then an org the
// user owns, then the most recently joined. switchOrg() changes it.
// The pick is also handed to lib/supabase.ts (setActiveOrgId) so every
// REST request names the workspace the UI is showing, and to
// lib/orgApi.ts (setOrgApiOrgId) so the org-* functions act on it too.
//
// What this DOES expose:
//   orgId, orgName, role, memberId, joinedAt, memberships, loading, error
//   plus permission helpers from lib/permissions.ts pre-bound to role.
//
// What this does NOT do:
//   - mutate org membership (writes go through edge functions per the
//     Phase 3 plan to keep RLS recursion-safe)
//   - decide what queries see, that stays in the data layer; the
//     context only answers "who am I, and what role do I have?"
//   - load anything for an unauthenticated user (returns nulls)

import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { supabase, setActiveOrgId, getActiveOrgId } from '../lib/supabase.ts'
import { setOrgApiOrgId } from '../lib/orgApi.ts'
import { queryClient } from '../lib/queryClient.ts'
import { pickActiveMembership, readStoredOrgId, writeStoredOrgId } from '../lib/activeOrg.ts'
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

// One entry per active membership, for the workspace switcher.
export type MembershipSummary = {
  orgId: string
  orgName: string | null
  role: OrgRole
  joinedAt: string
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
  // Every active membership, newest first. More than one means the
  // user can switch workspaces (switchOrg).
  memberships: MembershipSummary[]
  // Active (non revoked) members in the picked org. Owners/admins/
  // managers see the true count (org_members_financial_roles_read);
  // crew RLS only returns their own row, so for them this reads 1,
  // which is fine: hasCrew only drives owner-facing nav.
  memberCount: number
  hasCrew: boolean
  // True when this user is an accepted partner (sub) on at least one
  // job. Role holders normally lose the Sub Portal nav entry; partners
  // keep it, because they work both sides.
  isPartner: boolean
  // refreshable
  refresh: () => Promise<void>
  // Make another of the user's memberships the current workspace.
  switchOrg: (orgId: string) => Promise<void>
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
    memberships: [],
    memberCount: 0,
    hasCrew: false,
    isPartner: false,
    refresh: async () => {},
    switchOrg: async () => {},
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

function errorMessage(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback
}

// The REST header and the org-* functions must always name the same
// workspace. Called synchronously wherever the pick is made or changes
// (not from an effect), so no screen ever loads once without it.
function applyActiveOrg(orgId: string | null) {
  setActiveOrgId(orgId)
  setOrgApiOrgId(orgId)
}

export function MembershipProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [membership, setMembership] = useState<MembershipRow | null>(null)
  const [org, setOrg] = useState<OrgRow | null>(null)
  const [memberships, setMemberships] = useState<MembershipSummary[]>([])
  const [memberCount, setMemberCount] = useState<number>(0)
  const [isPartner, setIsPartner] = useState<boolean>(false)
  // The user whose first load has finished. Until it matches the signed
  // in user, consumers see loading, even on the render before the fetch
  // effect runs, so nobody routes on the previous user's (or no) role.
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null)
  const loadedUserIdRef = useRef<string | null>(null)
  // Tracks the auth user a fetch was started for. An in-flight fetch for
  // user A can resolve after a fast sign-out→sign in to user B; without
  // this guard the stale response would overwrite B's org/role. Mirrors
  // the pattern in ProfileContext.
  const activeUserIdRef = useRef<string | null>(null)
  // Only the newest fetch may write state (a refetch and a workspace
  // switch can overlap).
  const fetchSeqRef = useRef(0)
  const latestFetchRef = useRef<Promise<void> | null>(null)
  const lastFetchFailedRef = useRef(false)
  // The workspace picked with switchOrg in this session. Wins over the
  // stored choice, so a switch sticks even where storage is blocked.
  const preferredOrgIdRef = useRef<string | null>(null)
  const rowsRef = useRef<MembershipRow[]>([])
  const orgsRef = useRef<Record<string, OrgRow>>({})

  const runFetch = useCallback(async (seq: number) => {
    const uid = userId
    const stale = () => fetchSeqRef.current !== seq || activeUserIdRef.current !== uid

    if (!uid) {
      applyActiveOrg(null)
      setMembership(null)
      setOrg(null)
      setMemberships([])
      setMemberCount(0)
      setIsPartner(false)
      setLoading(false)
      setError(null)
      return
    }

    const settle = (message: string | null) => {
      lastFetchFailedRef.current = Boolean(message)
      loadedUserIdRef.current = uid
      setLoadedUserId(uid)
      setError(message)
      setLoading(false)
    }

    // Only the first load for this user shows as loading. Refetches
    // (back online, refresh() after accepting an invite, a workspace
    // switch) run silently so screens that wait on loading never
    // unmount and keep their state.
    if (loadedUserIdRef.current !== uid) {
      setLoading(true)
      setError(null)
    }

    try {
      // Step 1, own membership row(s). RLS policy `org_members_self_read`
      // permits a direct read where user_id = auth.uid() with no
      // self-recursion (per migration 034 fix).
      const memberQuery = await supabase
        .from('org_members')
        .select('id, org_id, role, joined_at, revoked_at')
        .eq('user_id', uid)
        .is('revoked_at', null)
        .order('joined_at', { ascending: false })

      // Drop the response if the auth user changed while we were waiting.
      if (stale()) return

      if (memberQuery.error) {
        console.warn('[fieldhorse] membership fetch error', memberQuery.error)
        settle(memberQuery.error.message || 'Could not load your workspace')
        return
      }

      const rows = (memberQuery.data || []) as MembershipRow[]
      rowsRef.current = rows
      if (rows.length === 0) {
        // Authenticated but not in any org: a brand new signup before
        // onboarding, or a partner (sub) who only works other people's
        // jobs.
        applyActiveOrg(null)
        setMembership(null)
        setOrg(null)
        setMemberships([])
        setMemberCount(0)
        settle(null)
        return
      }

      const picked = pickActiveMembership(rows, preferredOrgIdRef.current ?? readStoredOrgId()) as MembershipRow
      applyActiveOrg(picked.org_id)
      setMembership(picked)

      // Step 2, the org rows (names for the current org and the
      // switcher). RLS policy `organizations_member_read` permits each
      // read because every id comes from my own org_members rows.
      const orgQuery = await supabase
        .from('organizations')
        .select('id, name, slug')
        .in('id', rows.map((r) => r.org_id))

      if (stale()) return

      if (orgQuery.error) {
        console.warn('[fieldhorse] org fetch error', orgQuery.error)
        settle(orgQuery.error.message || 'Could not load your workspace')
        return
      }

      const orgsById: Record<string, OrgRow> = {}
      for (const o of (orgQuery.data || []) as OrgRow[]) orgsById[o.id] = o
      orgsRef.current = orgsById
      setOrg(orgsById[picked.org_id] || null)
      setMemberships(rows.map((r) => ({
        orgId: r.org_id,
        orgName: orgsById[r.org_id]?.name ?? null,
        role: r.role,
        joinedAt: r.joined_at,
      })))

      // Step 3, active member count for the picked org (drives the
      // solo-mode nav: crew screens only appear when hasCrew).
      const { count } = await supabase
        .from('org_members')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', picked.org_id)
        .is('revoked_at', null)
      if (stale()) return
      setMemberCount(count ?? 1)

      // Step 4, accepted partnerships (RLS: partner_user_id = auth.uid()).
      // Keeps the Sub Portal nav entry visible for role holders who also
      // sub on other contractors' jobs.
      const { count: partnerCount } = await supabase
        .from('fh_job_partners')
        .select('*', { count: 'exact', head: true })
        .eq('partner_user_id', uid)
        .not('accepted_at', 'is', null)
      if (stale()) return
      setIsPartner((partnerCount ?? 0) > 0)
      settle(null)
    } catch (e) {
      if (stale()) return
      console.warn('[fieldhorse] membership fetch failed', e)
      settle(errorMessage(e, 'Could not load your workspace'))
    }
  }, [userId])

  // Resolves once the newest fetch has settled, so callers of refresh()
  // (OrgInvite, Onboarding) navigate on the final state even when a
  // refetch overlapped theirs.
  const fetchMembership = useCallback((): Promise<void> => {
    const seq = ++fetchSeqRef.current
    const settled: Promise<void> = runFetch(seq).then(() => {
      const latest = latestFetchRef.current
      if (fetchSeqRef.current !== seq && latest && latest !== settled) return latest
    })
    latestFetchRef.current = settled
    return settled
  }, [runFetch])

  // On user change: forget the previous user's org (and the workspace
  // header) before anything else can render or fetch with it, then load.
  // Keyed on the user id, not the session, so a token refresh does not
  // refetch anything.
  useEffect(() => {
    activeUserIdRef.current = userId
    loadedUserIdRef.current = null
    preferredOrgIdRef.current = null
    rowsRef.current = []
    orgsRef.current = {}
    lastFetchFailedRef.current = false
    applyActiveOrg(null)
    setLoadedUserId(null)
    setMembership(null)
    setOrg(null)
    setMemberships([])
    setMemberCount(0)
    setIsPartner(false)
    void fetchMembership()
  }, [userId, fetchMembership])

  // Retry quietly when the network comes back (an offline cold open
  // leaves the membership unresolved), and when the app returns to the
  // foreground after a failed load.
  useEffect(() => {
    if (!userId) return
    const onOnline = () => { void fetchMembership() }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && lastFetchFailedRef.current) void fetchMembership()
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [userId, fetchMembership])

  const switchOrg = useCallback(async (orgId: string) => {
    const row = rowsRef.current.find((r) => r.org_id === orgId)
    if (!userId || !row) return
    preferredOrgIdRef.current = orgId
    writeStoredOrgId(orgId)
    if (getActiveOrgId() !== orgId) {
      applyActiveOrg(orgId)
      setMembership(row)
      setOrg(orgsRef.current[orgId] || null)
      // Cached lists belong to the workspace we just left. Reset them so
      // mounted screens drop that data and refetch for this one.
      void queryClient.resetQueries().catch(() => {})
    }
    // Member count, partner flag and names for the new pick.
    await fetchMembership()
  }, [userId, fetchMembership])

  // Memoized so a token-refresh onAuthStateChange doesn't rebuild the
  // value object + cascade a full-app re-render through every consumer.
  // The unauthenticated case is handled inside so the hook order stays
  // stable (no early return between hooks).
  const value = useMemo<MembershipContextValue>(() => {
    if (!userId) return emptyValue(false, null)
    const role = membership?.role ?? null
    return {
      loading: loading || loadedUserId !== userId,
      error,
      orgId: membership?.org_id ?? null,
      orgName: org?.name ?? null,
      orgSlug: org?.slug ?? null,
      role,
      memberId: membership?.id ?? null,
      joinedAt: membership?.joined_at ?? null,
      memberships,
      memberCount,
      hasCrew: memberCount > 1,
      isPartner,
      refresh: fetchMembership,
      switchOrg,
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
  }, [userId, loading, loadedUserId, error, membership, org, memberships, memberCount, isPartner, fetchMembership, switchOrg])

  return <MembershipContext.Provider value={value}>{children}</MembershipContext.Provider>
}

export function useMembership() {
  const ctx = useContext(MembershipContext)
  if (!ctx) throw new Error('useMembership must be used inside MembershipProvider')
  return ctx
}
