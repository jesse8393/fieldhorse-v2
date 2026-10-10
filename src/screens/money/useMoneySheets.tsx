// The sheets Money opens from an invoice row, shared by the phone screen
// and the desktop one: the invoice's actions, "Remind" (decision D6) and
// "Create an invoice" (which job, then the existing Send invoice sheet).
// The handlers that send, download, void and record payments are
// Invoices.tsx's own and arrive as props.
//
// The invoice and reminder ids stay after a sheet closes, so its content
// holds still while it leaves.

import { lazy, Suspense, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../../contexts/AuthContext.tsx'
import type { MoneyInvoiceRow, MoneyRow } from '../../lib/moneyView.ts'
import InvoiceJobPicker from './InvoiceJobPicker.tsx'
import InvoiceSheet from './InvoiceSheet.tsx'
import RemindSheet from './RemindSheet.tsx'
import type { IssuedInvoiceRow, MoneyJob, MoneyScreenProps } from './types.ts'

// The Send invoice sheet is the existing create invoice flow. It is heavy
// and only needed after someone picks a job, so it loads on demand.
const SendInvoiceSheet = lazy(() => import('../../components/SendInvoiceSheet.tsx'))

function emailFor(job: MoneyJob | null | undefined): string {
  return (job?.email || job?.fh_clients?.email || '').trim()
}

export type UseMoneySheetsInput = Pick<
  MoneyScreenProps,
  'bundle' | 'invoiceRows' | 'sendingId' | 'onSendInvoice' | 'onDownloadInvoice' | 'onPayInvoice' | 'onVoidInvoice' | 'onRefresh'
> & {
  /** Every invoice as a row (buildInvoiceList), for the status the sheets show. */
  invoiceList: MoneyInvoiceRow[]
}

export type MoneySheets = {
  /** Open the actions sheet for an invoice. */
  openActions: (invoiceId: string) => void
  /** Open the Remind sheet for an overdue row. Nothing is sent until Send reminder is pressed. */
  openRemind: (row: MoneyRow) => void
  /** Open the "Which job is it for?" picker. */
  openPicker: () => void
  /** The sheets themselves; render them once, anywhere in the screen. */
  sheets: ReactNode
}

export function useMoneySheets({
  bundle,
  invoiceRows,
  invoiceList,
  sendingId,
  onSendInvoice,
  onDownloadInvoice,
  onPayInvoice,
  onVoidInvoice,
  onRefresh
}: UseMoneySheetsInput): MoneySheets {
  const { user } = useAuth()

  const [actionsId, setActionsId] = useState<string | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [remindId, setRemindId] = useState<string | null>(null)
  const [remindOpen, setRemindOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [billJob, setBillJob] = useState<MoneyJob | null>(null)

  const invoiceById = useMemo(() => new Map(invoiceRows.map((r) => [r.invoice.id, r])), [invoiceRows])
  const listById = useMemo(() => new Map(invoiceList.map((r) => [r.id, r])), [invoiceList])

  const openActions = (invoiceId: string) => {
    setActionsId(invoiceId)
    setActionsOpen(true)
  }
  const openRemind = (row: MoneyRow) => {
    if (!row.invoiceId) return
    setRemindId(row.invoiceId)
    setRemindOpen(true)
  }
  const openPicker = () => setPickerOpen(true)

  const actionsIssued = actionsId ? invoiceById.get(actionsId) ?? null : null
  const actionsRow = actionsId ? listById.get(actionsId) ?? null : null
  const remindIssued = remindId ? invoiceById.get(remindId) ?? null : null
  const remindRow: MoneyRow | null = remindId ? listById.get(remindId) ?? null : null

  const sendReminder = async () => {
    if (!remindIssued) return
    const sent = await onSendInvoice(remindIssued, { reminder: true })
    if (sent) setRemindOpen(false)
  }

  const resend = async () => {
    if (!actionsIssued) return
    const sent = await onSendInvoice(actionsIssued)
    if (sent) setActionsOpen(false)
  }

  // Each of these closes the sheet first, so the payment sheet, the
  // download or the confirmation takes the screen on its own.
  const handOver = (act: (row: IssuedInvoiceRow) => void) => () => {
    if (!actionsIssued) return
    setActionsOpen(false)
    act(actionsIssued)
  }

  const pickJob = (job: MoneyJob) => {
    setPickerOpen(false)
    setBillJob(job)
  }

  const sheets = (
    <>
      <InvoiceSheet
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        issued={actionsIssued}
        row={actionsRow}
        sending={actionsId !== null && sendingId === actionsId}
        onResend={() => void resend()}
        onPdf={handOver(onDownloadInvoice)}
        onMarkPaid={handOver(onPayInvoice)}
        onVoid={handOver(onVoidInvoice)}
      />
      <RemindSheet
        open={remindOpen}
        onOpenChange={setRemindOpen}
        row={remindRow}
        email={emailFor(remindIssued?.job)}
        sending={remindId !== null && sendingId === remindId}
        onSend={() => void sendReminder()}
      />
      <InvoiceJobPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        jobs={bundle?.jobs ?? []}
        onPick={pickJob}
      />
      {billJob && bundle && (
        <Suspense fallback={null}>
          <SendInvoiceSheet
            open
            userId={user?.id}
            contact={billJob}
            payments={bundle.payments.filter((p) => p.contact_id === billJob.id)}
            changeOrders={bundle.changeOrders.filter((c) => c.contact_id === billJob.id)}
            onClose={() => setBillJob(null)}
            onDone={onRefresh}
          />
        </Suspense>
      )}
    </>
  )

  return { openActions, openRemind, openPicker, sheets }
}
