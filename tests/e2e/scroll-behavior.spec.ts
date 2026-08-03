import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { installMock, session } from '../../scripts/qa-mock.mjs'

async function installSession(context: BrowserContext) {
  await installMock(context, {
    supabaseHosts: ['qa-mock.supabase.co', 'pnmhblvslftdzfcdezbw.supabase.co']
  })
  await context.addInitScript((savedSession) => {
    localStorage.setItem('sb-qa-mock-auth-token', JSON.stringify(savedSession))
    localStorage.setItem('sb-pnmhblvslftdzfcdezbw-auth-token', JSON.stringify(savedSession))
    localStorage.setItem('fh:theme', 'dark')
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
    const nav = document.querySelector<HTMLElement>('.fh-nav')
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
        parent: nav!.parentElement?.tagName.toLowerCase() || null
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
      const nav = page.locator('.fh-nav')
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
        expect(Math.abs((snapshot.nav?.bottom ?? 0) - snapshot.viewportBottom)).toBeLessThanOrEqual(1)
        expect(Number.parseFloat(snapshot.main?.paddingBottom || '0')).toBeGreaterThanOrEqual((snapshot.nav?.height || 0) + 15)
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

test('restores mobile scroll after opening and closing More', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile drawer behavior')
  await page.setViewportSize({ width: 390, height: 740 })
  await openRoute(page, '/settings')
  await page.evaluate(() => window.scrollTo({ top: 640, behavior: 'instant' }))
  const before = await page.evaluate(() => window.scrollY)

  await page.locator('.fh-nav').getByRole('button', { name: 'More' }).click()
  await expect(page.getByRole('dialog', { name: 'More tools' })).toBeVisible()
  await page.mouse.move(8, 80)
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('dialog', { name: 'More tools' })).toBeHidden()

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
    const nav = document.querySelector<HTMLElement>('.fh-nav')!.getBoundingClientRect()
    const capture = document.querySelector<HTMLElement>('.fh-fab--capture')!.getBoundingClientRect()
    return {
      saveBottom: Math.round(save.bottom),
      saveRight: Math.round(save.right),
      navTop: Math.round(nav.top),
      captureLeft: Math.round(capture.left)
    }
  })
  expect(geometry.navTop - geometry.saveBottom).toBeGreaterThanOrEqual(15)
  expect(geometry.captureLeft - geometry.saveRight).toBeGreaterThanOrEqual(15)
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
    const nav = document.querySelector<HTMLElement>('.fh-nav')?.getBoundingClientRect()
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
    expect((geometry.navTop || 0) - geometry.barBottom).toBeGreaterThanOrEqual(15)
  } else {
    expect(geometry.barLeft).toBeGreaterThanOrEqual(256)
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
      await expect(page.locator('.fh-nav')).toBeHidden()
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
        const nav = element.querySelector<HTMLElement>('.fh-desktop-sidebar__nav')!
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
  const footer = page.locator('.fh-desktop-sidebar__foot')
  const settings = sidebar.getByRole('button', { name: 'Settings' })
  await expect(footer).toBeVisible()
  await settings.scrollIntoViewIfNeeded()
  await expect(settings).toBeVisible()
  await expect(footer).toBeVisible()

  const scrollbarWidth = await sidebar.locator('.fh-desktop-sidebar__nav').evaluate((nav) =>
    getComputedStyle(nav).scrollbarWidth
  )
  expect(scrollbarWidth).toBe('none')
})
