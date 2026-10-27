// What the four invoice screens share (Phase 9, Task 12, decisions D57 and
// D62): one invoice's record (lib/queries useInvoiceRecord), the figures
// every screen prints from it, and the send that the invoice screen's
// Send and Resend and the remind screen's Send reminder both run.
//
// An invoice bills a job or, with no job, its client directly. Whoever it
// bills comes from billTo (lib/invoices.ts); what it owes comes from the
// one allocator Money uses (invoiceAmountDue), with the job's payments,
// approved change orders and other invoices when there is a job, and the
// payments linked to the invoice when there is not.
//
// A send lives in lib/invoiceSends for the whole app, so leaving a screen
// mid send and opening another still finds the invoice busy, and a screen
// that shows the invoice hears when its email has gone out (onInvoiceSent).

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { NavigateFunction } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useProfile } from '../../contexts/ProfileContext.tsx'
import {
  billTo,
  companyFromProfile,
  invoiceAmountDue,
  invoiceDescription,
  sendInvoiceEmail,
  type BillTo
} from '../../lib/invoices.ts'
import { reviewInvoice } from '../../lib/invoiceReview.js'
import { knownContractTotal } from '../../lib/invoiceSettlement.ts'
import { classifyInvoice, type InvoiceStanding } from '../../lib/moneyView.ts'
import { onInvoiceSent, startInvoiceSend, useInvoicesSending } from '../../lib/invoiceSends.ts'
import { invoiceRecordKey, useInvalidateInvoiceRecord, useInvoiceRecord, type InvoiceRecord, type InvoiceRecordBundle } from '../../lib/queries.ts'
import { useNow } from '../../lib/useNow.ts'
import { toastError, toastSuccess } from '../../lib/toast.ts'
import { hapticTap } from '../../lib/haptics.ts'
import { parseDateOnly } from '../../lib/dates.ts'

// How long after an email lands a tap on its button is taken as aimed at the busy button.
const SETTLE_MS = 800

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Oct 15", with the year when it is not this one. */
export function shortDate(value: string | null | undefined, now: Date): string {
  const d = parseDateOnly(value ?? null)
  if (!d) return ''
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`
}

export function invoiceTitle(invoice: Pick<InvoiceRecord, 'title' | 'sequence_number'> | null | undefined): string {
  return (invoice?.title || '').trim() || (invoice ? `Invoice #${invoice.sequence_number}` : 'Invoice')
}

/** The figures an invoice screen prints, worked out once from the record. */
export type InvoiceFigures = {
  title: string
  /** Who the invoice bills: the job's details, else the client's. */
  to: BillTo
  /** What is still owed (the allocator's figure), which can be zero. */
  due: number
  standing: InvoiceStanding
  /** Paid or void: nothing left to send, collect or void. */
  settled: boolean
  isDraft: boolean
  /** Payments linked to this invoice. */
  linkedPayments: InvoiceRecordBundle['payments']
  /** The Description column's words: the invoice's own, else the job title. */
  description: string
  /** "Sent Oct 1, due Oct 15" or just one of them. */
  dates: string
  /** Where the record the invoice hangs off lives: the job's money tab, else the client. */
  recordHref: string | null
  recordLabel: string
}

export function describeInvoice(record: InvoiceRecordBundle, now: Date): InvoiceFigures {
  const { invoice, job, client, payments, changeOrders, jobInvoices } = record
  const to = billTo(job, client)
  const due = job
    ? invoiceAmountDue({ invoice, contact: job, payments, changeOrders, invoices: jobInvoices })
    : invoiceAmountDue({ invoice, contact: null, payments })
  const standing = classifyInvoice(invoice, due, now)
  const status = standing.status
  const sent = invoice.status !== 'draft' ? shortDate(invoice.issued_at, now) : ''
  const dueDay = shortDate(invoice.due_at, now)
  const dates = [sent && `Sent ${sent}`, dueDay && `${sent ? 'due' : 'Due'} ${dueDay}`].filter(Boolean).join(', ')
  return {
    title: invoiceTitle(invoice),
    to,
    due,
    standing,
    settled: status === 'paid' || status === 'void',
    isDraft: status === 'draft',
    linkedPayments: payments.filter((p) => p.invoice_id === invoice.id),
    description: invoiceDescription(invoice, job),
    dates,
    recordHref: job ? `/jobs/${job.id}?tab=financials` : client ? `/clients/${client.id}` : null,
    recordLabel: job ? 'Open job' : 'Open client'
  }
}

/** Back the way the person came, or to the invoice when the screen was opened by its link. */
export function goBackFrom(navigate: NavigateFunction, fallback: string) {
  hapticTap()
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
  if (idx > 0) navigate(-1)
  else navigate(fallback, { replace: true })
}

export function useInvoiceScreen(id: string | undefined) {
  const { user } = useAuth()
  const { profile } = useProfile()
  const query = useInvoiceRecord(id, user?.id)
  const invalidate = useInvalidateInvoiceRecord()
  const queryClient = useQueryClient()
  const now = useNow()
  const sendingIds = useInvoicesSending()

  const record = query.data ?? null
  const figures = useMemo(() => (record ? describeInvoice(record, now) : null), [record, now])
  const billingReview = useMemo(() => record ? reviewInvoice({ invoice: record.invoice, invoices: record.jobInvoices, contractTotal: record.job ? knownContractTotal({ amount: record.job.amount, changeOrders: record.changeOrders }) : null }) : null, [record])
  const company = useMemo(() => companyFromProfile(profile), [profile])
  const sending = !!id && sendingIds.has(id)

  const refresh = useCallback(() => invalidate(id), [invalidate, id])

  // True for a beat after an email of this invoice has gone out. A tap that
  // lands then, as the button frees under a finger still tapping, sends
  // nothing: it was aimed at the busy button, not at a second email
  // (review of Phase 8, task 6). A timer, not the clock, so it settles
  // even where Date is pinned.
  const settling = useRef(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = onInvoiceSent((invoiceId) => {
      if (invoiceId !== id) return
      settling.current = true
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { settling.current = false }, SETTLE_MS)
    })
    return () => { off(); if (timer) clearTimeout(timer) }
  }, [id])

  // A saved edit shows at once, from what was typed: the write's answer is
  // not waited for, and a stale read cannot put the old words back.
  const patchInvoice = useCallback((patch: Partial<InvoiceRecord>) => {
    queryClient.setQueryData<InvoiceRecordBundle>(invoiceRecordKey(id), (old) =>
      old ? { ...old, invoice: { ...old.invoice, ...patch } } : old
    )
  }, [queryClient, id])

  // Emails the invoice, a resend or a reminder (decision D6: a reminder is
  // the same email sent again; only the toast words it differently).
  // Resolves true once the email has gone out. A tap while this invoice's
  // email is already going out, from any screen, sends nothing.
  const send = useCallback(async (options: { reminder?: boolean; duplicateReviewed?: boolean } = {}): Promise<boolean> => {
    if (!record || !user || !figures) return false
    if (settling.current) return false
    if (record.invoice.status === 'draft' && billingReview) {
      if (billingReview.excess > 0) { toastError('Review contract billing', 'Invoices and drafts exceed approved scope. Reduce or void unused drafts before sending.'); return false }
      if (billingReview.duplicates.length && !options.duplicateReviewed) { toastError('Review similar invoices', 'Confirm this bills a separate installment before sending.'); return false }
    }
    if (!figures.to.email) {
      toastError('Add a client email first', `Open the linked client to add an email for ${figures.to.name || 'this client'}.`)
      return false
    }
    const finish = startInvoiceSend(record.invoice.id, { reminder: !!options.reminder })
    if (!finish) return false
    let sent = false
    try {
      const res = await sendInvoiceEmail({
        invoice: record.invoice,
        duplicateReviewed: !!options.duplicateReviewed,
        contact: record.job,
        client: record.client,
        company,
        userId: user.id,
        recipientEmail: figures.to.email,
        payments: record.payments,
        changeOrders: record.changeOrders,
        invoices: record.jobInvoices,
        insurance: record.insurance
      })
      if (res.ok) {
        toastSuccess(`${options.reminder ? 'Reminder' : 'Invoice'} sent to ${res.recipient}`, res.filename)
        refresh()
        sent = true
      } else if (res.reason === 'sender_not_configured') {
        toastError("Email not sent, sender isn't configured", 'Downloaded the PDF so you can email it manually.')
      } else {
        throw new Error(res.message || 'Send failed')
      }
    } catch (e) {
      toastError("Couldn't send invoice", (e as Error)?.message || 'Try again')
    } finally {
      finish(sent)
    }
    return sent
  }, [record, user, figures, company, refresh, billingReview])

  return { user, query, record, figures, billingReview, company, now, sending, refresh, patchInvoice, send }
}
