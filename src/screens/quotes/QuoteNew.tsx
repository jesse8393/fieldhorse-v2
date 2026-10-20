// New quote (PHASE9_PLAN Task 8, SPEC D53, D59, D60). A quote needs a
// client and nothing else; the lines come on the quote screen itself. No
// lead field appears here: a quote stands on its own, or points at the
// lead it came from when Quote this opened it (?lead=), in which case the
// client, title and notes are filled and the lead is marked quoted once
// the quote saves.

import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Field } from '../../components/fh'
import ClientField, { fetchClientPick, resolveClientId, type ClientFieldValue } from '../../components/ClientField.tsx'
import CreateShell, { Choices, useDraft } from '../new/CreateShell.tsx'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useMembership } from '../../contexts/MembershipContext.tsx'
import { supabase } from '../../lib/supabase.ts'
import { leadToQuoteDraft, markLeadQuoted, type LeadRow } from '../../lib/leads.ts'
import { createQuote } from '../../lib/quotes.ts'
import { JOB_TYPES } from '../../lib/jobTypes.ts'
import { hapticMedium } from '../../lib/haptics.ts'

type Form = {
  client: string
  clientId: string
  title: string
  jobType: string
  scope: string
}

const EMPTY: Form = { client: '', clientId: '', title: '', jobType: '', scope: '' }

export default function QuoteNew() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { orgId } = useMembership()
  const [params] = useSearchParams()
  const clientParam = params.get('client')
  const leadParam = params.get('lead')
  const text = params.get('text')
  const { form, set, patch, done } = useDraft<Form>('quote', EMPTY, text ? { scope: text } : null)
  const [client, setClient] = useState<ClientFieldValue>({ text: form.client, picked: null })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function pickClient(id: string) {
    return fetchClientPick(id).then((c) => {
      if (!c) return
      setClient({ text: c.name, picked: c })
      patch({ client: c.name, clientId: c.id })
    })
  }

  useEffect(() => {
    if (!clientParam) return
    void pickClient(clientParam)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientParam])

  // Quote this on a lead: its client, title and notes start the quote.
  useEffect(() => {
    if (!leadParam) return
    let alive = true
    void supabase.from('fh_leads').select('*').eq('id', leadParam).maybeSingle().then(({ data }) => {
      if (!alive || !data) return
      const draft = leadToQuoteDraft(data as LeadRow)
      patch({ title: draft.title || '', jobType: draft.job_type || '', scope: draft.scope_text || '' })
      if (draft.client_id) void pickClient(draft.client_id)
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadParam])

  function onClient(next: ClientFieldValue) {
    setClient(next)
    patch({ client: next.text, clientId: next.picked?.id || '' })
  }

  async function save() {
    if (!user) return
    if (!client.text.trim()) { setError('Enter a client.'); return }
    setSaving(true)
    setError('')
    try {
      const picked = await resolveClientId(client, { userId: user.id, orgId })
      if (!picked) throw new Error('Enter a client.')
      const quote = await createQuote({
        userId: user.id,
        orgId,
        clientId: picked.id,
        leadId: leadParam,
        title: form.title,
        scopeText: form.scope,
        jobType: form.jobType
      })
      if (leadParam) {
        try { await markLeadQuoted(leadParam, quote.id) } catch { /* the quote is saved; the lead keeps its status */ }
      }
      done()
      hapticMedium()
      // The quote screen opens with its line editor ready for the first line.
      navigate(`/quotes/${quote.id}?lines=new`, { replace: true })
    } catch (e) {
      setSaving(false)
      setError(e instanceof Error && e.message ? e.message : 'Could not save this quote. Check your connection and try again.')
    }
  }

  return (
    <CreateShell title="New quote" saveLabel="Save quote" saving={saving} error={error} onSave={save}>
      <ClientField userId={user?.id} value={client} onChange={onClient} autoFocus={!clientParam && !leadParam} />
      <Field label="Title" placeholder="Driveway replacement" value={form.title} onChange={(e) => set('title', e.target.value)} />
      <Choices label="Job type" options={JOB_TYPES} value={form.jobType} onChange={(v) => set('jobType', v)} />
      <Field label="Scope" multiline placeholder="What the price covers" value={form.scope} onChange={(e) => set('scope', e.target.value)} />
    </CreateShell>
  )
}
