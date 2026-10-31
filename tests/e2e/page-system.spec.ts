import { expect, test } from '@playwright/test'
import { signIn } from './helpers/signIn'

test('workspace pages share readable labels, restrained surfaces and usable primary controls', async ({ page, context, isMobile }, testInfo) => {
  test.setTimeout(90_000)
  await signIn(context)
  for (const route of ['/analytics', '/invoices', '/settings', '/team']) {
    await page.goto(route)
    await expect(page.locator('#fh-main h1').first()).toBeVisible({ timeout: 30_000 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(overflow, route).toBe(false)
    if (!isMobile) {
      const labels = page.locator('.fh-build-page .fh-build-eyebrow:visible')
      for (const label of await labels.all()) {
        const style = await label.evaluate((element) => {
          const css = getComputedStyle(element)
          return { size: parseFloat(css.fontSize), opacity: css.opacity, lineHeight: parseFloat(css.lineHeight) }
        })
        expect(style.size, route).toBeGreaterThanOrEqual(14)
        expect(style.opacity, route).toBe('1')
        expect(style.lineHeight, route).toBeGreaterThanOrEqual(19)
      }
      const heading = page.locator('.fh-build-title:visible').first()
      // Reports uses the 36px lead heading above its financial overview;
      // the denser operational pages use the shared 30px page heading.
      if (await heading.count()) expect(await heading.evaluate((node) => getComputedStyle(node).fontSize), route).toBe(route === '/analytics' ? '36px' : '30px')
    }
  }
  await page.goto('/settings?section=documents')
  await expect(page.locator('#documents')).toBeVisible({ timeout: 30_000 })
  const fields = page.locator('.fh-settings-section:not([hidden]) input[type="tel"], .fh-settings-section:not([hidden]) input[type="email"]')
  await expect(fields).toHaveCount(2)
  for (const field of await fields.all()) {
    expect(await field.evaluate((node) => getComputedStyle(node).fontSize)).toBe('16px')
    expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  await page.evaluate(async () => { await document.fonts.ready; window.scrollTo({ top: 0, behavior: 'instant' }) })
  await page.screenshot({ path: testInfo.outputPath('settings-documents.png'), fullPage: true })
  if (isMobile) {
    await page.setViewportSize({ width: 320, height: 800 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
    await page.screenshot({ path: testInfo.outputPath('settings-documents-320.png'), fullPage: true })
  }
})
