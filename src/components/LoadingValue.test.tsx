import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import LoadingValue from './LoadingValue.tsx'

// A value that is still loading (Phase 8 follow up A): the fh skeleton in
// its place, inside a polite busy region with a hidden line, as
// SkeletonRows does for a list, and never a zero or a dash.

describe('LoadingValue', () => {
  it('is a polite busy region with a hidden Loading line around a hidden skeleton', () => {
    const html = renderToStaticMarkup(<LoadingValue />)
    expect(html).toMatch(/^<span[^>]*role="status"/)
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('<span class="fhc-vh">Loading</span>')
    expect(html).toMatch(/<span class="fhc-skel fhc-skel--line"[^>]*aria-hidden="true"/)
  })

  it('says what is loading and takes the size of the value it stands in for', () => {
    const html = renderToStaticMarkup(<LoadingValue label="Loading your clock" width={96} height={20} />)
    expect(html).toContain('<span class="fhc-vh">Loading your clock</span>')
    expect(html).toContain('width:96px')
    expect(html).toContain('height:20px')
  })

  it('shows no number and no dash', () => {
    const text = renderToStaticMarkup(<LoadingValue />).replace(/<[^>]+>/g, '')
    expect(text).toBe('Loading')
  })
})
