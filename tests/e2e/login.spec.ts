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

function insideVisualViewport(page: Page, target: Locator) {
  return target.evaluate((el) => {
    const vv = window.visualViewport
    if (!vv) return false
    const box = el.getBoundingClientRect()
    return box.top >= vv.offsetTop - 0.5 && box.bottom <= vv.offsetTop + vv.height + 0.5
  })
}

test.describe('Welcome and Login', () => {
  for (const mode of ['day', 'night'] as const) {
    test(`shows the line and Sign in on onyx with linen labels in ${mode}`, async ({ context, page }) => {
      await context.addInitScript((themeMode) => {
        localStorage.setItem('fh:theme-mode', themeMode)
      }, mode)
      const stub = await stubSignedOut(context, 'missing')
      await openLogin(page)

      await expect(page.getByRole('heading', { level: 1, name: 'Run every job like a captain.' })).toBeVisible()
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

test.describe('Reset password and partner invite use the same shell', () => {
  test('reset password is onyx with no aurora or grid', async ({ context, page }) => {
    await stubSignedOut(context, 'missing')
    await page.goto('/reset-password')

    await expect(page.getByRole('heading', { level: 1, name: 'Reset your password.' })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Fieldhorse' })).toBeVisible()
    await expect(page.getByRole('main')).toHaveCSS('background-color', ONYX)
    await expect(page.locator('.fh-fx-aurora, .fh-fx-grid')).toHaveCount(0)
    await expect(page.getByText('If nothing happens, the link may have expired.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Back to sign in' })).toBeVisible()
  })

  test('partner invite is onyx and keeps its two links', async ({ context, page }) => {
    await stubSignedOut(context, 'missing')
    await context.route('**/api/partner-invite-info**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ inviter_company: 'Parker Construction', job_title: 'Back porch' })
      })
    )
    await page.goto('/partner-invite/tok123')

    await expect(page.getByRole('heading', { level: 1, name: 'Parker Construction invited you to manage together.' })).toBeVisible()
    await expect(page.getByRole('main')).toHaveCSS('background-color', ONYX)
    await expect(page.locator('.fh-fx-aurora, .fh-fx-grid')).toHaveCount(0)
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
