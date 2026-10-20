// Invite a teammate, /team/invite (Phase 9, Task 14, D57). It took the
// place of the invite dialog on the Team page: an email and a role, one
// gold Create invite, then the accept link to copy and Done back to Team.
// Only roles strictly below the caller's tier can be invited, mirroring
// the server guard in org-invite-create.js, so an admin cannot mint an
// owner or another admin from here.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Field } from '../components/fh'
import CreateShell, { Choices } from './new/CreateShell.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { orgInviteCreate } from '../lib/orgApi.ts'
import type { OrgRole } from '../lib/permissions.ts'
import { ORG_ROLES } from '../lib/permissions.ts'
import { toastError, toastSuccess } from '../lib/toast.ts'
import { hapticMedium, hapticTap } from '../lib/haptics.ts'

const ROLE_TIER: Record<string, number> = { crew: 0, foreman: 1, manager: 2, admin: 3, owner: 4 }

function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

export default function TeamInvite() {
  const navigate = useNavigate()
  const { role: callerRole, canInviteMembers } = useMembership()
  const callerTier = ROLE_TIER[callerRole || ''] ?? 0
  const invitableRoles = ORG_ROLES.filter((r) => (ROLE_TIER[r] ?? 0) < callerTier)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<OrgRole>('crew')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [acceptUrl, setAcceptUrl] = useState<string | null>(null)

  function goBack() {
    hapticTap()
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/team', { replace: true })
  }

  async function create() {
    if (sending) return
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) {
      setError('Enter the teammate’s email.')
      return
    }
    setSending(true)
    setError(undefined)
    try {
      const res = await orgInviteCreate(trimmed, role)
      hapticMedium()
      setAcceptUrl(res.accept_url)
    } catch (e: any) {
      setError(e?.detail || e?.message || 'Could not create the invite.')
    } finally {
      setSending(false)
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toastSuccess('Link copied')
    } catch {
      toastError('Copy failed, touch and hold to copy')
    }
  }

  if (!canInviteMembers) {
    return (
      <CreateShell title="Invite teammate" saveLabel="Back to Team" backTo="/team" onSave={goBack}>
        <p className="fhnew-lede">Only an owner, admin or manager can invite teammates.</p>
      </CreateShell>
    )
  }

  if (acceptUrl) {
    return (
      <CreateShell title="Invite created" saveLabel="Done" backTo="/team" onSave={goBack}>
        <p className="fhnew-lede">Share this link with {email.trim().toLowerCase()}. It signs them in as {role}.</p>
        <Field label="Invite link" value={acceptUrl} readOnly onChange={() => {}} onFocus={(e) => e.currentTarget.select()} />
        <div className="fhnew-rows">
          <Button variant="secondary" size="lg" onClick={() => copy(acceptUrl)}>Copy link</Button>
        </div>
      </CreateShell>
    )
  }

  return (
    <CreateShell title="Invite teammate" saveLabel="Create invite" saving={sending} error={error} backTo="/team" onSave={create}>
      <p className="fhnew-lede">Add someone to the field. They get a link that signs them in with the role you pick.</p>
      <Field
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="off"
        value={email}
        placeholder="teammate@company.com"
        onChange={(e) => { setEmail(e.target.value); setError(undefined) }}
      />
      <Choices
        label="Role"
        options={invitableRoles.map((r) => ({ value: r, label: capitalize(r) }))}
        value={role}
        onChange={(v) => setRole((v || role) as OrgRole)}
      />
    </CreateShell>
  )
}
