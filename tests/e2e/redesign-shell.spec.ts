// The redesigned shell (docs/design/2026-10-redesign/SPEC.md, sections
// 8 and 10): the phone dock, the workspace menu behind the header
// monogram, the desktop sidebar and the Day, Night and Auto modes.
import { expect, test, type Page } from '@playwright/test'
import { signIn as signInWith } from './helpers/signIn.ts'

function signIn(context: Parameters<typeof signInWith>[0], mode: 'auto' | 'day' | 'night' = 'day') {
  return signInWith(context, { mode })
}

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('.fh-app')).toBeVisible({ timeout: 30_000 })
}

test.describe('phone shell', () => {
  test.beforeEach(async ({ context }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Phone shell')
    await signIn(context)
  })

  test('the dock carries Today, Jobs, Capture, Money and Schedule', async ({ page }) => {
    await open(page, '/')
    const dock = page.getByRole('navigation', { name: 'Primary' })
    await expect(dock).toBeVisible()
    for (const label of ['Today', 'Jobs', 'Money', 'Schedule']) {
      await expect(dock.getByRole('link', { name: label })).toBeVisible()
    }
    await expect(dock.getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page')

    await dock.getByRole('link', { name: 'Jobs' }).click()
    await expect(page).toHaveURL(/\/work/)
    await expect(dock.getByRole('link', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page')

    await dock.getByRole('button', { name: /Capture/ }).click()
    await expect(page.getByRole('heading', { name: 'Capture', exact: true })).toBeVisible()
  })

  test('the header monogram opens the workspace menu from any screen', async ({ page }) => {
    for (const path of ['/', '/work', '/invoices', '/schedule']) {
      await open(page, path)
      await page.getByRole('button', { name: 'Open workspace menu' }).click()
      const menu = page.getByRole('dialog', { name: 'Workspace menu' })
      await expect(menu).toBeVisible()
      await expect(menu.getByRole('button', { name: 'Settings' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
    }

    // Every menu route is two taps away: open, then go.
    await page.getByRole('button', { name: 'Open workspace menu' }).click()
    await page.getByRole('dialog', { name: 'Workspace menu' }).getByRole('button', { name: 'Subs' }).click()
    await expect(page).toHaveURL(/\/subs/)
    await expect(page.getByRole('dialog', { name: 'Workspace menu' })).toBeHidden()
  })

  test('Day, Night and Auto switch from the menu and stick', async ({ page }) => {
    await open(page, '/')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.getByRole('button', { name: 'Open workspace menu' }).click()
    const menu = page.getByRole('dialog', { name: 'Workspace menu' })
    await menu.getByRole('radio', { name: 'Night' }).check()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(await page.evaluate(() => localStorage.getItem('fh:theme-mode'))).toBe('night')
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#171611')

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('phone screens show one gold plus', async ({ page }) => {
    // The dock coin is the only floating gold action on a phone; each
    // screen's own add action moves into its header as a quiet button.
    for (const [path, name] of [
      ['/work', 'New lead'],
      ['/schedule', 'New event'],
      ['/clients', 'New customer']
    ] as const) {
      await open(page, path)
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
      await expect(page.locator('.fh-fab')).toHaveCount(0)
    }
  })

  test('last item clears the dock', async ({ page }) => {
    for (const path of ['/invoices', '/clients']) {
      await open(page, path)
      await expect(page.locator('main').getByRole('button').first()).toBeVisible()
      // Scroll to the very bottom; long lists render more rows as they
      // near the end, so repeat until the page stops growing.
      let height = 0
      for (let i = 0; i < 6; i++) {
        const next = await page.evaluate(() => document.documentElement.scrollHeight)
        if (next === height) break
        height = next
        await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      }
      const { lastBottom, dockTop } = await page.evaluate(() => {
        const inFlow = (el: Element) => {
          for (let node: Element | null = el; node; node = node.parentElement) {
            const { position } = getComputedStyle(node)
            if (position === 'fixed' || position === 'sticky') return false
          }
          return true
        }
        const controls = [...document.querySelectorAll('main a, main button, main input, main [role="button"]')]
          .filter((el) => inFlow(el) && (el as HTMLElement).offsetParent !== null)
        const lastBottom = Math.max(...controls.map((el) => el.getBoundingClientRect().bottom))
        const capsule = document.querySelector('.fhs-dock')!.getBoundingClientRect()
        const coin = document.querySelector('.fhs-dock__coin')!.getBoundingClientRect()
        return { lastBottom, dockTop: Math.min(capsule.top, coin.top) }
      })
      expect(lastBottom, `${path}: last control ends at ${lastBottom}, dock starts at ${dockTop}`).toBeLessThanOrEqual(dockTop)
    }
  })
})

test.describe('phone header name', () => {
  test('a long company name wraps to two lines and is never cut off', async ({ context, page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Phone header')
    const long = 'Parker Construction and Concrete Restoration'
    await signInWith(context, { tables: { organizations: [{ id: 'org-1', name: long }] } })
    await open(page, '/')
    const name = page.locator('.fhs-header__company')
    await expect(name).toHaveText(long)
    const box = await name.evaluate((el) => ({
      lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)),
      clipped: el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1
    }))
    expect(box).toEqual({ lines: 2, clipped: false })
  })
})

test.describe('first paint', () => {
  test('the theme is set before React renders', async ({ context, page }) => {
    await signIn(context, 'night')
    // Block the app bundle: only the inline script in index.html runs.
    await page.route('**/src/main.tsx', (route) => route.abort())
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#171611')
  })
})

test.describe('desktop shell', () => {
  test.beforeEach(async ({ context }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop shell')
    await signIn(context)
  })

  test('the onyx sidebar carries the main list and the team and office group', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, '/invoices')
    const sidebar = page.getByRole('complementary', { name: 'Primary navigation' })
    await expect(sidebar).toBeVisible()
    expect(Math.round((await sidebar.boundingBox())?.width ?? 0)).toBe(232)
    for (const label of ['Today', 'Schedule', 'Jobs', 'Money', 'Customers', 'Reports', 'Settings']) {
      await expect(sidebar.getByRole('button', { name: label, exact: true })).toBeVisible()
    }
    await expect(sidebar.getByRole('button', { name: 'Money', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('.fhs-dock')).toBeHidden()

    const toggle = sidebar.getByRole('button', { name: 'Team and office' })
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await sidebar.getByRole('button', { name: 'Subs', exact: true }).click()
    await expect(page).toHaveURL(/\/subs/)
  })
})

// The component sheet at /design exists in development builds (the e2e
// server is one). It must render every component without errors or
// sideways scroll. Screenshot baselines are opt in (FH_VISUAL=1) because
// font rendering differs between machines; refresh them with
// FH_VISUAL=1 npx playwright test redesign-shell --update-snapshots.
test.describe('component sheet', () => {
  for (const width of [390, 1440]) {
    test(`renders every component at ${width} px`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop-chrome', 'One browser is enough for the sheet')
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/design', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: 'Component sheet' })).toBeVisible({ timeout: 30_000 })
      for (const name of ['Day', 'Night']) {
        await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)
      expect(errors).toEqual([])
      if (process.env.FH_VISUAL === '1') {
        await page.evaluate(() => document.fonts.ready)
        await expect(page).toHaveScreenshot(`design-sheet-${width}.png`, { fullPage: true, maxDiffPixelRatio: 0.01, animations: 'disabled' })
      }
    })
  }
})
