import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { installMock, session } from '../../scripts/qa-mock.mjs'
import { nothingRunsOffTheSide } from './helpers/overflow.ts'

// The invoice's action row: Email, Share link, Download and the gold
// Collect Payment. On a phone the three quiet actions are icon buttons that
// keep their names, so the row fits a 320 px phone and Collect Payment reads
// whole on one line from 375 px up (D48). A desktop keeps the labels.

async function installSession(context: BrowserContext) {
  await installMock(context)
  await context.addInitScript((savedSession) => {
    localStorage.setItem('sb-qa-mock-auth-token', JSON.stringify(savedSession))
    localStorage.setItem('fh-onboarding-seen', '1')
  }, session)
}

test.beforeEach(async ({ context }) => {
  await installSession(context)
})

async function openInvoice(page: Page) {
  await page.goto('/invoices/c-job2', { waitUntil: 'domcontentloaded', timeout: 20_000 })
  await expect(page.locator('.fh-invoice-actionbar')).toBeVisible()
}

// How many lines a button's words take, from the line boxes of its text.
function labelLines(page: Page, name: string) {
  return page.locator('.fh-invoice-actionbar').getByRole('button', { name }).evaluate((button) => {
    const tops = new Set<number>()
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) if (rect.width > 0) tops.add(Math.round(rect.top))
    }
    return tops.size
  })
}

for (const size of [{ width: 320, height: 640 }, { width: 375, height: 667 }, { width: 390, height: 844 }, { width: 412, height: 915 }]) {
  test(`the invoice actions fit a ${size.width} px phone`, async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'phone layout')
    await page.setViewportSize(size)
    await openInvoice(page)

    const bar = page.locator('.fh-invoice-actionbar')
    for (const name of ['Email', 'Share link', 'Download', 'Collect Payment']) {
      const button = bar.getByRole('button', { name })
      await expect(button).toBeVisible()
      const box = await button.boundingBox()
      expect(box!.height, `${name} keeps a 44 px target`).toBeGreaterThanOrEqual(44)
      expect(box!.width, `${name} keeps a 44 px target`).toBeGreaterThanOrEqual(44)
    }
    await nothingRunsOffTheSide(page, `/invoices/c-job2 at ${size.width} px`)
    // Collect Payment reads whole on one line on every phone from 375 px up;
    // on a 320 px phone its two words may stack inside the button.
    if (size.width >= 375) expect(await labelLines(page, 'Collect Payment')).toBe(1)
    // No word or icon of a button is drawn outside the button's box.
    const spills = await bar.evaluate((row) => Array.from(row.querySelectorAll('button')).filter((b) => {
      const box = b.getBoundingClientRect()
      const inside = (r: DOMRect) => r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1
      const range = document.createRange()
      range.selectNodeContents(b)
      return !Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0).every(inside)
    }).map((b) => b.getAttribute('aria-label') || b.textContent?.trim()))
    expect(spills).toEqual([])
  })
}

test('the quiet invoice actions keep their names and tooltips on a phone', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'phone layout')
  await page.setViewportSize({ width: 390, height: 844 })
  await openInvoice(page)
  const bar = page.locator('.fh-invoice-actionbar')
  for (const name of ['Email', 'Share link', 'Download']) {
    const button = bar.getByRole('button', { name, exact: true })
    await expect(button).toHaveAttribute('title', /.+/)
  }
})

test('a desktop keeps the invoice action labels', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'desktop layout')
  await openInvoice(page)
  const bar = page.locator('.fh-invoice-actionbar')
  for (const label of ['Email', 'Share link', 'Download', 'Collect Payment']) {
    await expect(bar.getByRole('button', { name: label, exact: true })).toContainText(label)
  }
  await nothingRunsOffTheSide(page, '/invoices/c-job2 on a desktop')
})
