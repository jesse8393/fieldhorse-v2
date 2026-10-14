// The invoices whose email is going out right now, kept for the whole app
// instead of in the Money screen (review of Phase 8, task 6). A send
// outlives the screen that started it: leave Money while a reminder is
// still building its PDF or uploading on a weak signal, come back, and the
// new screen must still show that invoice busy, or one more tap emails the
// customer twice. /api/send-invoice does not drop a repeat on its own.
//
// Invoices.tsx starts each send here and finishes it once the email is out
// or has failed. Money reads the set for its busy buttons
// (useInvoicesSending), and its sheets listen for sends that went out
// (onInvoiceSent) to close, whichever screen started them.

import { useSyncExternalStore } from 'react'

/** How the email went out: a reminder from the Remind sheet, or a resend from the invoice's actions. */
export type InvoiceSendKind = { reminder: boolean }

type SentListener = (invoiceId: string, kind: InvoiceSendKind) => void

// A new set on every change, so useSyncExternalStore sees each one.
let sending: ReadonlySet<string> = new Set()
const changeListeners = new Set<() => void>()
const sentListeners = new Set<SentListener>()

function publish(next: ReadonlySet<string>) {
  sending = next
  for (const listener of changeListeners) listener()
}

/** The invoice ids whose email is going out right now. The same set until it changes. */
export function invoicesSending(): ReadonlySet<string> {
  return sending
}

/** Calls `listener` whenever an invoice starts or stops going out. Returns the unsubscribe. */
export function subscribeInvoiceSends(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => { changeListeners.delete(listener) }
}

/**
 * Calls `listener` each time an invoice's email has gone out, after the
 * invoice has left the set. Returns the unsubscribe.
 */
export function onInvoiceSent(listener: SentListener): () => void {
  sentListeners.add(listener)
  return () => { sentListeners.delete(listener) }
}

/**
 * Marks the invoice's email as going out and returns the function that
 * ends it, called with whether the email went out. Returns null, and
 * changes nothing, when this invoice's email is already going out: the
 * caller sends nothing then. Ending twice is harmless and never ends a
 * later send of the same invoice.
 */
export function startInvoiceSend(invoiceId: string, kind: InvoiceSendKind): ((sent: boolean) => void) | null {
  if (sending.has(invoiceId)) return null
  publish(new Set(sending).add(invoiceId))
  let over = false
  return (sent) => {
    if (over) return
    over = true
    const next = new Set(sending)
    next.delete(invoiceId)
    publish(next)
    if (sent) for (const listener of sentListeners) listener(invoiceId, kind)
  }
}

const NONE: ReadonlySet<string> = new Set()

/** The invoices whose email is going out, app wide; the screen redraws when that changes. */
export function useInvoicesSending(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeInvoiceSends, invoicesSending, () => NONE)
}
