import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { installMock, session } from '../../scripts/qa-mock.mjs'

async function installSession(context: BrowserContext) {
  await installMock(context, {
    supabaseHosts: ['qa-mock.supabase.co', 'pnmhblvslftdzfcdezbw.supabase.co']
  })
  await context.addInitScript((savedSession) => {
    localStorage.setItem('sb-qa-mock-auth-token', JSON.stringify(savedSession))
    localStorage.setItem('sb-pnmhblvslftdzfcdezbw-auth-token', JSON.stringify(savedSession))
    localStorage.setItem('fh:theme-mode', 'day')
    localStorage.setItem('fh-onboarding-seen', '1')
  }, session)
}

async function openRoute(page: Page, path: string) {
  const baseURL = process.env.SCROLL_BASE_URL
  const url = baseURL ? new URL(path, baseURL).href : path
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('.fh-app')).toBeVisible()
  await expect(page.locator(
    '.fh-app__main-inner .v3-screen, .fh-app__main-inner .fh-screen, .fh-app__main-inner .fh-build-page'
  ).first()).toBeVisible({ timeout: 30_000 })
  await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {})
  let lastHeight = -1
  let stableReads = 0
  for (let attempt = 0; attempt < 15 && stableReads < 3; attempt += 1) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight)
    stableReads = height === lastHeight ? stableReads + 1 : 0
    lastHeight = height
    await page.waitForTimeout(100)
  }
}

async function scrollSnapshot(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>('.fhs-dock')
    const coin = document.querySelector<HTMLElement>('.fhs-dock__coin')
    const main = document.querySelector<HTMLElement>('.fh-app__main')
    const header = document.querySelector<HTMLElement>('.fh-app-header')
    const navRect = nav?.getBoundingClientRect()
    const mainRect = main?.getBoundingClientRect()
    const headerRect = header?.getBoundingClientRect()
    const viewportBottom = (window.visualViewport?.offsetTop ?? 0) +
      (window.visualViewport?.height ?? window.innerHeight)
    const fixedOrSticky = Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((node) => {
        const style = getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden') return false
        return style.position === 'fixed' || style.position === 'sticky'
      })
      .map((node) => {
        const rect = node.getBoundingClientRect()
        return {
          tag: node.tagName.toLowerCase(),
          className: String(node.className || '').slice(0, 100),
          position: getComputedStyle(node).position,
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          height: Math.round(rect.height)
        }
      })
      .filter((item) => item.height > 0 && item.bottom > 0 && item.top < window.innerHeight)

    return {
      scrollY: Math.round(window.scrollY),
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      visualHeight: Math.round(window.visualViewport?.height ?? window.innerHeight),
      viewportBottom: Math.round(viewportBottom),
      bodyOverflow: getComputedStyle(document.body).overflow,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      nav: navRect ? {
        top: Math.round(navRect.top),
        bottom: Math.round(navRect.bottom),
        height: Math.round(navRect.height),
        position: getComputedStyle(nav!).position,
        parent: nav!.parentElement?.tagName.toLowerCase() || null,
        // The Capture coin rises above the capsule; it is the dock's top.
        coinTop: coin ? Math.round(coin.getBoundingClientRect().top) : null
      } : null,
      header: headerRect ? {
        top: Math.round(headerRect.top),
        bottom: Math.round(headerRect.bottom),
        height: Math.round(headerRect.height),
        position: getComputedStyle(header!).position
      } : null,
      main: mainRect ? {
        top: Math.round(mainRect.top),
        bottom: Math.round(mainRect.bottom),
        height: Math.round(mainRect.height),
        paddingBottom: getComputedStyle(main!).paddingBottom
      } : null,
      fixedOrSticky
    }
  })
}

test.beforeEach(async ({ context }) => {
  await installSession(context)
})

test('keeps mobile and tablet navigation attached to the visual viewport while scrolling', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile shell behavior')

  const viewports = [
    { width: 360, height: 740 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 }
  ].filter((viewport) => !process.env.SCROLL_VIEWPORT ||
    process.env.SCROLL_VIEWPORT === `${viewport.width}x${viewport.height}`)
  const routes = process.env.SCROLL_ROUTES?.split(',').filter(Boolean) ||
    ['/', '/work', '/schedule', '/invoices', '/activity', '/settings']

  for (const viewport of viewports) {
    await page.setViewportSize(viewport)

    for (const path of routes) {
      await openRoute(page, path)
      const nav = page.locator('.fhs-dock')
      await expect(nav).toBeVisible()
      if (process.env.QA_SCREENSHOTS === '1') {
        await page.screenshot({
          path: testInfo.outputPath(`${viewport.width}x${viewport.height}-${path.replaceAll('/', '_') || 'home'}-top.png`)
        })
      }

      const positions = [0, 0.5, 1]
      for (const position of positions) {
        await page.evaluate((ratio) => {
          const max = document.documentElement.scrollHeight - window.innerHeight
          window.scrollTo({ top: Math.max(0, max * ratio), behavior: 'instant' })
        }, position)
        await page.waitForTimeout(80)

        const snapshot = await scrollSnapshot(page)
        console.log(`SCROLL ${viewport.width}x${viewport.height} ${path} ${position}: ${JSON.stringify(snapshot)}`)
        expect(snapshot.nav?.position).toBe('fixed')
        expect(snapshot.nav?.parent).toBe('body')
        // The dock floats 12 px above the bottom edge (no safe area in
        // the test browser), and the page end clears its Capture coin.
        const gap = snapshot.viewportBottom - (snapshot.nav?.bottom ?? 0)
        expect(gap).toBeGreaterThanOrEqual(11)
        expect(gap).toBeLessThanOrEqual(13)
        const dockReach = snapshot.viewportBottom - (snapshot.nav?.coinTop ?? snapshot.nav?.top ?? 0)
        expect(Number.parseFloat(snapshot.main?.paddingBottom || '0')).toBeGreaterThanOrEqual(dockReach + 8)
        expect(snapshot.horizontalOverflow).toBeLessThanOrEqual(0)
        if (snapshot.scrollY > 0) {
          expect(snapshot.header?.position).toBe('sticky')
          expect(Math.abs(snapshot.header?.top || 0)).toBeLessThanOrEqual(1)
        }
      }
      if (process.env.QA_SCREENSHOTS === '1') {
        await page.screenshot({
          path: testInfo.outputPath(`${viewport.width}x${viewport.height}-${path.replaceAll('/', '_') || 'home'}-bottom.png`)
        })
      }
    }
  }
})

test('restores mobile scroll after opening and closing the workspace menu', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile drawer behavior')
  await page.setViewportSize({ width: 390, height: 740 })
  await openRoute(page, '/settings')
  await page.evaluate(() => window.scrollTo({ top: 640, behavior: 'instant' }))
  const before = await page.evaluate(() => window.scrollY)

  await page.getByRole('button', { name: 'Open workspace menu' }).click()
  await expect(page.getByRole('dialog', { name: 'Workspace menu' })).toBeVisible()
  await page.mouse.move(8, 80)
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await page.getByRole('button', { name: 'Close menu' }).click()
  await expect(page.getByRole('dialog', { name: 'Workspace menu' })).toBeHidden()

  expect(await page.evaluate(() => window.scrollY)).toBe(before)
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden')
})

test('shows the mobile Settings save action only after a change', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile settings behavior')
  await page.setViewportSize({ width: 390, height: 844 })
  await openRoute(page, '/settings')

  const saveBar = page.locator('.fh-settings-save-bar')
  await expect(saveBar).toHaveCount(0)
  const companyName = page.getByLabel('Company name')
  await companyName.fill(`${await companyName.inputValue()} LLC`)
  await expect(saveBar).toBeVisible()

  const geometry = await page.evaluate(() => {
    const save = document.querySelector<HTMLElement>('.fh-settings-save-bar')!.getBoundingClientRect()
    const nav = document.querySelector<HTMLElement>('.fhs-dock')!.getBoundingClientRect()
    const coin = document.querySelector<HTMLElement>('.fhs-dock__coin')!.getBoundingClientRect()
    return {
      saveBottom: Math.round(save.bottom),
      navTop: Math.round(nav.top),
      coinTop: Math.round(coin.top)
    }
  })
  expect(geometry.navTop - geometry.saveBottom).toBeGreaterThanOrEqual(15)
  // The coin rises above the capsule and must not touch the save bar.
  expect(geometry.coinTop - geometry.saveBottom).toBeGreaterThanOrEqual(8)
  if (process.env.QA_SCREENSHOTS === '1') {
    await page.screenshot({ path: testInfo.outputPath('mobile-settings-dirty.png') })
  }
})

test('keeps invoice actions clear of mobile and desktop navigation', async ({ page }, testInfo) => {
  await page.setViewportSize(testInfo.project.name.startsWith('mobile')
    ? { width: 390, height: 844 }
    : { width: 1440, height: 900 })
  await openRoute(page, '/invoices/c-job2')
  const actionBar = page.locator('.fh-invoice-actionbar')
  await expect(actionBar).toBeVisible()
  await page.evaluate(() => window.scrollTo({
    top: document.documentElement.scrollHeight - window.innerHeight,
    behavior: 'instant'
  }))

  const geometry = await page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('.fh-invoice-actionbar')!.getBoundingClientRect()
    const screen = document.querySelector<HTMLElement>('.v3-screen--invoice-detail')!
    const flowBottom = Array.from(screen.children)
      .filter((element) => !element.classList.contains('fh-invoice-actionbar'))
      .map((element) => (element as HTMLElement).getBoundingClientRect().bottom)
      .reduce((max, bottom) => Math.max(max, bottom), Number.NEGATIVE_INFINITY)
    const nav = document.querySelector<HTMLElement>('.fhs-dock__coin')?.getBoundingClientRect()
    return {
      barTop: Math.round(bar.top),
      barBottom: Math.round(bar.bottom),
      barLeft: Math.round(bar.left),
      flowBottom: Math.round(flowBottom),
      navTop: nav ? Math.round(nav.top) : null
    }
  })

  expect(geometry.barTop - geometry.flowBottom).toBeGreaterThanOrEqual(15)
  if (testInfo.project.name.startsWith('mobile')) {
    // navTop is the Capture coin's top, the highest point of the dock.
    expect((geometry.navTop || 0) - geometry.barBottom).toBeGreaterThanOrEqual(8)
  } else {
    expect(geometry.barLeft).toBeGreaterThanOrEqual(232)
  }
  if (process.env.QA_SCREENSHOTS === '1') {
    await page.screenshot({ path: testInfo.outputPath(`invoice-actions-${testInfo.project.name}.png`) })
  }
})

test('keeps desktop chrome stable on long routes', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop shell behavior')
  const viewports = [
    { width: 1024, height: 768 },
    { width: 1440, height: 900 }
  ]
  const routes = process.env.SCROLL_ROUTES?.split(',').filter(Boolean) ||
    ['/', '/work', '/schedule', '/invoices', '/activity', '/settings']

  for (const viewport of viewports) {
    await page.setViewportSize(viewport)

    for (const path of routes) {
      await openRoute(page, path)
      await expect(page.locator('.fh-desktop-sidebar')).toBeVisible()
      await expect(page.locator('.fhs-dock')).toBeHidden()
      if (process.env.QA_SCREENSHOTS === '1') {
        await page.screenshot({
          path: testInfo.outputPath(`desktop-${viewport.width}x${viewport.height}-${path.replaceAll('/', '_') || 'home'}-top.png`)
        })
      }

      await page.evaluate(() => window.scrollTo({
        top: document.documentElement.scrollHeight - window.innerHeight,
        behavior: 'instant'
      }))
      await page.waitForTimeout(80)

      const sidebar = await page.locator('.fh-desktop-sidebar').boundingBox()
      const workspaceHeader = page.locator('.fh-build-topbar:visible, .fh-app-header:visible').first()
      const sidebarOverflow = await page.locator('.fh-desktop-sidebar').evaluate((element) => {
        const nav = element.querySelector<HTMLElement>('.fhs-side__nav')!
        return {
          shell: element.scrollHeight - element.clientHeight,
          nav: nav.scrollHeight - nav.clientHeight,
          scrollbarWidth: getComputedStyle(nav).scrollbarWidth,
          horizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth
        }
      })
      console.log(`DESKTOP ${viewport.width}x${viewport.height} ${path}: ${JSON.stringify(await scrollSnapshot(page))}`)
      expect(sidebar?.y).toBe(0)
      expect(sidebar?.height).toBe(viewport.height)
      await expect(workspaceHeader).toBeVisible()
      expect((await workspaceHeader.boundingBox())?.y).toBe(0)
      expect(sidebarOverflow.shell).toBeLessThanOrEqual(0)
      expect(sidebarOverflow.scrollbarWidth).toBe('none')
      if (viewport.height >= 900) expect(sidebarOverflow.nav).toBeLessThanOrEqual(0)
      expect(sidebarOverflow.horizontal).toBeLessThanOrEqual(0)
      if (process.env.QA_SCREENSHOTS === '1') {
        await page.screenshot({
          path: testInfo.outputPath(`desktop-${viewport.width}x${viewport.height}-${path.replaceAll('/', '_') || 'home'}-bottom.png`)
        })
      }
    }
  }
})

test('keeps every desktop navigation item reachable on a short viewport', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop sidebar behavior')
  await page.setViewportSize({ width: 1440, height: 740 })
  await openRoute(page, '/')

  const sidebar = page.locator('.fh-desktop-sidebar')
  const footer = page.locator('.fhs-side__foot')
  const settings = sidebar.getByRole('button', { name: 'Settings', exact: true })
  await expect(footer).toBeVisible()
  await settings.scrollIntoViewIfNeeded()
  await expect(settings).toBeVisible()
  await expect(footer).toBeVisible()

  const scrollbarWidth = await sidebar.locator('.fhs-side__nav').evaluate((nav) =>
    getComputedStyle(nav).scrollbarWidth
  )
  expect(scrollbarWidth).toBe('none')
})
