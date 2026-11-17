// New lead (PHASE9_PLAN Task 8, SPEC D53, D59). A lead is information from
// a customer who has no quote yet. The only thing it needs is a name: type
// one, tap Save, land on the lead. The name is a ClientField, so a known
// customer is picked and an unknown one becomes a client in the same tap.

import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Field } from '../../components/fh'
import ClientField, { fetchClientPick, resolveClientId, restoredClientValue, type ClientFieldValue } from '../../components/ClientField.tsx'
import CreateShell, { Choices, LEAD_SOURCES, useDraft } from '../new/CreateShell.tsx'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useMembership } from '../../contexts/MembershipContext.tsx'
import { createLead } from '../../lib/leads.ts'
import { createClientRow, lookupClientMatches, saveErrorMessage, syncClientContact, type ClientMatch } from '../../lib/clients.ts'
import { useInvalidateClientDetail, useInvalidateLeads } from '../../lib/queries.ts'
import { createUuid } from '../../lib/uuid.ts'
import { recordRoute } from '../../lib/records.ts'
import { hapticMedium } from '../../lib/haptics.ts'

type Form = {
  /** Ids minted once per form, so a retried save addresses the same rows (DATA-12). */
  requestId: string
  clientRequestId: string
  name: string
  clientId: string
  phone: string
  address: string
  title: string
  notes: string
  source: string
}

const EMPTY: Form = { requestId: '', clientRequestId: '', name: '', clientId: '', phone: '', address: '', title: '', notes: '', source: '' }

export default function LeadNew() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { orgId } = useMembership()
  const [params] = useSearchParams()
  const clientParam = params.get('client')
  const text = params.get('text')
  const [ids] = useState(() => ({ requestId: createUuid(), clientRequestId: createUuid() }))
  const { form, set, patch, done } = useDraft<Form>('lead', { ...EMPTY, ...ids }, text ? { notes: text } : null)
  const invalidateLeads = useInvalidateLeads()
  const invalidateClientDetail = useInvalidateClientDetail()
  const [client, setClient] = useState<ClientFieldValue>(() => restoredClientValue(form.name, form.clientId))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // A typed phone that belongs to a client with another name, or a known
  // name typed with a new phone: shown under the name, and the person picks
  // which client the lead goes to (S06). Cleared when the name or phone changes.
  const [conflict, setConflict] = useState<{ kind: 'contact' | 'name'; client: ClientMatch } | null>(null)

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
    setConflict(null)
    patch({ name: next.text, clientId: next.picked?.id || '' })
  }

  // The client the lead saves against. A picked client wins. Otherwise a
  // phone match with the same name, or a name match when no phone was
  // typed, is used; anything less certain is shown for the person to
  // choose. Null when the screen is waiting on that choice.
  async function chooseClient(choice?: { existing: string } | 'new'): Promise<{ id: string; created: boolean } | null> {
    if (!user) return null
    if (client.picked) return { id: client.picked.id, created: false }
    const typed = { name: client.text, phone: form.phone, address: form.address }
    if (choice && choice !== 'new') return { id: choice.existing, created: false }
    if (choice !== 'new') {
      const m = await lookupClientMatches(user.id, typed, orgId)
      const sameName = (c: ClientMatch | null) => !!c && c.name.trim().toLowerCase() === client.text.trim().toLowerCase()
      if (m.byContact && sameName(m.byContact)) return { id: m.byContact.id, created: false }
      if (m.byContact) { setConflict({ kind: 'contact', client: m.byContact }); return null }
      if (m.byName && m.contactTyped) { setConflict({ kind: 'name', client: m.byName }); return null }
      if (m.byName) return { id: m.byName.id, created: false }
    }
    const id = await createClientRow(user.id, typed, orgId, form.clientRequestId || undefined)
    if (!id) throw new Error('Enter a name.')
    return { id, created: true }
  }

  async function save(choice?: { existing: string } | 'new') {
    if (!user) return
    if (!client.text.trim()) { setError('Enter a name.'); return }
    setSaving(true)
    setError('')
    try {
      const chosen = await chooseClient(choice)
      if (!chosen) { setSaving(false); return }
      setConflict(null)
      const picked = await resolveClientId({ text: client.text, picked: { id: chosen.id, name: client.text } }, { userId: user.id, orgId })
      if (!picked) throw new Error('Enter a name.')
      // What was typed for an existing client goes onto that client, so the
      // lead (which reads the client's phone and address) shows it.
      if (!chosen.created) await syncClientContact(picked.id, { phone: form.phone, address: form.address })
      const lead = await createLead({
        id: form.requestId || undefined,
        userId: user.id,
        orgId,
        clientId: picked.id,
        title: form.title,
        notes: form.notes,
        source: form.source
      })
      done()
      // The Leads list, the lead and the client's page show it at once (DATA-13).
      invalidateLeads(lead.id)
      invalidateClientDetail(picked.id)
      hapticMedium()
      navigate(recordRoute('lead', lead.id), { replace: true })
    } catch (e) {
      setSaving(false)
      setError(saveErrorMessage(e, 'Could not save this lead. Check your connection and try again.'))
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
      <Field label="Phone" type="tel" inputMode="tel" autoComplete="off" value={form.phone} onChange={(e) => { setConflict(null); set('phone', e.target.value) }} />
      {conflict && (
        <div className="fhnew-match" role="status">
          <p className="fhnew-match__text">
            {conflict.kind === 'contact'
              ? `${form.phone.trim()} belongs to ${conflict.client.name}.`
              : `${conflict.client.name} is already a client, with a different phone.`}
            {' '}Which client is this lead for?
          </p>
          <div className="fhnew-match__actions">
            <Button type="button" variant="secondary" size="md" disabled={saving} onClick={() => { void save({ existing: conflict.client.id }) }}>
              Save to {conflict.client.name}
            </Button>
            <Button type="button" variant="secondary" size="md" disabled={saving} onClick={() => { void save('new') }}>
              Save as a new client
            </Button>
          </div>
        </div>
      )}
      <Field label="Address" autoComplete="off" value={form.address} onChange={(e) => set('address', e.target.value)} />
      <Field label="What they need" placeholder="Shed slab, driveway, retaining wall" value={form.title} onChange={(e) => set('title', e.target.value)} />
      <Field label="Notes" multiline value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      <Choices label="Source" options={LEAD_SOURCES} value={form.source} onChange={(v) => set('source', v)} />
    </CreateShell>
  )
}
