// Welcome and Login (docs/design/2026-10-redesign/SPEC.md, section 9.1,
// decision D11): always onyx with grain, FIELDHORSE wordmark, the line,
// email and password on linen labels, one brushed gold Sign in, an
// outlined Create a workspace and the smoke line. The photo from
// public/welcome.jpg only shows when the file exists.
//
// These pages are signed out. No test here uses the signIn helper, and no
// sign in or sign up request ever leaves the browser: every Supabase auth
// call goes to the stub below, which records it.
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'

test.use({ timezoneId: 'America/Chicago' })

const LINEN = 'rgb(242, 237, 228)'
const ONYX = 'rgb(22, 20, 15)'
const GOLD = 'rgb(201, 150, 58)'
// --fh-gold-brushed, top to bottom.
const BRUSHED_GOLD = /^linear-gradient\(rgb\(230, 194, 120\) 0%, rgb\(201, 150, 58\) 55%, rgb\(173, 126, 46\) 100%\)$/
// The wordmark's face at the size Login sets it.
const BEBAS = '68px "Bebas Neue"'

// A 16 by 16 JPEG, valid, so the browser decodes it as the hero photo.
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDPoooryz0z/9k=',
  'base64'
)

type Stub = { authCalls: string[]; heroRequests: string[] }

// Routes the browser needs while signed out. Supabase auth calls are
// recorded and answered with a failed sign in, never forwarded. The hero
// photo is either a real JPEG or a 404, and every request for it is counted.
async function stubSignedOut(context: BrowserContext, hero: 'missing' | 'present'): Promise<Stub> {
  const stub: Stub = { authCalls: [], heroRequests: [] }
  await context.route('**/auth/v1/**', async (route) => {
    stub.authCalls.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
    })
  })
  await context.route('**/welcome.jpg', async (route) => {
    stub.heroRequests.push(route.request().url())
    if (hero === 'present') await route.fulfill({ status: 200, contentType: 'image/jpeg', body: TINY_JPEG })
    else await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' })
  })
  return stub
}

async function openLogin(page: Page, path = '/login') {
  await page.goto(path)
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
}

type HeldFont = {
  /** Lets the held file through. */
  release: () => void
  /** Settles when the browser first asks for the file. */
  requested: Promise<void>
}

// Holds the Bebas Neue file back until release(), or fails it, so a test
// sees the wordmark before its face lands, the way a phone on a cold cache
// does. The woff is routed too: a browser asks for it when the woff2 fails.
// The pattern takes the dev server's file and a build's hashed one
// (bebas-neue-latin-400-normal-<hash>.woff2) alike.
async function holdWordmarkFont(context: BrowserContext, outcome: 'hold' | 'fail' = 'hold'): Promise<HeldFont> {
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let asked = () => {}
  const requested = new Promise<void>((resolve) => {
    asked = resolve
  })
  await context.route('**/bebas-neue-latin-400-normal*.woff*', async (route) => {
    asked()
    if (outcome === 'fail') return route.abort()
    await held
    await route.continue().catch(() => {})
  })
  return { release, requested }
}

// Holds a lazy screen's code (src/screens/<screen>.tsx on the dev server,
// assets/<screen>-<hash>.js in a build) until the browser has asked for
// Bebas Neue. The loading screen shown meanwhile (AppLoading in App.tsx)
// draws FIELDHORSE in Bebas Neue, so on a cold visit the face is already
// on its way when the screen mounts; this makes that order certain.
async function holdScreenCode(context: BrowserContext, screen: string, until: Promise<void>) {
  await context.route(`**/${screen}*`, async (route) => {
    await until
    await route.continue().catch(() => {})
  })
}

// WebKit runs Safari and every browser on an iPhone. It gives a font-display:
// swap face, which Bebas Neue is, no block period, so the face counts as
// timed out the moment its download starts. From then on
// document.fonts.check() answers true for it, while the file is still on
// its way and again after it failed, and the face's status reads 'error'
// until the file lands. Chromium answers false and 'loading'. This gives a
// test WebKit's answers, so it sees what an iPhone sees.
async function answerFontsLikeWebKit(context: BrowserContext) {
  await context.addInitScript(() => {
    const statusOf = Object.getOwnPropertyDescriptor(FontFace.prototype, 'status')!.get!
    Object.defineProperty(FontFace.prototype, 'status', {
      configurable: true,
      get(this: FontFace) {
        const status = statusOf.call(this) as FontFaceLoadStatus
        return status === 'loading' && this.display === 'swap' ? 'error' : status
      }
    })
    const fonts = Object.getPrototypeOf(document.fonts) as FontFaceSet
    const check = fonts.check
    fonts.check = function (this: FontFaceSet, font: string, text?: string) {
      const named = [...this].filter((face) => font.includes(face.family.replace(/["']/g, '')))
      if (named.length === 0) return check.call(this, font, text)
      // False only while a named face has not been asked for yet.
      return !named.some((face) => statusOf.call(face) === 'unloaded')
    }
  })
}

async function stubPartnerInvite(context: BrowserContext) {
  await context.route('**/api/partner-invite-info**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ inviter_company: 'Harlow Construction', job_title: 'Back porch' })
    })
  )
}

// Whether Bebas Neue has landed, asked of the face itself, which tells the
// truth under WebKit's answers too.
function bebasLoaded(page: Page) {
  return page.evaluate(() =>
    [...document.fonts].some((face) => face.family.replace(/["']/g, '') === 'Bebas Neue' && face.status === 'loaded')
  )
}

function bebasChecks(page: Page) {
  return page.evaluate((font) => document.fonts.check(font), BEBAS)
}

type WordmarkLayout = {
  opacity: number
  columnLeft: number
  columnRight: number
  lettersLeft: number
  lettersRight: number
  lineLeft: number
  lineRight: number
}

// Where the wordmark's letters and its hairline (the block's bottom border)
// sit against the column's content box.
function wordmarkLayout(wordmark: Locator): Promise<WordmarkLayout> {
  return wordmark.evaluate((el) => {
    const column = el.parentElement!
    const columnBox = column.getBoundingClientRect()
    const columnStyle = getComputedStyle(column)
    const letters = [...el.querySelectorAll('span')].map((span) => span.getBoundingClientRect())
    const line = el.getBoundingClientRect()
    return {
      opacity: Number(getComputedStyle(el).opacity),
      columnLeft: columnBox.left + parseFloat(columnStyle.paddingLeft),
      columnRight: columnBox.right - parseFloat(columnStyle.paddingRight),
      lettersLeft: Math.min(...letters.map((box) => box.left)),
      lettersRight: Math.max(...letters.map((box) => box.right)),
      lineLeft: line.left,
      lineRight: line.right
    }
  })
}

function fitsColumn(layout: WordmarkLayout) {
  return layout.lettersLeft >= layout.columnLeft - 0.5 && layout.lettersRight <= layout.columnRight + 0.5
}

// The whole word inside the column, with the hairline exactly under it.
function expectWholeWord(layout: WordmarkLayout) {
  const at = JSON.stringify(layout)
  expect(fitsColumn(layout), `the letters stay inside the column: ${at}`).toBe(true)
  expect(Math.abs(layout.lineLeft - layout.lettersLeft), `the hairline starts under the F: ${at}`).toBeLessThanOrEqual(1)
  expect(Math.abs(layout.lineRight - layout.lettersRight), `the hairline ends under the E: ${at}`).toBeLessThanOrEqual(1)
}

function insideVisualViewport(page: Page, target: Locator) {
  return target.evaluate((el) => {
    const vv = window.visualViewport
    if (!vv) return false
    const box = el.getBoundingClientRect()
    return box.top >= vv.offsetTop - 0.5 && box.bottom <= vv.offsetTop + vv.height + 0.5
  })
}

// The one stage every signed out screen shares (AuthShell, decision D25):
// the main landmark is the onyx scope, so its text, focus ring and fields
// read their onyx values whatever Day or Night says, painted onyx, with the
// grain layer (about 3 percent noise) over it.
async function expectOnyxShell(page: Page) {
  const main = page.getByRole('main')
  await expect(main).toHaveClass(/(^|\s)fh-onyx-scope(\s|$)/)
  await expect(main).toHaveCSS('background-color', ONYX)
  await expect(main).toHaveCSS('color', LINEN)
  const grain = await main.evaluate((el) => {
    const layer = getComputedStyle(el, '::after')
    return { image: layer.backgroundImage, opacity: Number(layer.opacity), position: layer.position }
  })
  expect(grain.image, 'the grain layer draws its noise').toContain('data:image/svg+xml')
  expect(grain.opacity, 'the grain stays faint').toBeCloseTo(0.03, 3)
  expect(grain.position).toBe('absolute')
}

test.describe('Welcome and Login', () => {
  for (const mode of ['day', 'night'] as const) {
    test(`shows the line and Sign in on onyx with linen labels in ${mode}`, async ({ context, page }) => {
      await context.addInitScript((themeMode) => {
        localStorage.setItem('fh:theme-mode', themeMode)
      }, mode)
      const stub = await stubSignedOut(context, 'missing')
      await openLogin(page)

      await expect(page.getByRole('heading', { level: 1, name: 'Every job, start to paid.' })).toBeVisible()
      await expect(page.getByRole('img', { name: 'Fieldhorse' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Create a workspace' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Forgot password?' })).toBeVisible()
      await expect(page.getByText('Bring your jobs over from Jobber in a few minutes.')).toBeVisible()

      // The old forced dark block is gone: colors come from the onyx scope,
      // so the label is linen and the stage is onyx whatever the theme is.
      const label = page.locator('label', { hasText: 'Email' })
      await expect(label).toHaveCSS('color', LINEN)
      await expect(page.locator('label', { hasText: 'Password' })).toHaveCSS('color', LINEN)
      await expect(page.getByRole('main')).toHaveCSS('background-color', ONYX)

      // Inputs are 16 px so iOS never zooms, and every control is 44 px or taller.
      for (const field of [page.getByLabel('Email'), page.getByLabel('Password')]) {
        await expect(field).toHaveCSS('font-size', '16px')
        expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      }
      for (const name of ['Sign in', 'Create a workspace', 'Forgot password?']) {
        const box = await page.getByRole('button', { name, exact: true }).boundingBox()
        expect(box!.height, name).toBeGreaterThanOrEqual(44)
      }

      expect(stub.authCalls).toEqual([])
    })
  }

  test('sets the wordmark in Bebas Neue as FIELD in brushed gold and HORSE in linen, two spans at 68 px, with the gold hairline under them', async ({ context, page }) => {
    await stubSignedOut(context, 'missing')
    await openLogin(page)
    const wordmark = page.getByRole('img', { name: 'Fieldhorse' })
    const parts = wordmark.locator('span')

    // Two words, not ten letters spread across the column with flex.
    await expect(parts).toHaveCount(2)
    await expect(parts).toHaveText(['FIELD', 'HORSE'])
    const field = parts.nth(0)
    const horse = parts.nth(1)

    // Measure the face itself, never a fallback: wait for Bebas Neue, then
    // for the wordmark to show it.
    await page.evaluate((font) => document.fonts.load(font), BEBAS)
    expect(await bebasLoaded(page), 'Bebas Neue has loaded').toBe(true)
    await expect(wordmark).toHaveCSS('opacity', '1')

    // Bebas Neue at 68 px for both words, at its natural set (no tracking).
    await expect(wordmark).toHaveCSS('font-family', /Bebas Neue/)
    await expect(wordmark).toHaveCSS('font-size', '68px')
    await expect(field).toHaveCSS('font-size', '68px')
    await expect(horse).toHaveCSS('font-size', '68px')
    expect(await wordmark.evaluate((el) => parseFloat(getComputedStyle(el).letterSpacing) || 0)).toBe(0)
    const fieldBox = (await field.boundingBox())!
    const horseBox = (await horse.boundingBox())!
    expect(Math.abs(horseBox.x - (fieldBox.x + fieldBox.width)), 'HORSE starts where FIELD ends').toBeLessThanOrEqual(1)
    expect(Math.abs(horseBox.height - fieldBox.height)).toBeLessThanOrEqual(1)
    // Drawn in Bebas Neue: each word is as wide as the face itself sets it.
    const drawn = await page.evaluate((font) => {
      const pen = document.createElement('canvas').getContext('2d')!
      pen.font = font
      return { field: pen.measureText('FIELD').width, horse: pen.measureText('HORSE').width }
    }, BEBAS)
    expect(Math.abs(fieldBox.width - drawn.field), 'FIELD is set in Bebas Neue').toBeLessThanOrEqual(1)
    expect(Math.abs(horseBox.width - drawn.horse), 'HORSE is set in Bebas Neue').toBeLessThanOrEqual(1)

    // FIELD in brushed gold, the gradient showing through the letters, and
    // HORSE in linen.
    await expect(field).toHaveCSS('background-image', BRUSHED_GOLD)
    await expect(field).toHaveCSS('-webkit-background-clip', 'text')
    await expect(field).toHaveCSS('-webkit-text-fill-color', 'rgba(0, 0, 0, 0)')
    await expect(horse).toHaveCSS('color', LINEN)
    await expect(horse).toHaveCSS('-webkit-text-fill-color', LINEN)

    // One gold hairline, the width of the word, a little under the letters.
    await expect(wordmark).toHaveCSS('border-bottom-width', '1px')
    await expect(wordmark).toHaveCSS('border-bottom-style', 'solid')
    await expect(wordmark).toHaveCSS('border-bottom-color', GOLD)
    const box = (await wordmark.boundingBox())!
    expect(Math.abs(box.width - (fieldBox.width + horseBox.width)), 'the line runs the width of the word').toBeLessThanOrEqual(1)
    expectWholeWord(await wordmarkLayout(wordmark))
    // Capitals end at the baseline, and a zero size inline block sits on it.
    const gap = await wordmark.evaluate((el) => {
      const probe = document.createElement('span')
      probe.style.cssText = 'display:inline-block;width:0;height:0'
      el.appendChild(probe)
      const baseline = probe.getBoundingClientRect().bottom
      probe.remove()
      const rect = el.getBoundingClientRect()
      return rect.bottom - parseFloat(getComputedStyle(el).borderBottomWidth) - baseline
    })
    expect(gap, 'the line sits a little under the letters').toBeGreaterThanOrEqual(8)
    expect(gap, 'the line sits a little under the letters').toBeLessThanOrEqual(24)
  })

  test('keeps the wordmark clear while Bebas Neue is on its way, then shows the whole word', async ({ context, page }) => {
    await stubSignedOut(context, 'missing')
    const held = await holdWordmarkFont(context)
    await openLogin(page)
    const wordmark = page.getByRole('img', { name: 'Fieldhorse' })

    // A cold cache: the face has not landed. Any fallback face is far wider
    // than Bebas Neue, so none of it may be painted past the column, and
    // the wordmark keeps its name for screen readers meanwhile.
    expect(await bebasLoaded(page), 'the font file is still held').toBe(false)
    const waiting = await wordmarkLayout(wordmark)
    expect(waiting.opacity === 0 || fitsColumn(waiting), `the fallback is painted past the column: ${JSON.stringify(waiting)}`).toBe(true)
    await expect(wordmark).toHaveCSS('opacity', '0')
    await expect(wordmark).toHaveCount(1)

    // The face lands and the whole word shows, in Bebas Neue at 68 px.
    held.release()
    await page.evaluate((font) => document.fonts.load(font), BEBAS)
    await expect(wordmark).toHaveCSS('opacity', '1')
    await expect(wordmark.locator('span').first()).toHaveCSS('font-size', '68px')
    expectWholeWord(await wordmarkLayout(wordmark))
  })

  for (const font of ['runs late', 'fails'] as const) {
    test(`shows a fallback wordmark that fits a 320 px phone when Bebas Neue ${font}`, async ({ context, page }) => {
      await stubSignedOut(context, 'missing')
      const held = await holdWordmarkFont(context, font === 'fails' ? 'fail' : 'hold')
      await page.setViewportSize({ width: 320, height: 568 })
      await openLogin(page)
      const wordmark = page.getByRole('img', { name: 'Fieldhorse' })
      const title = page.getByRole('heading', { level: 1 })

      // After a wait of 3 seconds at most, the word shows in the fallback
      // face, whole, with the hairline under it.
      await expect(wordmark).toHaveCSS('opacity', '1')
      expect(await bebasLoaded(page)).toBe(false)
      expectWholeWord(await wordmarkLayout(wordmark))
      if (font === 'fails') return

      // The face lands late and takes over, still whole, and the line under
      // the wordmark does not move.
      const titleTop = (await title.boundingBox())!.y
      held.release()
      await page.evaluate((face) => document.fonts.load(face), BEBAS)
      await expect(wordmark.locator('span').first()).toHaveCSS('font-size', '68px')
      expectWholeWord(await wordmarkLayout(wordmark))
      expect(Math.abs((await title.boundingBox())!.y - titleTop), 'nothing below the wordmark moves').toBeLessThanOrEqual(1)
    })
  }

  test('fits the word and its hairline on a 280 px cover screen', async ({ context, page }) => {
    await stubSignedOut(context, 'missing')
    await page.setViewportSize({ width: 280, height: 653 })
    await openLogin(page)
    const wordmark = page.getByRole('img', { name: 'Fieldhorse' })

    // Bebas Neue, stepped down from 68 px so the word fits the column.
    await page.evaluate((font) => document.fonts.load(font), BEBAS)
    await expect(wordmark).toHaveCSS('opacity', '1')
    await expect(wordmark.locator('span').first()).toHaveCSS('font-size', '52px')
    expectWholeWord(await wordmarkLayout(wordmark))
  })

  test('keeps the focus ring linen on the fields and the buttons', async ({ context, page }) => {
    await stubSignedOut(context, 'missing')
    await openLogin(page)
    await page.keyboard.press('Tab')
    await expect(page.getByLabel('Email')).toBeFocused()
    await expect(page.getByLabel('Email')).toHaveCSS('outline-color', LINEN)
    await page.keyboard.press('Tab')
    await expect(page.getByLabel('Password')).toBeFocused()
    await expect(page.getByLabel('Password')).toHaveCSS('outline-color', LINEN)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeFocused()
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCSS('outline-color', LINEN)
  })

  test('on a phone, focusing the password field keeps Sign in inside the visual viewport', async ({ context, page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Phone keyboard')
    await stubSignedOut(context, 'missing')
    await openLogin(page)
    const signIn = page.getByRole('button', { name: 'Sign in', exact: true })

    // A soft keyboard takes about half of a phone, so shrink the window to
    // what is left. Focus first, then the keyboard arrives (the iOS order).
    await page.getByLabel('Password').focus()
    await page.setViewportSize({ width: 412, height: 460 })
    await expect.poll(() => insideVisualViewport(page, signIn)).toBe(true)
    await expect(page.getByLabel('Password')).toBeFocused()
    expect(await insideVisualViewport(page, page.getByLabel('Password'))).toBe(true)

    // And the other order: the window is already short when the field takes focus.
    await page.setViewportSize({ width: 412, height: 915 })
    await page.getByLabel('Email').focus()
    await page.setViewportSize({ width: 412, height: 420 })
    await page.getByLabel('Password').focus()
    await expect.poll(() => insideVisualViewport(page, signIn)).toBe(true)
  })

  test('shows no photo and no broken image box when public/welcome.jpg is missing', async ({ context, page }) => {
    const stub = await stubSignedOut(context, 'missing')
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await openLogin(page)
    await page.waitForTimeout(1200)

    await expect(page.getByRole('main').locator('img')).toHaveCount(0)
    await expect(page.locator('.fha-hero')).toHaveCount(0)
    await expect(page.getByRole('main')).toHaveCSS('background-color', ONYX)
    // One request, one failed load line at most, never a loop.
    expect(stub.heroRequests.length).toBeLessThanOrEqual(1)
    expect(consoleErrors.length).toBeLessThanOrEqual(1)
  })

  test('fades the photo into onyx over the top 55 percent when public/welcome.jpg exists', async ({ context, page }) => {
    const stub = await stubSignedOut(context, 'present')
    await openLogin(page)

    const photo = page.getByRole('main').locator('img')
    await expect(photo).toHaveCount(1)
    await expect(photo).toBeVisible()
    expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
    const viewport = page.viewportSize()!
    const box = (await page.locator('.fha-hero').boundingBox())!
    expect(box.y).toBeLessThanOrEqual(1)
    expect(Math.abs(box.height - viewport.height * 0.55)).toBeLessThanOrEqual(2)
    expect(stub.heroRequests.length).toBeLessThanOrEqual(2)

    // The text still sits on onyx and stays linen with a photo behind it.
    await expect(page.locator('label', { hasText: 'Email' })).toHaveCSS('color', LINEN)
    await expect(page.getByRole('main')).toHaveCSS('background-color', ONYX)
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  })

  test('switches to sign up mode and back without sending anything', async ({ context, page }) => {
    const stub = await stubSignedOut(context, 'missing')
    await openLogin(page)

    await page.getByRole('button', { name: 'Create a workspace' }).click()
    await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Forgot password?' })).toHaveCount(0)
    await expect(page.getByLabel('Password')).toHaveAttribute('autocomplete', 'new-password')

    await page.getByRole('button', { name: 'Already have an account? Sign in' }).click()
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Forgot password?' })).toBeVisible()
    expect(stub.authCalls).toEqual([])
  })

  test('opens in sign up mode from the Landing link', async ({ context, page }) => {
    await stubSignedOut(context, 'missing')
    await page.goto('/login?mode=signup')
    await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeVisible()
  })

  test('keeps the forgot password and failed sign in messages', async ({ context, page }) => {
    const stub = await stubSignedOut(context, 'missing')
    await openLogin(page)

    await page.getByRole('button', { name: 'Forgot password?' }).click()
    await expect(page.getByRole('alert')).toHaveText('Enter your email above first, then hit Forgot password.')
    expect(stub.authCalls).toEqual([])

    await page.getByLabel('Email').fill('nobody@example.com')
    await page.getByLabel('Password').fill('wrong-password')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText('Invalid login credentials')
    expect(stub.authCalls.some((call) => call.includes('/auth/v1/token'))).toBe(true)
    // The form is usable again and still on onyx.
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled()
    await expect(page.getByLabel('Email')).toBeEnabled()
  })
})

// A screen can mount after something else asked for Bebas Neue: the
// loading screen in front of a lazy route or of the session check draws
// FIELDHORSE in it, and another auth screen may have waited for it already.
// The wordmark must still never paint a fallback past the column.
test.describe('The wordmark on a screen that mounts while Bebas Neue loads', () => {
  const lazyScreens = [
    { name: 'Reset password', path: '/reset-password', code: 'ResetPassword', title: 'Reset your password.' },
    { name: 'Partner invite', path: '/partner-invite/tok123', code: 'PartnerInvite', title: 'Harlow Construction invited you to manage together.' }
  ]

  for (const screen of lazyScreens) {
    test(`keeps the ${screen.name} wordmark clear while Bebas Neue is on its way and Safari calls it ready, then shows the whole word`, async ({ context, page }) => {
      await stubSignedOut(context, 'missing')
      await stubPartnerInvite(context)
      await answerFontsLikeWebKit(context)
      const font = await holdWordmarkFont(context)
      // A cold visit from an email link: the loading screen asks for the
      // face before the screen's code arrives.
      await holdScreenCode(context, screen.code, font.requested)
      await page.goto(screen.path)
      await expect(page.getByRole('heading', { level: 1, name: screen.title })).toBeVisible()
      const wordmark = page.getByRole('img', { name: 'Fieldhorse' })

      // The face is still on its way, and check() calls it ready anyway.
      expect(await bebasChecks(page), 'check() answers true, as Safari does').toBe(true)
      expect(await bebasLoaded(page), 'the font file is still held').toBe(false)
      const waiting = await wordmarkLayout(wordmark)
      expect(waiting.opacity === 0 || fitsColumn(waiting), `the fallback is painted past the column: ${JSON.stringify(waiting)}`).toBe(true)
      await expect(wordmark).toHaveCSS('opacity', '0')

      // The face lands and the whole word shows, in Bebas Neue at 68 px.
      font.release()
      await page.evaluate((face) => document.fonts.load(face), BEBAS)
      await expect(wordmark).toHaveCSS('opacity', '1')
      await expect(wordmark.locator('span').first()).toHaveCSS('font-size', '68px')
      expectWholeWord(await wordmarkLayout(wordmark))
    })
  }

  test('keeps the wordmark clear when Sign in opens from Landing while Bebas Neue is on its way and Safari calls it ready', async ({ context, page }) => {
    await stubSignedOut(context, 'missing')
    await answerFontsLikeWebKit(context)
    const font = await holdWordmarkFont(context)
    await holdScreenCode(context, 'Landing', font.requested)
    await page.goto('/')
    await page.getByRole('button', { name: 'Sign in' }).first().click()
    await expect(page.getByRole('heading', { level: 1, name: 'Every job, start to paid.' })).toBeVisible()
    const wordmark = page.getByRole('img', { name: 'Fieldhorse' })

    expect(await bebasChecks(page), 'check() answers true, as Safari does').toBe(true)
    expect(await bebasLoaded(page), 'the font file is still held').toBe(false)
    const waiting = await wordmarkLayout(wordmark)
    expect(waiting.opacity === 0 || fitsColumn(waiting), `the fallback is painted past the column: ${JSON.stringify(waiting)}`).toBe(true)
    await expect(wordmark).toHaveCSS('opacity', '0')

    font.release()
    await page.evaluate((face) => document.fonts.load(face), BEBAS)
    await expect(wordmark).toHaveCSS('opacity', '1')
    await expect(wordmark.locator('span').first()).toHaveCSS('font-size', '68px')
    expectWholeWord(await wordmarkLayout(wordmark))
  })

  test('shows a fallback wordmark that fits a 320 px phone on Partner invite and then on Sign in when Bebas Neue fails and Safari calls it ready', async ({ context, page }) => {
    await stubSignedOut(context, 'missing')
    await stubPartnerInvite(context)
    await answerFontsLikeWebKit(context)
    const font = await holdWordmarkFont(context, 'fail')
    await holdScreenCode(context, 'PartnerInvite', font.requested)
    await page.setViewportSize({ width: 320, height: 568 })
    await page.goto('/partner-invite/tok123')
    await expect(page.getByRole('heading', { level: 1, name: 'Harlow Construction invited you to manage together.' })).toBeVisible()
    const wordmark = page.getByRole('img', { name: 'Fieldhorse' })

    // The file failed, and check() still calls the face ready.
    await expect(wordmark).toHaveCSS('opacity', '1')
    expect(await bebasChecks(page), 'check() answers true, as Safari does').toBe(true)
    expect(await bebasLoaded(page)).toBe(false)
    expectWholeWord(await wordmarkLayout(wordmark))

    // Sign in mounts a new stage after the failure: the fallback again, whole.
    await page.getByRole('link', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Every job, start to paid.' })).toBeVisible()
    await expect(wordmark).toHaveCSS('opacity', '1')
    expectWholeWord(await wordmarkLayout(wordmark))
  })

  test('keeps the fallback wordmark showing on Sign in once the wait for Bebas Neue ran out on Partner invite', async ({ context, page }) => {
    await stubSignedOut(context, 'missing')
    await stubPartnerInvite(context)
    const font = await holdWordmarkFont(context)
    await page.goto('/partner-invite/tok123')
    await expect(page.getByRole('heading', { level: 1, name: 'Harlow Construction invited you to manage together.' })).toBeVisible()
    const wordmark = page.getByRole('img', { name: 'Fieldhorse' })

    // The 3 second wait runs out and the fallback shows, whole.
    await expect(wordmark).toHaveCSS('opacity', '1')
    expect(await bebasLoaded(page), 'the font file is still held').toBe(false)
    expectWholeWord(await wordmarkLayout(wordmark))

    // Sign in draws a new stage. The wait is over for this visit, so the
    // word shows from the first frame instead of hiding for another wait.
    await page.getByRole('link', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Every job, start to paid.' })).toBeVisible()
    const atOnce = await wordmarkLayout(wordmark)
    expect(atOnce.opacity, `the wordmark shows at once: ${JSON.stringify(atOnce)}`).toBe(1)
    expectWholeWord(atOnce)

    // Bebas Neue takes over when it lands.
    font.release()
    await page.evaluate((face) => document.fonts.load(face), BEBAS)
    await expect(wordmark.locator('span').first()).toHaveCSS('font-size', '68px')
    expectWholeWord(await wordmarkLayout(wordmark))
  })
})

test.describe('Reset password and partner invite use the same shell', () => {
  test('reset password sits on the onyx shell with its grain', async ({ context, page }) => {
    await stubSignedOut(context, 'missing')
    await page.goto('/reset-password')

    await expect(page.getByRole('heading', { level: 1, name: 'Reset your password.' })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Fieldhorse' })).toBeVisible()
    await expect(page.getByRole('main')).toHaveCSS('background-color', ONYX)
    await expectOnyxShell(page)
    await expect(page.getByText('If nothing happens, the link may have expired.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Back to sign in' })).toBeVisible()
  })

  test('partner invite is onyx and keeps its two links', async ({ context, page }) => {
    await stubSignedOut(context, 'missing')
    await context.route('**/api/partner-invite-info**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ inviter_company: 'Harlow Construction', job_title: 'Back porch' })
      })
    )
    await page.goto('/partner-invite/tok123')

    await expect(page.getByRole('heading', { level: 1, name: 'Harlow Construction invited you to manage together.' })).toBeVisible()
    await expect(page.getByRole('main')).toHaveCSS('background-color', ONYX)
    await expectOnyxShell(page)
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?partner_invite=tok123')
    await expect(page.getByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/login?partner_invite=tok123&mode=signup')
  })

  test('partner invite shows the invalid link message', async ({ context, page }) => {
    await stubSignedOut(context, 'missing')
    await context.route('**/api/partner-invite-info**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ error: 'invite_not_found' }) })
    )
    await page.goto('/partner-invite/gone')
    await expect(page.getByRole('alert')).toHaveText('This invite link is invalid or was removed.')
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0)
  })
})
