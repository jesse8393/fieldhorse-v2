// The sheets Money opens from an invoice row, shared by the phone screen
// and the desktop one: the invoice's actions, "Remind" (decision D6) and
// "Create an invoice" (which job, then the existing Send invoice sheet).
// The handlers that send, download, void and record payments are
// Invoices.tsx's own and arrive as props.
//
// The invoice and reminder ids stay after a sheet closes, so its content
// holds still while it leaves. Each sheet reads the set of invoices in
// flight, so one reminder finishing never frees another's button, and a
// sheet closes when lib/invoiceSends says an email of the invoice it shows
// went out, a reminder or a resend, from whichever sheet or screen: a send
// that finishes after its sheet closed or moved on to another invoice
// closes nothing, and a send started before Money was left and opened
// again still closes the sheet that shows it now (Phase 8, task 6).
//
// A tap on Send reminder or Resend sends only while its sheet still claims
// that invoice. The claim drops the moment the email is out or the sheet
// is closed, before the screen redraws: the button is free a beat before
// the sheet starts to close, and a closing sheet still takes taps, so a
// tap that lands as the email goes out sends nothing (review of Phase 8,
// task 6).

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { onInvoiceSent } from '../../lib/invoiceSends.ts'
import { customerEmail } from '../../lib/customerEmail.ts'
import type { MoneyInvoiceRow, MoneyRow } from '../../lib/moneyView.ts'
import InvoiceJobPicker from './InvoiceJobPicker.tsx'
import InvoiceSheet from './InvoiceSheet.tsx'
import RemindSheet from './RemindSheet.tsx'
import type { IssuedInvoiceRow, MoneyJob, MoneyScreenProps } from './types.ts'

// The Send invoice sheet is the existing create invoice flow. It is heavy
// and only needed after someone picks a job, so it loads on demand.
const SendInvoiceSheet = lazy(() => import('../../components/SendInvoiceSheet.tsx'))

export type UseMoneySheetsInput = Pick<
  MoneyScreenProps,
  'bundle' | 'invoiceRows' | 'sendingIds' | 'onSendInvoice' | 'onDownloadInvoice' | 'onPayInvoice' | 'onVoidInvoice' | 'onRefresh'
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
  sendingIds,
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
  // Which invoice each sheet claims right now: set when it opens, null
  // from the moment it closes or the email it stands for is out. A send
  // goes out only while its sheet still claims the invoice.
  const actionsIdRef = useRef<string | null>(null)
  const remindIdRef = useRef<string | null>(null)

  // Every close goes through these, so a sheet lets go of its invoice the
  // moment it starts to close, though it still shows while it slides away.
  const showActions = useCallback((open: boolean) => {
    if (!open) actionsIdRef.current = null
    setActionsOpen(open)
  }, [])
  const showRemind = useCallback((open: boolean) => {
    if (!open) remindIdRef.current = null
    setRemindOpen(open)
  }, [])

  // A sheet closes once an email of the invoice it shows is out, a
  // reminder or a resend, unless it has moved on to another invoice in the
  // meantime. Either sheet shows its button busy while any email of its
  // invoice goes out, so a Remind sheet opened during a resend must not
  // turn live under a finger still tapping it when the resend lands, nor
  // the actions sheet during a reminder. This hears every send, not only
  // the ones this screen started, so it holds after Money is left and
  // opened again mid send. It runs inside the send's finish, before React
  // draws the button free.
  useEffect(() => onInvoiceSent((invoiceId) => {
    if (remindIdRef.current === invoiceId) showRemind(false)
    if (actionsIdRef.current === invoiceId) showActions(false)
  }), [showActions, showRemind])

  const invoiceById = useMemo(() => new Map(invoiceRows.map((r) => [r.invoice.id, r])), [invoiceRows])
  const listById = useMemo(() => new Map(invoiceList.map((r) => [r.id, r])), [invoiceList])

  const openActions = (invoiceId: string) => {
    actionsIdRef.current = invoiceId
    setActionsId(invoiceId)
    setActionsOpen(true)
  }
  const openRemind = (row: MoneyRow) => {
    if (!row.invoiceId) return
    remindIdRef.current = row.invoiceId
    setRemindId(row.invoiceId)
    setRemindOpen(true)
  }
  const openPicker = () => setPickerOpen(true)

  const actionsIssued = actionsId ? invoiceById.get(actionsId) ?? null : null
  const actionsRow = actionsId ? listById.get(actionsId) ?? null : null
  const remindIssued = remindId ? invoiceById.get(remindId) ?? null : null
  const remindRow: MoneyRow | null = remindId ? listById.get(remindId) ?? null : null

  // The sheets close when the email is out (onInvoiceSent above). A tap
  // sends only while the sheet still claims the invoice it shows, so a tap
  // on the button freed by the email landing, or on the sheet sliding
  // away, sends nothing.
  const sendReminder = () => {
    if (!remindIssued || remindIdRef.current !== remindIssued.invoice.id) return
    void onSendInvoice(remindIssued, { reminder: true })
  }

  const resend = () => {
    if (!actionsIssued || actionsIdRef.current !== actionsIssued.invoice.id) return
    void onSendInvoice(actionsIssued)
  }

  // Each of these closes the sheet first, so the payment sheet, the
  // download or the confirmation takes the screen on its own.
  const handOver = (act: (row: IssuedInvoiceRow) => void) => () => {
    if (!actionsIssued) return
    showActions(false)
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
        onOpenChange={showActions}
        issued={actionsIssued}
        row={actionsRow}
        sending={actionsId !== null && sendingIds.has(actionsId)}
        onResend={resend}
        onPdf={handOver(onDownloadInvoice)}
        onMarkPaid={handOver(onPayInvoice)}
        onVoid={handOver(onVoidInvoice)}
      />
      <RemindSheet
        open={remindOpen}
        onOpenChange={showRemind}
        row={remindRow}
        email={customerEmail(remindIssued?.job)}
        sending={remindId !== null && sendingIds.has(remindId)}
        onSend={sendReminder}
      />
      <InvoiceJobPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        loading={!bundle}
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
