// Add a sub to the trade directory, /subs/new (Phase 9, Task 14, D57). It
// took the place of the add sub drawer: the row goes into fh_subs with no
// job (contact_id null), so the new sub shows in the directory at once
// and is linked to a job later from that job's Subs section.
//
// Schema honest fields only (fh_subs columns: name, trade, phone). Rate
// stays at the schema default 0 and status at 'scheduled'; both mean
// nothing without a job, so they are not asked here.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Field } from '../components/fh'
import CreateShell from './new/CreateShell.tsx'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { supabase } from '../lib/supabase.ts'
import { useInvalidateSubs } from '../lib/queries.ts'
import { toastError, toastSuccess } from '../lib/toast.ts'
import { hapticSuccess } from '../lib/haptics.ts'

export default function SubNew() {
  const { user } = useAuth()
  const membership = useMembership()
  const navigate = useNavigate()
  const scopeOrgId = membership.loading ? undefined : membership.orgId
  const refresh = useInvalidateSubs(user?.id, scopeOrgId)
  const [name, setName] = useState('')
  const [trade, setTrade] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>()

  async function save() {
    if (saving || !user?.id) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter the sub or company name.')
      return
    }
    setSaving(true)
    setError(undefined)
    const { error: err } = await supabase.from('fh_subs').insert({
      user_id: user.id,
      org_id: scopeOrgId ?? null,
      contact_id: null,
      name: trimmed,
      trade: trade.trim() || null,
      phone: phone.trim() || null
    })
    if (err) {
      setSaving(false)
      setError(err.message || 'The sub was not saved.')
      toastError("Couldn't add sub", err.message)
      return
    }
    hapticSuccess()
    toastSuccess('Sub added', trimmed)
    await refresh()
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/subs', { replace: true })
  }

  return (
    <CreateShell title="New sub" saveLabel="Add sub" saving={saving} error={error} backTo="/subs" onSave={save}>
      <p className="fhnew-lede">Name is enough to start. Trade and phone help when you assign them to a job later.</p>
      <Field
        label="Name"
        value={name}
        placeholder="Crew lead or company"
        autoComplete="off"
        onChange={(e) => { setName(e.target.value); setError(undefined) }}
      />
      <Field label="Trade" value={trade} placeholder="Framer, electrician, roofer" onChange={(e) => setTrade(e.target.value)} />
      <Field label="Phone" type="tel" inputMode="tel" value={phone} placeholder="(615) 555-0000" onChange={(e) => setPhone(e.target.value)} />
    </CreateShell>
  )
}
