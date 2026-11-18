import type { BrowserContext, Locator, Page, Request } from '@playwright/test'

// A thumb that taps twice because nothing seemed to happen: two touch taps
// on the middle of the control, 120 ms apart, as on a phone on a weak
// signal. Used with a held write, so the second tap lands while the first
// is still out.
export async function twoTaps(page: Page, control: Locator, gapMs = 120) {
  await control.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(200)
  const box = await control.boundingBox()
  if (!box) throw new Error('the control is not on screen')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.touchscreen.tap(x, y)
  await page.waitForTimeout(gapMs)
  await page.touchscreen.tap(x, y)
}

// Moves within the app the way a tapped link does: React Router follows
// popstate, so the page is not reloaded and module state lives on.
export async function goInApp(page: Page, path: string) {
  await page.evaluate((p) => {
    window.history.pushState({ idx: 1 }, '', p)
    window.dispatchEvent(new PopStateEvent('popstate', { state: { idx: 1 } }))
  }, path)
}

/** Every POST to the path, as it leaves the browser. */
export function postsTo(context: BrowserContext, path: string): Request[] {
  const hits: Request[] = []
  context.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === path) hits.push(req)
  })
  return hits
}

/**
 * Holds each POST matching the pattern for `ms`, then answers it with what
 * `answer` returns for the nth POST, or lets the shared mock answer.
 */
export async function holdPosts(context: BrowserContext, pattern: string, ms: number, answer?: (n: number, request: Request) => { status: number; json: unknown } | null) {
  let n = 0
  await context.route(pattern, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    n += 1
    const mine = n
    await new Promise((resolve) => setTimeout(resolve, ms))
    const reply = answer?.(mine, route.request())
    if (reply) return route.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify(reply.json) })
    return route.fallback()
  })
}
