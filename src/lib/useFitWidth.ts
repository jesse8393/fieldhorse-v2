import { useEffect, useLayoutEffect, useRef } from 'react'

// Keeps a one line figure, such as a money total, whole and on screen.
// When the text drawn at its own size is wider than its box, the font is
// scaled down by the --fh-fit factor until it fits; when it fits, nothing
// changes. It measures what is drawn, so a narrow phone, zoom and the
// phone's own text size are all covered, which a size written in CSS
// container units cannot do: Chrome on Android scales those up again with
// the text.
//
// The element needs white-space: nowrap, a font size written as
// calc(<size> * var(--fh-fit, 1)), and a width that comes from its
// container (a block, or a flex item with min-width: 0), not from its text.

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** The scale that makes `need` px of text fit in `room` px, or 1 when it fits. */
export function fitScale(room: number, need: number): number {
  if (!(room > 0) || !(need > room + 0.5)) return 1
  return Math.floor((room / need) * 1000) / 1000
}

type Fittable = Pick<HTMLElement, 'clientWidth' | 'scrollWidth'> & { style: Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty'> }

/**
 * Scales the figure down until what is drawn fits its box. Text does not
 * shrink exactly in step with its font (letter spacing, rounding, a
 * browser's own text drawing), so it measures again after each step.
 */
export function fitElement(el: Fittable): void {
  el.style.removeProperty('--fh-fit')
  let scale = fitScale(el.clientWidth, el.scrollWidth)
  for (let step = 0; step < 4 && scale < 1; step++) {
    el.style.setProperty('--fh-fit', String(scale))
    const next = fitScale(el.clientWidth, el.scrollWidth)
    if (next >= 1) break
    scale = Math.floor(scale * next * 1000) / 1000
  }
}

export function useFitWidth<T extends HTMLElement>(text: string) {
  const ref = useRef<T | null>(null)
  useIsomorphicLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let settled = { width: -1, height: -1 }
    const fit = () => {
      fitElement(el)
      settled = { width: el.clientWidth, height: el.clientHeight }
    }
    fit()
    let stop = () => {}
    if (typeof ResizeObserver !== 'undefined') {
      // Fitting changes the height, so only a size the fit did not make
      // (a new width, or text drawn bigger) measures again.
      // The refit happens in the same frame, so the figure never shows
      // wider than its box. The browser notes a ResizeObserver loop when
      // the fit changes the size; that notice is harmless and is not sent
      // as an error (lib/reportClientError.ts).
      const observer = new ResizeObserver(() => {
        if (el.clientWidth === settled.width && el.clientHeight === settled.height) return
        fit()
      })
      observer.observe(el)
      stop = () => observer.disconnect()
    }
    // The display font can arrive after the first measure, and a font that
    // loads later widens the text without changing the box's size.
    let live = true
    void document.fonts?.ready.then(() => { if (live) fit() })
    const onFont = () => { if (live) fit() }
    document.fonts?.addEventListener?.('loadingdone', onFont)
    return () => {
      live = false
      document.fonts?.removeEventListener?.('loadingdone', onFont)
      stop()
    }
  }, [text])
  return ref
}
