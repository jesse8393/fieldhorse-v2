// The documents going out right now, kept for the whole app instead of in
// the screen that started them (review of Phase 8, task 6). A send outlives
// the screen that started it: leave a screen while a document is still
// building its PDF or uploading on a weak signal, come back or open the
// same document elsewhere, and that screen must still show it busy, or one
// more tap emails the customer twice. A server does not always drop a
// repeat on its own.
//
// Each send is keyed by what it sends (sendKey): an invoice, the Balance
// due invoice a job's money view makes, a quote, a statement, a completion
// certificate, a change order's approval link. A screen starts its send
// here (startSend, or startInvoiceSend for an invoice) and ends it once the
// send is over; every screen reads the same keys for its busy buttons
// (useSendInFlight, useInvoicesSending). Invoice sheets also listen for an
// invoice email that went out (onInvoiceSent) to close, whichever screen
// started it.
//
// A send that did not go out keeps its intent here (sendIntent): an id made
// once and kept from the first try to every retry, until the send goes out
// or the document changes. A record the send creates is written under that
// id, so a retry after a lost answer finds the first row instead of adding
// a second. A document email sends it as send_id with the PDF its first try
// uploaded, so the server's provider key is the same on every retry and
// the customer gets one email however often Try again is tapped.

import { useSyncExternalStore } from 'react'
import { createUuid } from './uuid.ts'

/** The key of each kind of send. One send per key goes out at a time. */
export const sendKey = {
  invoice: (invoiceId: string) => `invoice:${invoiceId}`,
  /** The Balance due invoice Email makes on a job with nothing open to bill. */
  jobBalance: (jobId: string) => `job-balance:${jobId}`,
  quote: (quoteId: string) => `quote:${quoteId}`,
  quoteSignature: (quoteId: string) => `quote-signature:${quoteId}`,
  statement: (clientId: string) => `statement:${clientId}`,
  certificate: (jobId: string) => `certificate:${jobId}`,
  changeOrderSignature: (changeOrderId: string) => `co-signature:${changeOrderId}`
}

const INVOICE = 'invoice:'
const NONE: ReadonlySet<string> = new Set()

/** How the email went out: a reminder from the Remind sheet, or a resend from the invoice's actions. */
export type InvoiceSendKind = { reminder: boolean }

type SentListener = (invoiceId: string, kind: InvoiceSendKind) => void

// A new set on every change, so useSyncExternalStore sees each one. The
// invoice ids are kept beside the keys for the screens that read them.
let inFlight: ReadonlySet<string> = new Set()
let invoiceIds: ReadonlySet<string> = new Set()
const changeListeners = new Set<() => void>()
const sentListeners = new Set<SentListener>()

function publish(next: ReadonlySet<string>) {
  inFlight = next
  const ids = new Set<string>()
  for (const key of next) if (key.startsWith(INVOICE)) ids.add(key.slice(INVOICE.length))
  invoiceIds = ids
  for (const listener of changeListeners) listener()
}

/** The keys of every send going out right now. The same set until it changes. */
export function sendsInFlight(): ReadonlySet<string> {
  return inFlight
}

/** Calls `listener` whenever a send starts or stops. Returns the unsubscribe. */
export function subscribeSends(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => { changeListeners.delete(listener) }
}

/**
 * Marks the send as going out and returns the function that ends it,
 * called with whether it went out. Returns null, and changes nothing, when
 * a send with this key is already going out: the caller sends nothing
 * then. It is read and set at once, so two taps in one frame start one
 * send. Ending twice is harmless and never ends a later send of the same
 * key. A send that went out ends its intent; one that did not keeps it.
 */
export function startSend(key: string): ((sent: boolean) => void) | null {
  if (inFlight.has(key)) return null
  publish(new Set(inFlight).add(key))
  let over = false
  return (sent) => {
    if (over) return
    over = true
    if (sent) intents.delete(key)
    const next = new Set(inFlight)
    next.delete(key)
    publish(next)
  }
}

/** The PDF a document email's first try uploaded. */
export type SentFile = { path: string; filename: string }

/** What one send keeps from its first try to every retry. */
export type SendIntent = {
  /** Made once per intent: the send_id of a document email, or the id of a record the send creates. */
  readonly id: string
  /** What the document was when the intent began. */
  readonly version: string
  /** The PDF the first try uploaded, which a retry sends again. */
  upload: SentFile | null
}

const intents = new Map<string, SendIntent>()

/**
 * The intent of the send with this key: the one an earlier try left, when
 * that try did not go out and the document is still the same version, else
 * a new one with a new id.
 */
export function sendIntent(key: string, version = ''): SendIntent {
  const kept = intents.get(key)
  if (kept && kept.version === version) return kept
  const fresh: SendIntent = { id: createUuid(), version, upload: null }
  intents.set(key, fresh)
  return fresh
}

/** Forgets the intent once what it was kept for is done; never a newer one. */
export function endSendIntent(key: string, intent: SendIntent) {
  if (intents.get(key) === intent) intents.delete(key)
}

/** The keys of every send going out, app wide; the screen redraws when that changes. */
export function useSendsInFlight(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeSends, sendsInFlight, () => NONE)
}

/** Whether the send with this key is going out, app wide; the screen redraws when that changes. */
export function useSendInFlight(key: string | null | undefined): boolean {
  return useSyncExternalStore(subscribeSends, () => !!key && inFlight.has(key), () => false)
}

/** The invoice ids whose email is going out right now. The same set until it changes. */
export function invoicesSending(): ReadonlySet<string> {
  return invoiceIds
}

/** Calls `listener` whenever a send starts or stops. Returns the unsubscribe. */
export const subscribeInvoiceSends = subscribeSends

/**
 * Calls `listener` each time an invoice's email has gone out, after the
 * invoice has left the set. Returns the unsubscribe.
 */
export function onInvoiceSent(listener: SentListener): () => void {
  sentListeners.add(listener)
  return () => { sentListeners.delete(listener) }
}

/**
 * startSend for an invoice's email, which also tells the sent listeners
 * when it went out. Returns null, and changes nothing, when this invoice's
 * email is already going out, from any screen.
 */
export function startInvoiceSend(invoiceId: string, kind: InvoiceSendKind): ((sent: boolean) => void) | null {
  const end = startSend(sendKey.invoice(invoiceId))
  if (!end) return null
  let over = false
  return (sent) => {
    if (over) return
    over = true
    end(sent)
    if (sent) for (const listener of sentListeners) listener(invoiceId, kind)
  }
}

/** The invoices whose email is going out, app wide; the screen redraws when that changes. */
export function useInvoicesSending(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeInvoiceSends, invoicesSending, () => NONE)
}
