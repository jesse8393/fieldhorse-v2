// New job (PHASE9_PLAN Task 8, SPEC D53, D55, D59). A job needs a client
// and a title. It is an fh_contacts row at stage job, with the client's
// phone, email and address copied on so the job screen, the schedule and
// the invoice have them. The address comes from the client and can be
// changed for a job at another site.

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Field } from '../../components/fh'
import ClientField, { fetchClientPick, resolveClientId, restoredClientValue, type ClientFieldValue, type ClientPick } from '../../components/ClientField.tsx'
import CreateShell, { Choices, moneyInput, useDraft, writeDraft } from '../new/CreateShell.tsx'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useMembership } from '../../contexts/MembershipContext.tsx'
import type { ContactInsert } from '../../lib/quotes.ts'
import { createJob } from '../../lib/createJob.ts'
import { createUuid } from '../../lib/uuid.ts'
import { JOB_TYPES } from '../../lib/jobTypes.ts'
import { recordRoute } from '../../lib/records.ts'
import { hapticMedium } from '../../lib/haptics.ts'

type Form = {
  requestId: string
  client: string
  clientId: string
  title: string
  address: string
  jobType: string
  price: string
  scope: string
}

const EMPTY: Form = { requestId: '', client: '', clientId: '', title: '', address: '', jobType: '', price: '', scope: '' }

export default function JobNew() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { orgId } = useMembership()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const clientParam = params.get('client')
  const text = params.get('text')
  const [requestId] = useState(createUuid)
  const { form, set, patch, done } = useDraft<Form>('job', { ...EMPTY, requestId }, text ? { scope: text } : null)
  const [client, setClient] = useState<ClientFieldValue>(() => restoredClientValue(form.client, form.clientId))
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [errors, setErrors] = useState<{ client?: string; title?: string; save?: string }>({})

  function applyPick(c: ClientPick) {
    setClient({ text: c.name, picked: c })
    patch({ client: c.name, clientId: c.id, address: form.address || c.address || '' })
  }

  useEffect(() => {
    if (!clientParam) return
    let alive = true
    void fetchClientPick(clientParam).then((c) => { if (alive && c) applyPick(c) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientParam])

  function onClient(next: ClientFieldValue) {
    setClient(next)
    patch({ client: next.text, clientId: next.picked?.id || '' })
  }

  async function save() {
    if (!user || savingRef.current) return
    const next: typeof errors = {}
    if (!client.text.trim()) next.client = 'Enter a client.'
    if (!form.title.trim()) next.title = 'Enter a title, such as Driveway replacement.'
    if (next.client || next.title) { setErrors(next); return }
    savingRef.current = true
    // Save the intent before starting any request, including when a user
    // submits faster than the usual draft debounce or reloads after failure.
    writeDraft('job', form)
    setSaving(true)
    setErrors({})
    try {
      const picked = await resolveClientId(client, { userId: user.id, orgId }, { address: form.address })
      if (!picked) throw new Error('Enter a client.')
      const row: ContactInsert & { id: string } = {
        id: form.requestId,
        stage: 'job',
        user_id: user.id,
        org_id: orgId ?? null,
        client_id: picked.id,
        name: picked.name,
        phone: picked.phone ?? null,
        email: picked.email ?? null,
        address: form.address.trim() || picked.address || null,
        job_title: form.title.trim(),
        job_type: form.jobType || null,
        amount: Number(form.price) || 0,
        scope_text: form.scope.trim() || null,
        last_contact: new Date().toISOString()
      }
      const saved = await createJob(row)
      done()
      void queryClient.invalidateQueries()
      hapticMedium()
      navigate(recordRoute('job', saved.id), { replace: true })
    } catch (e) {
      savingRef.current = false
      setSaving(false)
      setErrors({ save: e instanceof Error && e.message ? e.message : 'Could not save this job. Check your connection and try again.' })
    }
  }

  return (
    <CreateShell title="New job" saveLabel="Save job" saving={saving} error={errors.save} onSave={save}>
      <ClientField userId={user?.id} value={client} onChange={onClient} error={errors.client} autoFocus={!clientParam} onPick={applyPick} />
      <Field label="Title" placeholder="Driveway replacement" value={form.title} error={errors.title} onChange={(e) => set('title', e.target.value)} />
      <Field label="Address" autoComplete="off" helper="From the client. Change it for another site." value={form.address} onChange={(e) => set('address', e.target.value)} />
      <Choices label="Job type" options={JOB_TYPES} value={form.jobType} onChange={(v) => set('jobType', v)} />
      <Field label="Price" inputMode="decimal" placeholder="0.00" value={form.price} onChange={(e) => set('price', moneyInput(e.target.value))} />
      <Field label="Scope" multiline placeholder="What the price covers" value={form.scope} onChange={(e) => set('scope', e.target.value)} />
    </CreateShell>
  )
}
