import { afterEach, describe, expect, it, vi } from 'vitest'
import { endSendIntent, invoicesSending, onInvoiceSent, sendIntent, sendKey, sendsInFlight, startInvoiceSend, startSend, subscribeInvoiceSends } from './invoiceSends.ts'

// The invoices whose email is going out live in one place for the whole
// app, so a Money screen opened again while a reminder is still going out
// sees it busy (review of Phase 8, task 6). Each test finishes every send
// it starts, and checks that nothing is left over.

describe('invoice sends in flight', () => {
  afterEach(() => {
    expect(invoicesSending().size).toBe(0)
  })

  it('lets one send per invoice go out at a time, and another invoice alongside it', () => {
    const finishA = startInvoiceSend('inv-a', { reminder: true })
    expect(finishA).toBeTypeOf('function')
    expect(invoicesSending().has('inv-a')).toBe(true)
    // A second tap on A while it is going out sends nothing, as a reminder
    // or as a resend.
    expect(startInvoiceSend('inv-a', { reminder: true })).toBeNull()
    expect(startInvoiceSend('inv-a', { reminder: false })).toBeNull()

    const finishB = startInvoiceSend('inv-b', { reminder: true })
    expect(finishB).toBeTypeOf('function')
    expect([...invoicesSending()].sort()).toEqual(['inv-a', 'inv-b'])

    // B finishing does not free A.
    finishB!(true)
    expect(invoicesSending().has('inv-b')).toBe(false)
    expect(invoicesSending().has('inv-a')).toBe(true)
    expect(startInvoiceSend('inv-a', { reminder: true })).toBeNull()

    finishA!(false)
    expect(invoicesSending().has('inv-a')).toBe(false)
  })

  it('frees the invoice once its send is over, sent or not, so a later tap sends again', () => {
    startInvoiceSend('inv-c', { reminder: true })!(false)
    const again = startInvoiceSend('inv-c', { reminder: true })
    expect(again).toBeTypeOf('function')
    again!(true)
    const third = startInvoiceSend('inv-c', { reminder: false })
    expect(third).toBeTypeOf('function')
    third!(true)
  })

  it('never frees a later send of the same invoice when an old finish runs again', () => {
    const first = startInvoiceSend('inv-d', { reminder: false })!
    first(true)
    const second = startInvoiceSend('inv-d', { reminder: false })!
    first(true)
    expect(invoicesSending().has('inv-d')).toBe(true)
    expect(startInvoiceSend('inv-d', { reminder: false })).toBeNull()
    second(false)
  })

  it('hands subscribers a new set on each change and the same set in between', () => {
    const changed = vi.fn()
    const stop = subscribeInvoiceSends(changed)
    const before = invoicesSending()

    const finish = startInvoiceSend('inv-e', { reminder: true })!
    expect(changed).toHaveBeenCalledTimes(1)
    const during = invoicesSending()
    expect(during).not.toBe(before)
    // useSyncExternalStore needs the same snapshot until something changes.
    expect(invoicesSending()).toBe(during)

    // A tap that sends nothing changes nothing.
    expect(startInvoiceSend('inv-e', { reminder: true })).toBeNull()
    expect(changed).toHaveBeenCalledTimes(1)

    finish(true)
    expect(changed).toHaveBeenCalledTimes(2)
    expect(invoicesSending()).not.toBe(during)

    stop()
    startInvoiceSend('inv-f', { reminder: true })!(true)
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('tells sent listeners which invoice went out and how, and only when it went out', () => {
    const sent = vi.fn()
    const stop = onInvoiceSent(sent)
    startInvoiceSend('inv-g', { reminder: true })!(true)
    startInvoiceSend('inv-h', { reminder: false })!(true)
    // Failed, or downloaded because the sender is not set up: not sent.
    startInvoiceSend('inv-i', { reminder: true })!(false)
    expect(sent.mock.calls).toEqual([
      ['inv-g', { reminder: true }],
      ['inv-h', { reminder: false }]
    ])

    // The set no longer holds the invoice by the time its listener runs, so
    // a sheet that closes there finds its button ready.
    const seen: boolean[] = []
    const stopSeen = onInvoiceSent((id) => seen.push(invoicesSending().has(id)))
    startInvoiceSend('inv-j', { reminder: true })!(true)
    expect(seen).toEqual([false])
    stopSeen()

    stop()
    startInvoiceSend('inv-k', { reminder: true })!(true)
    expect(sent).toHaveBeenCalledTimes(3)
  })
})

// Every document send is keyed by what it sends, so a screen opened again,
// or another screen showing the same document, finds it busy (double-tap-1,
// double-tap-2, double-tap-7).
describe('document sends in flight', () => {
  afterEach(() => {
    expect(sendsInFlight().size).toBe(0)
  })

  it('lets one send per key go out at a time, read and set at once', () => {
    const end = startSend(sendKey.quote('q-1'))
    expect(end).toBeTypeOf('function')
    // A second tap in the same frame sends nothing.
    expect(startSend(sendKey.quote('q-1'))).toBeNull()
    // Another kind of send of the same record is a different key.
    const esign = startSend(sendKey.quoteSignature('q-1'))!
    expect([...sendsInFlight()].sort()).toEqual(['quote-signature:q-1', 'quote:q-1'])
    end!(false)
    expect(sendsInFlight().has('quote:q-1')).toBe(false)
    // Over, sent or not: a later tap sends again.
    const again = startSend(sendKey.quote('q-1'))!
    // An old finish run again never ends the later send.
    end!(false)
    expect(startSend(sendKey.quote('q-1'))).toBeNull()
    again(true)
    esign(true)
  })

  it('keeps an invoice email and other sends apart', () => {
    const balance = startSend(sendKey.jobBalance('job-1'))!
    expect(invoicesSending().size).toBe(0)
    const invoice = startInvoiceSend('inv-1', { reminder: false })!
    expect([...invoicesSending()]).toEqual(['inv-1'])
    // The invoice email is the same key whichever way it was started.
    expect(startSend(sendKey.invoice('inv-1'))).toBeNull()
    expect(sendsInFlight().has('invoice:inv-1')).toBe(true)
    invoice(true)
    balance(false)
  })

  it('each key names its document', () => {
    expect([
      sendKey.invoice('a'), sendKey.jobBalance('b'), sendKey.quote('c'), sendKey.quoteSignature('c'),
      sendKey.statement('d'), sendKey.certificate('e'), sendKey.changeOrderSignature('f')
    ]).toEqual(['invoice:a', 'job-balance:b', 'quote:c', 'quote-signature:c', 'statement:d', 'certificate:e', 'co-signature:f'])
  })
})

// A send that did not go out keeps one id from its first try to every
// retry, so a record it creates, or the email it asks for, is the same one
// when the answer was lost (double-tap-1).
describe('send intents', () => {
  it('keeps one id across tries until the send goes out', () => {
    const key = sendKey.jobBalance('job-intent')
    const first = sendIntent(key)
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/)
    // A try that did not go out keeps the intent.
    startSend(key)!(false)
    expect(sendIntent(key)).toBe(first)
    // One that went out ends it: the next send is a new one.
    startSend(key)!(true)
    const next = sendIntent(key)
    expect(next.id).not.toBe(first.id)
    endSendIntent(key, next)
  })

  it('starts a new intent when the document changed', () => {
    const key = sendKey.quote('q-intent')
    const v1 = sendIntent(key, 'v1')
    expect(sendIntent(key, 'v1')).toBe(v1)
    const v2 = sendIntent(key, 'v2')
    expect(v2.id).not.toBe(v1.id)
    endSendIntent(key, v2)
  })

  it('forgets only the intent it was given', () => {
    const key = sendKey.jobBalance('job-stale')
    const old = sendIntent(key, 'a')
    const current = sendIntent(key, 'b')
    endSendIntent(key, old)
    expect(sendIntent(key, 'b')).toBe(current)
    endSendIntent(key, current)
    expect(sendIntent(key, 'b')).not.toBe(current)
  })
})
