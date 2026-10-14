import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { freePageForQuestion } from './ConfirmSheet.tsx'

// A question asked over an open modal sheet (Phase 8, Task 15). The unit
// tests run in node, so a stand in body and sheet are enough: the helper
// only reads the body's pointer-events and whether the sheet is still in
// the page.

type Body = { style: { pointerEvents: string } }
type FakeSheet = { isConnected: boolean }

const hadDocument = 'document' in globalThis
const realDocument = (globalThis as { document?: unknown }).document
let body: Body

beforeEach(() => {
  // What an open modal sheet leaves on the page.
  body = { style: { pointerEvents: 'none' } }
  ;(globalThis as { document?: unknown }).document = { body }
})

afterEach(() => {
  if (hadDocument) (globalThis as { document?: unknown }).document = realDocument
  else delete (globalThis as { document?: unknown }).document
})

const asSheet = (sheet: FakeSheet) => sheet as unknown as HTMLElement

describe('freePageForQuestion', () => {
  it('frees the page for the question, and locks it again while the sheet is open', () => {
    const lockPageAgain = freePageForQuestion(asSheet({ isConnected: true }))
    expect(body.style.pointerEvents).toBe('auto')
    lockPageAgain()
    expect(body.style.pointerEvents).toBe('none')
  })

  it('leaves the page alone once the sheet has gone, so the next screen still takes taps', () => {
    const sheet = { isConnected: true }
    const lockPageAgain = freePageForQuestion(asSheet(sheet))
    // The back button while it asks: the sheet leaves the page, and Radix
    // gives the page back what it had before the sheet opened.
    sheet.isConnected = false
    body.style.pointerEvents = ''
    lockPageAgain()
    expect(body.style.pointerEvents).toBe('')
  })

  it('leaves a value someone else set meanwhile', () => {
    const lockPageAgain = freePageForQuestion(asSheet({ isConnected: true }))
    body.style.pointerEvents = ''
    lockPageAgain()
    expect(body.style.pointerEvents).toBe('')
  })

  it('never locks the page for a sheet it was not given', () => {
    const lockPageAgain = freePageForQuestion(null)
    lockPageAgain()
    expect(body.style.pointerEvents).toBe('auto')
  })
})
