// New invoice (PHASE9_PLAN Task 8, SPEC D59, D61, D62). An invoice needs a
// client and an amount. It may bill one of that client's open jobs, picked
// from a short list on the screen (prefilled from ?job=, as Invoice this
// sends it), in which case the amount starts at the job's balance and the
// description at the job title. With no job it bills the client directly
// through fh_invoices.client_id.

import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Field, formatMoney } from '../../components/fh'
import ClientField, { fetchClientPick, resolveClientId, type ClientFieldValue, type ClientPick } from '../../components/ClientField.tsx'
import CreateShell, { Choices, moneyInput, useDraft } from '../new/CreateShell.tsx'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useMembership } from '../../contexts/MembershipContext.tsx'
import { supabase } from '../../lib/supabase.ts'
import { contractTotals, createInvoice } from '../../lib/invoices.ts'
import { JOB_STAGES } from '../../lib/stages.ts'
import { recordRoute } from '../../lib/records.ts'
import { hapticMedium } from '../../lib/haptics.ts'

type Job = { id: string; job_title: string | null; name: string | null; amount: number | null; client_id: string | null; stage: string | null }

type Form = {
  client: string
  clientId: string
  jobId: string
  amount: string
  description: string
  due: string
  instructions: string
}

const EMPTY: Form = { client: '', clientId: '', jobId: '', amount: '', description: '', due: '', instructions: '' }

const DUE = [
  { value: '0', label: 'On receipt' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' }
]

function dueAt(days: string): string | null {
  if (days === '') return null
  const d = new Date()
  d.setDate(d.getDate() + Number(days))
  return d.toISOString()
}

// The job's balance: contract plus approved change orders, less what has
// been paid (the figure Invoice this hands over, D61).
async function jobBalance(jobId: string, amount: number | null): Promise<number> {
  const [payments, changeOrders] = await Promise.all([
    supabase.from('fh_payments').select('amount').eq('contact_id', jobId),
    supabase.from('fh_change_orders').select('amount, status').eq('contact_id', jobId)
  ])
  return contractTotals({
    contact: { amount: amount ?? 0 },
    payments: payments.data || [],
    changeOrders: changeOrders.data || []
  }).balance
}

export default function InvoiceNew() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { orgId } = useMembership()
  const [params] = useSearchParams()
  const clientParam = params.get('client')
  const jobParam = params.get('job')
  const text = params.get('text')
  const { form, set, patch, done } = useDraft<Form>('invoice', EMPTY, text ? { description: text } : null)
  const [client, setClient] = useState<ClientFieldValue>({ text: form.client, picked: null })
  const [jobs, setJobs] = useState<Job[]>([])
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<{ client?: string; amount?: string; save?: string }>({})

  function applyPick(c: ClientPick) {
    setClient({ text: c.name, picked: c })
    patch({ client: c.name, clientId: c.id })
  }

  useEffect(() => {
    if (!clientParam || jobParam) return
    let alive = true
    void fetchClientPick(clientParam).then((c) => { if (alive && c) applyPick(c) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientParam])

  // Invoice this on a job: the job, its client, its balance and its title.
  useEffect(() => {
    if (!jobParam) return
    let alive = true
    void (async () => {
      const { data } = await supabase.from('fh_contacts').select('id, job_title, name, amount, client_id, stage').eq('id', jobParam).maybeSingle()
      if (!alive || !data) return
      const job = data as Job
      const balance = await jobBalance(job.id, job.amount)
      if (!alive) return
      patch({ jobId: job.id, amount: balance > 0 ? String(balance) : '', description: job.job_title || '' })
      if (job.client_id) {
        const c = await fetchClientPick(job.client_id)
        if (alive && c) applyPick(c)
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobParam])

  // The picked client's open jobs, to bill one of them.
  const clientId = client.picked?.id || ''
  useEffect(() => {
    if (!clientId) { setJobs([]); return }
    let alive = true
    void supabase
      .from('fh_contacts')
      .select('id, job_title, name, amount, client_id, stage')
      .eq('client_id', clientId)
      .in('stage', JOB_STAGES)
      .order('created_at', { ascending: false })
      .limit(12)
      .then(({ data }) => { if (alive) setJobs((data || []) as Job[]) })
    return () => { alive = false }
  }, [clientId])

  function onClient(next: ClientFieldValue) {
    setClient(next)
    patch({ client: next.text, clientId: next.picked?.id || '', jobId: next.picked?.id === form.clientId ? form.jobId : '' })
  }

  async function pickJob(job: Job | null) {
    if (!job) { patch({ jobId: '' }); return }
    const balance = await jobBalance(job.id, job.amount)
    patch({ jobId: job.id, amount: balance > 0 ? String(balance) : form.amount, description: form.description || job.job_title || '' })
  }

  async function save() {
    if (!user) return
    const next: typeof errors = {}
    if (!client.text.trim()) next.client = 'Enter a client.'
    const amount = Number(form.amount)
    if (!form.amount.trim() || !Number.isFinite(amount) || amount <= 0) next.amount = 'Enter an amount, such as 1240.00.'
    if (next.client || next.amount) { setErrors(next); return }
    setSaving(true)
    setErrors({})
    try {
      const picked = await resolveClientId(client, { userId: user.id, orgId })
      if (!picked) throw new Error('Enter a client.')
      const { data, error } = await createInvoice({
        contact: form.jobId ? { id: form.jobId } : null,
        clientId: picked.id,
        userId: user.id,
        title: form.description.trim() || 'Invoice',
        description: form.description,
        amount,
        due_at: dueAt(form.due),
        notes: form.instructions
      })
      if (error || !data) throw new Error(error?.message || 'Could not save this invoice.')
      done()
      hapticMedium()
      navigate(recordRoute('invoice', data.id), { replace: true })
    } catch (e) {
      setSaving(false)
      setErrors({ save: e instanceof Error && e.message ? e.message : 'Could not save this invoice. Check your connection and try again.' })
    }
  }

  return (
    <CreateShell title="New invoice" saveLabel="Save invoice" saving={saving} error={errors.save} onSave={save}>
      <ClientField userId={user?.id} value={client} onChange={onClient} error={errors.client} autoFocus={!clientParam && !jobParam} onPick={applyPick} />
      {jobs.length > 0 && (
        <fieldset className="fhnew-choices">
          <legend className="fhnew-choices__label">Job</legend>
          <ul className="fhnew-jobs" aria-label="Jobs to bill">
            {jobs.map((j) => {
              const on = j.id === form.jobId
              return (
                <li key={j.id}>
                  <button type="button" className={`fhnew-job${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => void pickJob(on ? null : j)}>
                    <span>{j.job_title || j.name || 'Untitled job'}</span>
                    {j.amount != null && j.amount > 0 && <span className="fhnew-job__money">{formatMoney(j.amount)}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="fhnew-note">{form.jobId ? 'Bills this job.' : 'No job picked: bills the client directly.'}</p>
        </fieldset>
      )}
      <Field label="Amount" inputMode="decimal" placeholder="0.00" value={form.amount} error={errors.amount} onChange={(e) => set('amount', moneyInput(e.target.value))} />
      <Field label="Description" helper="Prints on the invoice." value={form.description} onChange={(e) => set('description', e.target.value)} />
      <Choices label="Due" options={DUE} value={form.due} onChange={(v) => set('due', v)} />
      <Field label="Payment instructions" multiline placeholder="Check, Zelle, or card by link" value={form.instructions} onChange={(e) => set('instructions', e.target.value)} />
    </CreateShell>
  )
}
