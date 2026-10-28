// The redesigned shell (docs/design/2026-10-redesign/SPEC.md, sections
// 8 and 10): the phone dock, the workspace menu behind the header
// monogram, the desktop sidebar and the Day, Night and Auto modes.
import { expect, test, type Page } from '@playwright/test'
import { signIn as signInWith } from './helpers/signIn.ts'
import { nothingRunsOffTheSide } from './helpers/overflow.ts'

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
    await expect(page).toHaveURL(/\/jobs$/)
    await expect(dock.getByRole('link', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page')

    await dock.getByRole('button', { name: /Capture/ }).click()
    await expect(page.getByRole('heading', { name: 'Capture', exact: true })).toBeVisible()
  })

  test('the header monogram opens the workspace screen from any screen', async ({ page }) => {
    for (const path of ['/', '/jobs', '/invoices', '/schedule']) {
      await open(page, path)
      await page.getByRole('button', { name: 'Open workspace menu' }).click()
      // A screen, not a sheet (D57).
      await expect(page).toHaveURL(/\/workspace$/)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      const menu = page.getByRole('navigation', { name: 'Workspace' })
      await expect(menu).toBeVisible()
      await expect(menu.getByRole('button', { name: 'Settings' })).toBeVisible()
      await page.getByRole('button', { name: 'Back' }).click()
      await expect(page).toHaveURL(new RegExp(`${path.replace('/', '\\/')}$`))
      await expect(menu).toHaveCount(0)
    }

    // Every menu route is two taps away: open, then go.
    await page.getByRole('button', { name: 'Open workspace menu' }).click()
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Subs' }).click()
    await expect(page).toHaveURL(/\/subs/)
    await expect(page.getByRole('navigation', { name: 'Workspace' })).toHaveCount(0)
  })

  test('Day, Night and Auto switch from the menu and stick', async ({ page }) => {
    await open(page, '/')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.getByRole('button', { name: 'Open workspace menu' }).click()
    await expect(page).toHaveURL(/\/workspace$/)
    await page.getByRole('radio', { name: 'Night' }).check()
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
      // Money's rows are links now (Phase 9, D62), Customers still has buttons.
      await expect(page.locator('main').locator('a, button').first()).toBeVisible()
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

test.describe('workspace identity', () => {
  test('a long workspace name is available without crowding the header', async ({ context, page }) => {
    const long = 'Parker Construction and Concrete Restoration'
    await signInWith(context, { tables: { organizations: [{ id: 'org-1', name: long }] } })
    await open(page, '/')
    const menu = page.getByRole('button', { name: 'Open workspace menu' })
    await expect(menu).toHaveAttribute('title', long)
    await menu.click()
    await expect(page.locator('.fhws-who__company')).toHaveText(long)
    await nothingRunsOffTheSide(page, 'workspace identity')
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

  test('the header and workspace preserve all primary and office destinations', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, '/invoices')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    for (const label of ['Today', 'Schedule', 'Jobs', 'Money', 'More']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible()
    }
    await expect(nav.getByRole('link', { name: 'Money', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('.fhs-dock')).toBeHidden()
    await nav.getByRole('link', { name: 'More', exact: true }).click()
    const workspace = page.getByRole('navigation', { name: 'Workspace' })
    for (const label of ['Customers', 'Reports', 'Settings', 'Subs']) {
      await expect(workspace.getByRole('button', { name: label, exact: true })).toBeVisible()
    }
    await workspace.getByRole('button', { name: 'Subs', exact: true }).click()
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
      await nothingRunsOffTheSide(page, `/design at ${width} px`)
      expect(errors).toEqual([])
      if (process.env.FH_VISUAL === '1') {
        await page.evaluate(() => document.fonts.ready)
        await expect(page).toHaveScreenshot(`design-sheet-${width}.png`, { fullPage: true, maxDiffPixelRatio: 0.01, animations: 'disabled' })
      }
    })
  }
})
