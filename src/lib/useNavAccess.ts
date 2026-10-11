import { useCallback } from 'react'
import { useMembership } from '../contexts/MembershipContext.tsx'

// Which navigation entries the signed in person may see. One rule for
// the dock, the workspace menu and the desktop sidebar:
//   * membership still loading: show everything except the Sub portal,
//     so the first paint never strips an owner's nav
//   * has a workspace role: canViewRoute decides, and the Sub portal
//     shows only for people who also sub on someone else's jobs
//   * settled with no role (sub only, or before onboarding): only the
//     Sub portal, so they never bounce off permission errors
export function useNavAccess() {
  const { canViewRoute, role, loading, isPartner, hasCrew } = useMembership()
  const canSee = useCallback(
    (to: string) => {
      const path = to.split('?')[0].split('#')[0]
      if (loading) return path !== '/sub-portal'
      if (role) {
        if (path === '/sub-portal') return isPartner
        return canViewRoute(path)
      }
      return path === '/sub-portal'
    },
    [canViewRoute, role, loading, isPartner]
  )
  return { canSee, hasCrew }
}
