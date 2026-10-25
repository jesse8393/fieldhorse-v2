// The signed out stage reaches the right edge of a desktop window (Phase 8
// follow up B, bullet 5). global.css reserves a scrollbar gutter on every
// page so an overlay that locks scrolling never shifts the layout (audit
// #26), and auth.css paints the page onyx under Welcome, Login, Reset
// password and Partner invite. Beside the photo and the grain that gutter
// still read as a darker strip about 15 px wide, so those screens give it
// back (scrollbar-gutter: auto) and every app page keeps it.
//
// Giving the gutter back only reaches the edge while the page does not
// scroll: a page even 1 px taller than the window shows a real scrollbar,
// as wide as the gutter was. With the photo the column sits at the bottom
// of the window, so Login, the tallest, is checked with it at the common
// desktop sizes, and the other screens with it at 1440 by 900. Each must
// fit the window.
//
// Playwright's headless Chromium hides scrollbars (--hide-scrollbars), so a
// page that overflows shows none there and clientWidth equals the window's
// width whatever the page does. This file launches it without that switch,
// so it draws scrollbars the way a desktop with classic scrollbars does
// (15 px on Linux), and the edges measured are the ones a person sees.
//
// These pages are signed out: Supabase auth calls are answered here with a
// failed sign in and never leave the browser.
import { readFileSync } from 'node:fs'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn'

test.use({
  viewport: { width: 1440, height: 900 },
  launchOptions: [async ({ launchOptions }, use) => {
    const ignored = launchOptions.ignoreDefaultArgs
    await use({
      ...launchOptions,
      ignoreDefaultArgs: ignored === true ? true : [...(ignored || []), '--hide-scrollbars']
    })
  }, { scope: 'worker' }]
})
test.skip(({ isMobile }) => isMobile, 'The scrollbar gutter is a desktop matter')

// A real photograph, so the stage shows the hero photo from public/welcome.jpg.
const PHOTO = readFileSync(new URL('./fixtures/bright-cover.jpg', import.meta.url))

// Desktop windows people use, besides the 1440 by 900 the file opens at.
const SIZES = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 800 },
  { width: 1536, height: 864 },
  { width: 1280, height: 1024 },
  { width: 1920, height: 1080 }
]

async function stubSignedOut(context: BrowserContext, photo: 'present' | 'missing' = 'present') {
  const authCalls: string[] = []
  await context.route('**/auth/v1/**', async (route) => {
    authCalls.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
    })
  })
  await context.route('**/welcome.jpg', (route) => photo === 'present'
    ? route.fulfill({ status: 200, contentType: 'image/jpeg', body: PHOTO })
    : route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' }))
  await context.route('**/api/partner-invite-info**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ inviter_company: 'Harlow Construction', job_title: 'Back porch' })
    })
  )
  return authCalls
}

type Edge = {
  innerWidth: number
  innerHeight: number
  clientWidth: number
  scrollHeight: number
  htmlRight: number
  stageRight: number | null
  photoRight: number | null
  gutter: string
}

function measure(page: Page): Promise<Edge> {
  return page.evaluate(() => {
    const html = document.documentElement
    const right = (selector: string) => {
      const el = document.querySelector(selector)
      return el ? el.getBoundingClientRect().right : null
    }
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      clientWidth: html.clientWidth,
      scrollHeight: html.scrollHeight,
      htmlRight: html.getBoundingClientRect().right,
      stageRight: right('.fha'),
      photoRight: right('.fha-hero'),
      gutter: getComputedStyle(html).scrollbarGutter
    }
  })
}

// How wide a gutter this browser reserves for a stable scrollbar gutter.
function browserGutter(page: Page): Promise<number> {
  return page.evaluate(() => {
    const box = document.createElement('div')
    box.style.cssText = 'position:absolute;top:0;left:0;width:200px;height:50px;overflow-y:auto;scrollbar-gutter:stable;visibility:hidden'
    const inner = document.createElement('div')
    inner.style.height = '10px'
    box.appendChild(inner)
    document.body.appendChild(box)
    const width = 200 - inner.getBoundingClientRect().width
    box.remove()
    return width
  })
}

// How wide a scrollbar this browser draws when a box scrolls: 0 where
// scrollbars are hidden or overlay, 15 for classic scrollbars on Linux.
function browserScrollbar(page: Page): Promise<number> {
  return page.evaluate(() => {
    const box = document.createElement('div')
    box.style.cssText = 'position:absolute;top:0;left:0;width:200px;height:50px;overflow-y:scroll;visibility:hidden'
    document.body.appendChild(box)
    const width = box.offsetWidth - box.clientWidth
    box.remove()
    return width
  })
}

// The window is the stage's: no reserved gutter, no scrollbar, nothing
// below the fold, and the stage (and the photo, when there is one) runs
// to the window's right edge.
function expectFullWidth(edge: Edge, where: string) {
  const at = `${where}: ${JSON.stringify(edge)}`
  expect(edge.gutter, at).toBe('auto')
  expect(edge.scrollHeight, at).toBeLessThanOrEqual(edge.innerHeight)
  expect(edge.clientWidth, at).toBe(edge.innerWidth)
  expect(edge.htmlRight, at).toBe(edge.innerWidth)
  expect(edge.stageRight, at).toBe(edge.innerWidth)
  if (edge.photoRight !== null) expect(edge.photoRight, at).toBe(edge.innerWidth)
}

async function photoShown(page: Page) {
  const photo = page.locator('.fha-hero img')
  await expect(photo).toBeVisible()
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
  await expect(page.locator('.fha--photo')).toHaveCount(1)
}

// Waits for the layout a new window size gives (100dvh) before measuring.
async function resizeTo(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size)
  await expect.poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([size.width, size.height])
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

test('this browser draws classic scrollbars, so the edges below are the ones a person sees', async ({ context, page }) => {
  await stubSignedOut(context)
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  const width = await browserScrollbar(page)
  // Chromium draws classic scrollbars on Linux and Windows. macOS draws
  // overlay ones, which take no room, so there the checks below hold
  // without a scrollbar to see.
  test.skip(process.platform === 'darwin' && width === 0, 'macOS draws overlay scrollbars')
  expect(width).toBeGreaterThan(0)
})

test('Login with the photo fits the window and reaches the right edge, its photo too, at every common desktop size', async ({ context, page }) => {
  const authCalls = await stubSignedOut(context)
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await photoShown(page)
  await page.evaluate(() => document.fonts.ready)

  expectFullWidth(await measure(page), '/login at 1440 by 900')
  for (const size of SIZES) {
    await resizeTo(page, size)
    expectFullWidth(await measure(page), `/login at ${size.width} by ${size.height}`)
  }
  expect(authCalls).toEqual([])
})

test('Login without a photo reaches the right edge', async ({ context, page }) => {
  await stubSignedOut(context, 'missing')
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('.fha-hero')).toHaveCount(0)
  expectFullWidth(await measure(page), '/login without a photo')
})

test('Reset password and Partner invite reach the right edge too, with the photo', async ({ context, page }) => {
  await stubSignedOut(context)

  await page.goto('/reset-password')
  await expect(page.getByRole('heading', { level: 1, name: 'Reset your password.' })).toBeVisible()
  await photoShown(page)
  await page.evaluate(() => document.fonts.ready)
  expectFullWidth(await measure(page), '/reset-password')

  await page.goto('/partner-invite/tok123')
  await expect(page.getByRole('heading', { level: 1, name: 'Harlow Construction invited you to manage together.' })).toBeVisible()
  await photoShown(page)
  await page.evaluate(() => document.fonts.ready)
  expectFullWidth(await measure(page), '/partner-invite')
})

// An alert or a notice line makes the sign in column 36 px taller (20 px
// of text and the form's 16 px gap). With the photo the column sat at the
// bottom of the window, so one alert made the page scroll, and with the
// gutter given back the scrollbar that appeared moved the stage and the
// column sideways (Phase 8 follow up B, second review). On a desktop the
// photo column leaves room for one line, so the page still fits.
test('Login with the photo still fits the window with an alert or a notice line showing', async ({ context, page }) => {
  await stubSignedOut(context)
  // A reset link that goes out, so the notice line shows. After the stub,
  // so it answers first.
  await context.route('**/auth/v1/recover**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await photoShown(page)
  await page.evaluate(() => document.fonts.ready)
  const everySize = async (what: string) => {
    for (const size of [{ width: 1440, height: 900 }, ...SIZES]) {
      await resizeTo(page, size)
      expectFullWidth(await measure(page), `/login with ${what} at ${size.width} by ${size.height}`)
    }
  }

  // A failed sign in.
  await page.getByLabel('Email').fill('casey@harlow.co')
  await page.getByLabel('Password').fill('not the password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Invalid login credentials')
  await everySize('a failed sign in')

  // Forgot password with no email.
  await page.getByLabel('Email').fill('')
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await expect(page.getByRole('alert')).toHaveText('Enter your email above first, then hit Forgot password.')
  await everySize('the email asked for')

  // The reset link sent.
  await page.getByLabel('Email').fill('casey@harlow.co')
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await expect(page.getByRole('status')).toHaveText('Reset link sent. Check your email.')
  await expect(page.locator('.fha-notice')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await everySize('the reset link sent')
})

// Where the column and the photo sit, to tell whether anything moved.
type Column = {
  clientWidth: number
  clientHeight: number
  scrollWidth: number
  scrollHeight: number
  wordmarkLeft: number
  signInLeft: number
  signInWidth: number
  photo: { left: number; width: number; height: number } | null
}

function column(page: Page): Promise<Column> {
  return page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect() ?? null
    const signIn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Sign in')
    const signInRect = signIn?.getBoundingClientRect()
    const photo = rect('.fha-hero__img')
    return {
      clientWidth: document.documentElement.clientWidth,
      clientHeight: document.documentElement.clientHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      wordmarkLeft: rect('.fha-wordmark')?.left ?? NaN,
      signInLeft: signInRect?.left ?? NaN,
      signInWidth: signInRect?.width ?? NaN,
      photo: photo ? { left: photo.left, width: photo.width, height: photo.height } : null
    }
  })
}

async function failSignIn(page: Page) {
  await page.getByLabel('Email').fill('casey@harlow.co')
  await page.getByLabel('Password').fill('not the password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Invalid login credentials')
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

// Where the window is too short for the alert line, the page scrolls and a
// classic scrollbar takes its width from the page. The column was centered
// on the page, so it jumped half that width to the left the moment the
// alert appeared; the .fha__col comment promises an error line never moves
// the wordmark (Phase 8 follow up B, second review). 1366 by 657 is a 1366
// by 768 laptop screen inside a browser.
test('an alert line never moves the column sideways, even where it makes the page scroll', async ({ context, page }) => {
  await stubSignedOut(context, 'missing')
  await page.setViewportSize({ width: 1366, height: 657 })
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('.fha-hero')).toHaveCount(0)
  const scrollbar = await browserScrollbar(page)

  const before = await column(page)
  expect(before.scrollHeight, JSON.stringify(before)).toBeLessThanOrEqual(657)
  expect(before.clientWidth).toBe(1366)
  await failSignIn(page)
  const after = await column(page)
  const at = JSON.stringify({ before, after })
  // The alert makes this window scroll, and the scrollbar shows...
  expect(after.scrollHeight, at).toBeGreaterThan(657)
  expect(after.clientWidth, at).toBe(1366 - scrollbar)
  // ...but nothing in the column moves, and nothing scrolls sideways.
  expect(after.wordmarkLeft, at).toBe(before.wordmarkLeft)
  expect(after.signInLeft, at).toBe(before.signInLeft)
  expect(after.signInWidth, at).toBe(before.signInWidth)
  expect(after.scrollWidth, at).toBe(after.clientWidth)
  expect(after.clientHeight, at).toBe(657)
})

test('with the photo, an alert line moves neither the column nor the photo, even where it makes the page scroll', async ({ context, page }) => {
  await stubSignedOut(context)
  // Short enough that the column starts at its 80 px floor, so even with
  // room for one line the alert makes the page scroll.
  await page.setViewportSize({ width: 1280, height: 700 })
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await photoShown(page)
  await page.evaluate(() => document.fonts.ready)
  const scrollbar = await browserScrollbar(page)

  const before = await column(page)
  expect(before.scrollHeight, JSON.stringify(before)).toBeLessThanOrEqual(700)
  await failSignIn(page)
  const after = await column(page)
  const at = JSON.stringify({ before, after })
  expect(after.scrollHeight, at).toBeGreaterThan(700)
  expect(after.clientWidth, at).toBe(1280 - scrollbar)
  expect(after.wordmarkLeft, at).toBe(before.wordmarkLeft)
  expect(after.signInLeft, at).toBe(before.signInLeft)
  expect(after.signInWidth, at).toBe(before.signInWidth)
  // The photo keeps its size and place; the scrollbar only covers its edge,
  // and the stage clips it there, so nothing scrolls sideways.
  expect(after.photo, at).toEqual(before.photo)
  expect(after.scrollWidth, at).toBe(after.clientWidth)
  expect(after.clientHeight, at).toBe(700)
})

test('an app page keeps its reserved gutter', async ({ context, page }) => {
  await signIn(context)
  await page.goto('/work')
  await expect(page.locator('.fh-app')).toBeVisible({ timeout: 30_000 })

  const edge = await measure(page)
  const gutter = await browserGutter(page)
  expect(edge.gutter).toBe('stable')
  // The html box stops short of the window by the gutter this browser
  // reserves (15 px for classic scrollbars), so an overlay that locks the
  // page's scroll never shifts it. (Chromium leaves an empty gutter out of
  // the root's clientWidth, so only the box shows it.)
  expect(edge.innerWidth - edge.htmlRight, JSON.stringify({ edge, gutter })).toBe(gutter)
  test.skip(gutter === 0, 'This browser reserves no gutter (overlay scrollbars), so there is nothing left to measure')
  expect(gutter).toBeGreaterThan(0)
})
