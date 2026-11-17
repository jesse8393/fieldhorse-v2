// Contrast as the person sees it (WCAG 1.4.3 and 1.4.11): colours are read
// through a canvas, so any CSS colour form resolves to the sRGB pixel the
// browser paints, opacity on the element and its ancestors is applied, and
// the background is the nearest painted one behind the element.
import type { Locator } from '@playwright/test'

export type Part = 'text' | 'border' | 'placeholder' | 'outline'

/** The contrast ratio of one part of an element against what sits behind it. */
export function contrastOf(locator: Locator, part: Part = 'text'): Promise<number> {
  return locator.evaluate((element, part) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const rgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = '#000'
      ctx.fillStyle = css
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      return [r, g, b, a / 255]
    }
    const over = (top: number[], alpha: number, bottom: number[]) => top.slice(0, 3).map((c, i) => c * alpha + bottom[i] * (1 - alpha))
    // The painted background behind an element: ancestors' backgrounds,
    // composited from the page up.
    const backdrop = (from: Element): number[] => {
      const chain: Element[] = []
      for (let node: Element | null = from; node; node = node.parentElement) chain.unshift(node)
      let colour = [255, 255, 255]
      for (const node of chain) {
        const [r, g, b, a] = rgba(getComputedStyle(node).backgroundColor)
        if (a > 0) colour = over([r, g, b], a, colour)
      }
      return colour
    }
    let opacity = 1
    for (let node: Element | null = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity)
    const style = getComputedStyle(element)
    let css = style.color
    let behind = backdrop(element)
    if (part === 'border') { css = style.borderTopColor; behind = backdrop(element.parentElement || element) }
    if (part === 'outline') { css = style.outlineColor; behind = backdrop(element) }
    if (part === 'placeholder') {
      const placeholder = getComputedStyle(element, '::placeholder')
      const [r, g, b, a] = rgba(placeholder.color)
      css = `rgba(${r}, ${g}, ${b}, ${a * Number(placeholder.opacity || 1)})`
    }
    const [r, g, b, a] = rgba(css)
    const fore = over([r, g, b], a * opacity, behind)
    const lum = (c: number[]) => c.map(v => {
      const s = v / 255
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
    const x = lum(fore), y = lum(behind)
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  }, part)
}
