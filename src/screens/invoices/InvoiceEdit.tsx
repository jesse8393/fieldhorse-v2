// Edit an invoice, /invoices/:id/edit (Phase 9, Task 12, decision D57):
// the title, the amount, the description that prints on the PDF and in the
// email (D62), the due date and the notes, with one gold Save that returns
// to the invoice. A paid or void invoice is not edited here.

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { Button, Field, IconButton, SkeletonRows } from '../../components/fh'
import DataErrorState from '../../components/DataErrorState.tsx'
import { supabase } from '../../lib/supabase.ts'
import { toYmd } from '../../lib/dates.ts'
import { hapticTap } from '../../lib/haptics.ts'
import { toastError, toastSuccess } from '../../lib/toast.ts'
import { goBackFrom, useInvoiceScreen } from './useInvoiceScreen.ts'
import './invoices.css'

type Form = { title: string; amount: string; description: string; due: string; notes: string }

export default function InvoiceEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { query, record, figures, refresh, patchInvoice } = useInvoiceScreen(id)
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }) }, [])

  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [amountError, setAmountError] = useState('')
  const invoice = record?.invoice ?? null
  const shown: Form = form ?? {
    title: invoice?.title ?? '',
    amount: invoice ? String(invoice.amount ?? '') : '',
    description: invoice?.description ?? '',
    due: toYmd(invoice?.due_at ?? null),
    notes: invoice?.notes ?? ''
  }
  const set = (patch: Partial<Form>) => setForm({ ...shown, ...patch })
  const back = () => goBackFrom(navigate, `/invoices/${id}`)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!invoice || saving) return
    const amount = Number(shown.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setAmountError('Enter an amount, such as 1240.00')
      return
    }
    setAmountError('')
    setSaving(true)
    const patch = {
      title: shown.title.trim() || null,
      amount,
      description: shown.description.trim() || null,
      due_at: shown.due ? new Date(`${shown.due}T12:00:00`).toISOString() : null,
      notes: shown.notes.trim() || null
    }
    const { error } = await supabase.from('fh_invoices').update(patch).eq('id', invoice.id)
    setSaving(false)
    if (error) {
      toastError("Couldn't save the invoice", error.message || 'Try again')
      return
    }
    hapticTap()
    patchInvoice(patch)
    refresh()
    toastSuccess('Invoice saved', '')
    navigate(`/invoices/${invoice.id}`, { replace: true })
  }

  const header = (
    <header className="fhinv-head">
      <IconButton aria-label="Back" icon={ChevronLeft} variant="plain" size={44} onClick={back} />
      <h1 className="fhinv-title" ref={titleRef} tabIndex={-1}>Edit invoice</h1>
    </header>
  )

  if (query.isError) {
    return (
      <div className="v3-screen fhinv">
        {header}
        <div className="fhinv-state">
          <DataErrorState title="Couldn't load this invoice" message="Check your connection and try again." actionLabel="Try again" onRetry={() => void query.refetch()} />
        </div>
      </div>
    )
  }
  if (!record || !figures || !invoice) {
    return (
      <div className="v3-screen fhinv">
        {header}
        <div className="fhinv-state"><SkeletonRows rows={5} label="Loading invoice" /></div>
      </div>
    )
  }

  return (
    <div className="v3-screen fhinv" data-build-screen="InvoiceEdit">
      {header}
      <p className="fhinv-intro">{`${figures.to.name || 'Customer'}${record.job?.job_title ? `, ${record.job.job_title}` : ''}`}</p>
      <form className="fhinv-form" onSubmit={(e) => void submit(e)}>
        <Field label="Title" value={shown.title} disabled={saving} placeholder="Deposit, Progress draw 2, Final balance" onChange={(e) => set({ title: e.target.value })} />
        <Field
          label="Amount"
          inputMode="decimal"
          autoComplete="off"
          value={shown.amount}
          disabled={saving}
          error={amountError}
          onChange={(e) => { setAmountError(''); set({ amount: e.target.value.replace(/[^\d.]/g, '') }) }}
        />
        <Field
          multiline
          label="Description, shows on the invoice"
          helper="Prints in the PDF Description column and in the email."
          placeholder={record.job?.job_title || 'What this invoice is for'}
          value={shown.description}
          disabled={saving}
          onChange={(e) => set({ description: e.target.value })}
        />
        <Field label="Due" type="date" value={shown.due} disabled={saving} onChange={(e) => set({ due: e.target.value })} />
        <Field multiline label="Notes" helper="Shown to the customer under the line items." value={shown.notes} disabled={saving} onChange={(e) => set({ notes: e.target.value })} />
        <div className="fhinv-form__save">
          <Button type="submit" variant="primary" size="lg" block loading={saving}>Save</Button>
        </div>
      </form>
    </div>
  )
}
