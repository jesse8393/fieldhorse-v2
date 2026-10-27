// Invite a partner to a job, /jobs/:id/partner (Phase 9, Task 13, D57). It
// took the place of the invite sheet: a name, an email and a role, with the
// people invited before one tap away. The invite goes through
// /api/partner-invite; when the email cannot be sent the link is shown
// here to copy or share.

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Field } from '../../components/fh'
import CreateShell, { Choices } from '../new/CreateShell.tsx'
import { authHeaders } from '../../lib/supabase.ts'
import { loadPastPartners, PARTNER_ROLES, type PastPartner } from '../../lib/partners.ts'
import { toastError, toastSuccess } from '../../lib/toast.ts'
import { hapticMedium, hapticTap } from '../../lib/haptics.ts'
import PartnerAccessDetails from '../../components/PartnerAccessDetails.tsx'
import { JobScreenFallback, useJobScreen } from './jobScreen.tsx'

const ROLES = PARTNER_ROLES.map((r) => ({ value: r, label: r }))

function friendlyInviteError(code: string) {
  if (code === 'server_misconfigured') return 'The server is not set up for invites yet.'
  if (code === 'forbidden_or_not_found') return 'Only a job of your own can take a partner.'
  if (code === 'db_insert_failed') return 'The database rejected the invite.'
  if (code === 'job_lookup_failed') return "Couldn't look up the job."
  if (code === 'invalid_email') return 'That email does not look right.'
  if (code === 'missing_fields') return 'Something required is missing.'
  return `The invite failed (${code}).`
}

export default function JobPartner() {
  const { id } = useParams()
  const { user, data, home, goBack } = useJobScreen(id)
  if (!data.contact || data.loading) return <JobScreenFallback title="Invite a partner" saveLabel="Send invite" data={data} home={home} />
  return <PartnerForm key={data.contact.id} contactId={data.contact.id} contactName={data.contact.name || ''} userId={user?.id} goBack={goBack} home={home} />
}

function PartnerForm({ contactId, contactName, userId, goBack, home }: {
  contactId: string
  contactName: string
  userId: string | undefined
  goBack: () => void
  home: string
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [readyUrl, setReadyUrl] = useState('')
  const [why, setWhy] = useState('')
  const [copied, setCopied] = useState(false)
  const [past, setPast] = useState<PastPartner[]>([])
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let alive = true
    void loadPastPartners({ excludeJobId: contactId, limit: 6 }).then((rows) => { if (alive) setPast(rows) })
    return () => { alive = false; if (copyTimer.current) clearTimeout(copyTimer.current) }
  }, [contactId])

  function pickPast(p: PastPartner) {
    hapticTap()
    setName(p.name || '')
    setEmail(p.email || '')
    setRole(p.role || '')
  }

  async function send() {
    if (sending) return
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Enter the email the invite goes to.')
      return
    }
    setSending(true)
    setError(undefined)
    try {
      const res = await fetch('/api/partner-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          job_id: contactId,
          invited_by_user_id: userId,
          partner_email: trimmed,
          partner_name: name.trim() || null,
          partner_role: role || null,
          send_email: true
        })
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const code = body?.error || `http_${res.status}`
        const detail = body?.detail || body?.hint
        throw new Error(friendlyInviteError(code))
      }
      hapticMedium()
      if (body?.sent) {
        toastSuccess('Invite sent', `${name.trim() || trimmed} will get the link shortly.`)
        goBack()
      } else if (body?.invite_url) {
        if (body?.sender_not_configured) setWhy('Email is not set up yet, so share the link yourself.')
        else if (body?.send_failed) setWhy('The email did not go out. Share the link yourself or retry later.')
        setReadyUrl(String(body.invite_url))
      } else {
        toastSuccess('Invite sent', `${trimmed} will get the link shortly.`)
        goBack()
      }
    } catch (e) {
      const message = (e as { message?: string })?.message || 'Check your connection and try again.'
      setError(message)
      toastError("Couldn't send invite", message)
    } finally {
      setSending(false)
    }
  }

  async function copyLink() {
    if (!readyUrl) return
    let wrote = false
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(readyUrl)
        wrote = true
      }
    } catch { /* fall through to the hand copy */ }
    if (wrote) {
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 2000)
      toastSuccess('Link copied', 'Paste it into a text or an email.')
    } else {
      toastError("Couldn't copy", 'Touch and hold the link above to copy it.')
    }
  }

  async function shareLink() {
    if (!readyUrl) return
    if (!navigator.share) { void copyLink(); return }
    try {
      const greeting = name.trim() ? `${name.trim()},\n\n` : ''
      await navigator.share({ title: 'Partner invite', text: `${greeting}Manage ${contactName || 'this job'} with me:\n\n${readyUrl}`, url: readyUrl })
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') toastError("Couldn't share", 'Copy the link instead.')
    }
  }

  if (readyUrl) {
    return (
      <CreateShell title="Invite ready" saveLabel="Done" backTo={home} onSave={goBack}>
        <p className="fhja-lede">
          Send this link to {name.trim() || 'your partner'}. It opens {contactName || 'this job'} only, nothing else from your account.
        </p>
        {why && <p className="fhja-note" role="status">{why}</p>}
        <p className="fhja-link">{readyUrl}</p>
        <div className="fhja-pair">
          <Button variant="secondary" onClick={() => { void copyLink() }}>{copied ? 'Copied' : 'Copy link'}</Button>
          <Button variant="secondary" onClick={() => { void shareLink() }}>Share</Button>
        </div>
      </CreateShell>
    )
  }

  return (
    <CreateShell title="Invite a partner" saveLabel="Send invite" saving={sending} error={error} backTo={home} onSave={send}>
      <p className="fhja-lede">
        Invite a trusted partner to {contactName || 'this job'}. Sharing includes this job, its linked customer details and job pricing.
      </p>
      {past.length > 0 && (
        <div className="fhja-recent">
          <span className="fhja-recent__label">Invited before</span>
          <div className="fhja-recent__row">
            {past.map((p) => (
              <Button key={p.email} variant="secondary" size="mini" onClick={() => pickPast(p)}>
                {p.name || p.email}
              </Button>
            ))}
          </div>
        </div>
      )}
      <Field label="Partner name" value={name} autoComplete="name" placeholder="Mike Reilly" onChange={(e) => setName(e.target.value)} />
      <Field
        label="Partner email"
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        placeholder="mike@example.com"
        error={error && !email.trim() ? error : undefined}
        onChange={(e) => { setEmail(e.target.value); setError(undefined) }}
      />
      <Choices label="Role on this job" options={ROLES} value={role} onChange={setRole} />
      <PartnerAccessDetails role={role} open />
    </CreateShell>
  )
}
