import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { keepFocusOnRetry, MAIN_ID, type RetryFocusTarget } from './retryFocus.ts'

// Where focus goes when Try again swaps its error for a skeleton (Phase 8
// follow up A): to the heading or region that stays, or to the page's main
// region, never back to the top of the page. The unit suite runs in node,
// so the page is a small stand in.

type FakeElement = RetryFocusTarget & { attrs: Map<string, string>; focusedWith: FocusOptions[] }

function element({ connected = true, tabindex }: { connected?: boolean; tabindex?: string } = {}): FakeElement {
  const attrs = new Map<string, string>()
  if (tabindex !== undefined) attrs.set('tabindex', tabindex)
  const focusedWith: FocusOptions[] = []
  return {
    attrs,
    focusedWith,
    isConnected: connected,
    hasAttribute: (name: string) => attrs.has(name),
    setAttribute: (name: string, value: string) => { attrs.set(name, value) },
    focus: (options?: FocusOptions) => { focusedWith.push(options ?? {}) }
  }
}

const hadDocument = 'document' in globalThis
const savedDocument = (globalThis as { document?: unknown }).document
let main: FakeElement | null

beforeEach(() => {
  main = element()
  ;(globalThis as { document?: unknown }).document = {
    getElementById: (id: string) => (id === MAIN_ID ? main : null)
  }
})

afterEach(() => {
  if (hadDocument) (globalThis as { document?: unknown }).document = savedDocument
  else delete (globalThis as { document?: unknown }).document
})

describe('keepFocusOnRetry', () => {
  it('moves focus to the heading or region that stays, without scrolling', () => {
    const heading = element({ tabindex: '-1' })
    keepFocusOnRetry(heading)
    expect(heading.focusedWith).toEqual([{ preventScroll: true }])
    expect(main!.focusedWith).toEqual([])
  })

  it('makes a target with no tabindex focusable by script only', () => {
    const card = element()
    keepFocusOnRetry(card)
    expect(card.attrs.get('tabindex')).toBe('-1')
    expect(card.focusedWith).toHaveLength(1)
  })

  it('keeps a tabindex the target already has', () => {
    const panel = element({ tabindex: '0' })
    keepFocusOnRetry(panel)
    expect(panel.attrs.get('tabindex')).toBe('0')
    expect(panel.focusedWith).toHaveLength(1)
  })

  it("falls back to the page's main region when the screen was all error", () => {
    keepFocusOnRetry(null)
    expect(main!.attrs.get('tabindex')).toBe('-1')
    expect(main!.focusedWith).toEqual([{ preventScroll: true }])
  })

  it('falls back to the main region when the target has left the page', () => {
    const gone = element({ connected: false })
    keepFocusOnRetry(gone)
    expect(gone.focusedWith).toEqual([])
    expect(main!.focusedWith).toHaveLength(1)
  })

  it('does nothing when there is no main region either', () => {
    main = null
    expect(() => keepFocusOnRetry(undefined)).not.toThrow()
  })
})
