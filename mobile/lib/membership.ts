// mobile/lib/membership.ts
//
// The signed-in person's company and role, and whether they may see money.
// Mirrors the web MembershipContext: own org_members rows, the active one
// picked the same way (src/lib/activeOrg.ts), then fh_money_visible for that
// company, the database's own answer (false for foreman and crew). Money
// stays hidden while this is loading or when it fails, so a crew member
// never sees amounts by accident.

import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { pickActiveMembership } from '../../src/lib/activeOrg'

export type Membership = { orgId: string | null; role: string | null; moneyVisible: boolean }

async function fetchMembership(userId: string): Promise<Membership> {
  const { data, error } = await supabase.from('org_members')
    .select('org_id, role, joined_at')
    .eq('user_id', userId)
    .is('revoked_at', null)
  if (error) throw error
  const active = pickActiveMembership((data ?? []) as { org_id: string; role: string; joined_at: string }[], null)
  // Not in a company yet: every record is the person's own.
  if (!active) return { orgId: null, role: null, moneyVisible: true }
  const { data: visible, error: rpcError } = await supabase.rpc('fh_money_visible', { p_org_id: active.org_id })
  if (rpcError) throw rpcError
  return { orgId: active.org_id, role: active.role, moneyVisible: visible === true }
}

export function useMembership(userId: string | undefined) {
  return useQuery({
    queryKey: ['membership', userId],
    queryFn: () => fetchMembership(userId as string),
    enabled: !!userId,
    staleTime: 5 * 60_000,
    // A failed check hides money; it does not replace the app.
    throwOnError: false
  })
}

export function moneyVisible(membership: Membership | undefined | null): boolean {
  return membership?.moneyVisible === true
}

export function useMoneyVisible(userId: string | undefined): boolean {
  return moneyVisible(useMembership(userId).data)
}
