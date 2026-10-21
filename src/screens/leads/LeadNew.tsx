// New lead (PHASE9_PLAN Task 8, SPEC D53, D59). A lead is information from
// a customer who has no quote yet. The only thing it needs is a name: type
// one, tap Save, land on the lead. The name is a ClientField, so a known
// customer is picked and an unknown one becomes a client in the same tap.

import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Field } from '../../components/fh'
import ClientField, { fetchClientPick, resolveClientId, type ClientFieldValue } from '../../components/ClientField.tsx'
import CreateShell, { Choices, LEAD_SOURCES, useDraft } from '../new/CreateShell.tsx'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useMembership } from '../../contexts/MembershipContext.tsx'
import { createLead } from '../../lib/leads.ts'
import { recordRoute } from '../../lib/records.ts'
import { hapticMedium } from '../../lib/haptics.ts'

type Form = {
  name: string
  clientId: string
  phone: string
  address: string
  title: string
  notes: string
  source: string
}

const EMPTY: Form = { name: '', clientId: '', phone: '', address: '', title: '', notes: '', source: '' }

export default function LeadNew() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { orgId } = useMembership()
  const [params] = useSearchParams()
  const clientParam = params.get('client')
  const text = params.get('text')
  const { form, set, patch, done } = useDraft<Form>('lead', EMPTY, text ? { notes: text } : null)
  const [client, setClient] = useState<ClientFieldValue>({ text: form.name, picked: null })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Opened from a client's page: that client is the name.
  useEffect(() => {
    if (!clientParam) return
    let alive = true
    void fetchClientPick(clientParam).then((c) => {
      if (!alive || !c) return
      setClient({ text: c.name, picked: c })
      patch({ name: c.name, clientId: c.id, phone: c.phone || '', address: c.address || '' })
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientParam])

  function onClient(next: ClientFieldValue) {
    setClient(next)
    patch({ name: next.text, clientId: next.picked?.id || '' })
  }

  async function save() {
    if (!user) return
    if (!client.text.trim()) { setError('Enter a name.'); return }
    setSaving(true)
    setError('')
    try {
      const picked = await resolveClientId(client, { userId: user.id, orgId }, { phone: form.phone, address: form.address })
      if (!picked) throw new Error('Enter a name.')
      const lead = await createLead({
        userId: user.id,
        orgId,
        clientId: picked.id,
        title: form.title,
        notes: form.notes,
        source: form.source
      })
      done()
      hapticMedium()
      navigate(recordRoute('lead', lead.id), { replace: true })
    } catch (e) {
      setSaving(false)
      setError(e instanceof Error && e.message ? e.message : 'Could not save this lead. Check your connection and try again.')
    }
  }

  return (
    <CreateShell title="New lead" saveLabel="Save lead" saving={saving} error={error} onSave={save}>
      <ClientField
        userId={user?.id}
        label="Name"
        placeholder="Who called"
        value={client}
        onChange={onClient}
        autoFocus
        onPick={(c) => patch({ phone: form.phone || c.phone || '', address: form.address || c.address || '' })}
      />
      <Field label="Phone" type="tel" inputMode="tel" autoComplete="off" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
      <Field label="Address" autoComplete="off" value={form.address} onChange={(e) => set('address', e.target.value)} />
      <Field label="What they need" placeholder="Shed slab, driveway, retaining wall" value={form.title} onChange={(e) => set('title', e.target.value)} />
      <Field label="Notes" multiline value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      <Choices label="Source" options={LEAD_SOURCES} value={form.source} onChange={(v) => set('source', v)} />
    </CreateShell>
  )
}
