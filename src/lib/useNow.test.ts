import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchClock } from './useNow.ts'

// A stand in for the document: an event target with a visibility state.
// The tests run in node, so there is no real one.
type FakeDocument = EventTarget & { visibilityState: 'visible' | 'hidden' }

function fakeDocument(state: 'visible' | 'hidden' = 'visible'): FakeDocument {
  const doc = new EventTarget() as FakeDocument
  doc.visibilityState = state
  return doc
}

describe('watchClock', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('ticks once a minute', () => {
    const tick = vi.fn()
    const stop = watchClock(tick, 60_000, fakeDocument())
    vi.advanceTimersByTime(59_999)
    expect(tick).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(tick).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(120_000)
    expect(tick).toHaveBeenCalledTimes(3)
    stop()
  })

  it('ticks when the tab comes back into view, not while it is hidden', () => {
    const tick = vi.fn()
    const doc = fakeDocument('hidden')
    const stop = watchClock(tick, 60_000, doc)
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(tick).not.toHaveBeenCalled()
    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(tick).toHaveBeenCalledTimes(1)
    stop()
  })

  it('stops both the timer and the listener', () => {
    const tick = vi.fn()
    const doc = fakeDocument()
    const stop = watchClock(tick, 60_000, doc)
    stop()
    vi.advanceTimersByTime(180_000)
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(tick).not.toHaveBeenCalled()
  })

  it('runs with no document at all', () => {
    const tick = vi.fn()
    const stop = watchClock(tick, 1_000, null)
    vi.advanceTimersByTime(1_000)
    expect(tick).toHaveBeenCalledTimes(1)
    stop()
  })
})
