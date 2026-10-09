import { useState } from 'react'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { toastError } from '../lib/toast.ts'
import type { OrgRole } from '../lib/permissions.ts'

const ROLE_LABEL: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  foreman: 'Foreman',
  crew: 'Crew'
}

/**
 * Workspace picker for people who belong to more than one company (an
 * owner who also works on another contractor's crew, say). Renders
 * nothing for a single membership. Switching reloads every screen for
 * the chosen company and is remembered on this device.
 */
export default function OrgSwitcher() {
  const { memberships, orgId, switchOrg } = useMembership()
  const [busy, setBusy] = useState(false)

  if (memberships.length < 2) return null

  async function onChange(nextOrgId: string) {
    if (!nextOrgId || nextOrgId === orgId) return
    setBusy(true)
    try {
      await switchOrg(nextOrgId)
    } catch {
      toastError("Couldn't switch workspace", 'Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 12,
          fontWeight: 700,
          color: 'var(--ink-muted)'
        }}
      >
        Workspace
      </span>
      <select
        value={orgId ?? ''}
        onChange={(event) => { void onChange(event.target.value) }}
        disabled={busy}
        style={{
          padding: '12px 12px',
          borderRadius: 10,
          background: 'var(--surface-2)',
          border: '1px solid var(--rule)',
          color: 'var(--ink-strong)',
          fontFamily: 'var(--font-body)',
          fontSize: 14,
          outline: 'none',
          width: '100%',
          boxSizing: 'border-box'
        }}
      >
        {memberships.map((m) => (
          <option key={m.orgId} value={m.orgId}>
            {m.orgName || 'Unnamed company'} ({ROLE_LABEL[m.role] || m.role})
          </option>
        ))}
      </select>
    </label>
  )
}
