import { afterEach, describe, expect, it, vi } from 'vitest'
import { invoicesSending, onInvoiceSent, startInvoiceSend, subscribeInvoiceSends } from './invoiceSends.ts'

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
