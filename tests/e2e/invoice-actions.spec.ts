import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { installMock, session } from '../../scripts/qa-mock.mjs'
import { nothingRunsOffTheSide } from './helpers/overflow.ts'
import { signIn } from './helpers/signIn.ts'

// The invoice's action row: Email, Share link, Download and the gold
// Collect Payment. Below 600 px (every phone) the three quiet actions are
// icon buttons that keep their names, so the row fits a 320 px phone and
// Collect Payment reads whole on one line from 375 px up (D48). From 600 px
// up, tablets and desktops alike, the buttons keep their labels.

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

for (const size of [{ width: 320, height: 640 }, { width: 375, height: 667 }, { width: 390, height: 844 }, { width: 412, height: 915 }, { width: 599, height: 900 }]) {
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

// Labels show wherever the labelled row fits: a tablet in the phone layout
// and a desktop at its narrowest. Each label is drawn (not only present for
// a screen reader) and reads on one line.
for (const { width, project } of [{ width: 600, project: 'mobile' }, { width: 899, project: 'mobile' }, { width: 900, project: 'desktop' }]) {
  test(`the invoice actions keep their labels at ${width} px`, async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith(project), `${project} layout`)
    await page.setViewportSize({ width, height: 900 })
    await openInvoice(page)
    const bar = page.locator('.fh-invoice-actionbar')
    for (const label of ['Email', 'Share link', 'Download', 'Collect Payment']) {
      await expect(bar.getByRole('button', { name: label, exact: true })).toContainText(label, { useInnerText: true })
      expect(await labelLines(page, label), `${label} on one line`).toBe(1)
    }
    await nothingRunsOffTheSide(page, `/invoices/c-job2 at ${width} px`)
  })
}

test('an icon only action is named for what it is doing while it works', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'phone layout')
  await page.setViewportSize({ width: 390, height: 844 })
  let release = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/rest/v1/fh_public_links*', async (route) => {
    if (route.request().method() === 'POST') await held
    await route.fallback()
  })
  await openInvoice(page)
  const bar = page.locator('.fh-invoice-actionbar')
  await bar.getByRole('button', { name: 'Share link', exact: true }).click()
  const busy = bar.getByRole('button', { name: 'Minting…', exact: true })
  await expect(busy).toBeVisible()
  await expect(busy).toBeDisabled()
  release()
  await expect(bar.getByRole('button', { name: 'Share link', exact: true })).toBeEnabled()
})

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
    await expect(bar.getByRole('button', { name: label, exact: true })).toContainText(label, { useInnerText: true })
  }
  await nothingRunsOffTheSide(page, '/invoices/c-job2 on a desktop')
})

// The invoice has a description of its own (D62). The Service block prints
// it, not the job title, so the screen and the PDF Description column agree.
function shedJob() {
  return {
    id: 'c-job1', stage: 'job', name: 'Plumbing Bellevue', job_title: 'Slab + trench', amount: 33100,
    user_id: 'qa-user-1', client_id: null, phone: '555-0101', email: 'x@y.com', address: '412 Burkitt Station Rd',
    created_at: '2026-09-20T15:00:00.000Z', updated_at: '2026-10-09T15:00:00.000Z', completed_at: null,
    proposal_status: null, milestones: [], follow_up_on: null, notes: null, scope_text: null
  }
}

function shedDeposit() {
  return {
    id: 'inv-1', contact_id: 'c-job1', user_id: 'qa-user-1', sequence_number: 1, title: 'Deposit', amount: 3000,
    status: 'sent', issued_at: '2026-10-10T15:00:00.000Z', due_at: '2026-10-24T15:00:00.000Z', notes: null,
    description: 'Deposit for the shed slab', created_at: '2026-10-10T15:00:00.000Z', updated_at: '2026-10-10T15:00:00.000Z'
  }
}

test("an invoice's description prints in the Service block, not the job title", async ({ page, context }) => {
  await signIn(context, { tables: { fh_contacts: [shedJob()], fh_invoices: [shedDeposit()], fh_payments: [] } })
  await page.goto('/invoices/c-job1', { waitUntil: 'domcontentloaded', timeout: 20_000 })
  const service = page.locator('.fh-invoice-detail__service')
  await expect(service).toBeVisible()
  await expect(service.getByText('Deposit for the shed slab')).toBeVisible()
  await expect(service.getByText('Slab + trench')).toHaveCount(0)
})
