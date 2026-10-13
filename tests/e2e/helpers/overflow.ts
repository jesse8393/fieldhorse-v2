// Does anything run off the right side of the window?
//
// The page itself never grows a sideways scroll: html, body and #root clip
// whatever is wider than the window (overflow-x: clip in global.css), so
// document.documentElement.scrollWidth stays at the window's width whatever
// hides past the edge, and a check on it can never fail. These measure every
// visible element instead. A box that scrolls sideways (overflow-x auto or
// scroll: a tab strip, the sidebar's list) may hold more than it shows; only
// the box itself has to fit.
import { expect, type Page } from '@playwright/test'

/**
 * Every visible element that runs past the window's right edge, by name,
 * text and where it ends, with the window's width.
 */
export function pastTheRightEdge(page: Page) {
  return page.evaluate(() => {
    const edge = document.documentElement.clientWidth
    const scrollsSideways = (el: Element) => /^(auto|scroll)$/.test(getComputedStyle(el).overflowX)
    const past: string[] = []
    for (const el of document.body.querySelectorAll('*')) {
      const box = el.getBoundingClientRect()
      if (box.width === 0 || box.height === 0 || box.right <= edge + 0.5) continue
      if (getComputedStyle(el).visibility === 'hidden') continue
      let up = el.parentElement
      while (up && up !== document.body && !scrollsSideways(up)) up = up.parentElement
      if (up && up !== document.body) continue
      const classes = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean) : []
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)
      past.push(`${[el.tagName.toLowerCase(), ...classes].join('.')}${text ? ` "${text}"` : ''} ends at ${Math.round(box.right)} px`)
    }
    return { edge, past }
  })
}

/** Nothing hides off the right edge of the window. */
export async function nothingRunsOffTheSide(page: Page, where = '') {
  const { edge, past } = await pastTheRightEdge(page)
  expect(past, `${where ? `${where}: ` : ''}drawn past the right edge of a ${edge} px window`).toEqual([])
}
